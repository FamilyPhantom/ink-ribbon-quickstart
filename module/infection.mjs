// IR-Virus infection (Dead on Arrival p.50, "Getting Infected") and Heroic Sacrifice (The Rules p.33).
//
// Secrecy: the bite Test, the hourly roll and the stage number are GM-only (whispered, and the panel is
// only drawn for the GM). The symptoms are NOT secret: Dazed is a normal visible Condition, and Injured
// shows on the sheet. The player sees what their character feels, never "Stage 2".
import { addCondition, card, gmIds } from "./rules.mjs";

const SYS = "ink-ribbon-quickstart";
const horror = () => game.settings.get(SYS, "horror");
export const infectionOn = () => game.settings.get(SYS, "infection");

/** Stage text for the GM. Stage 1 has no Condition: the GM narrates it. */
export const STAGES = {
  1: "Fever, dilated pupils. Otherwise they seem fine. <i>(Narrate it; no Condition.)</i>",
  2: "Disoriented and confused: <b>Dazed</b> for 2d6 minutes. A physical blow dealing at least 1 damage shakes them out of it.",
  3: "Sporadic pain and nausea; thin black veins around the eyes, mouth and fingertips. <b>Injured</b> (can't be removed).",
  4: "Constant pain; black veins up to the elbows and across the face. <b>1 damage every 10 minutes</b>, can't be healed in any way. "
    + "When they would enter Dying, they die immediately and reanimate 1d6 minutes later as a Zombie Walker."
};

const gmOnly = () => {
  if (game.user.isGM) return true;
  ui.notifications.warn("Only the GM can do that.");
  return false;
};

/** The Immune background/talent: immune to the common strain of the IR-Virus. */
export const isImmune = actor => actor.items.some(i => i.type === "talent" && /^immune$/i.test(i.name.trim()));

/** Horror lost when this character makes a Heroic Sacrifice (2, or only 1 if infected). */
export const heroicHorrorLoss = actor => (actor.system.infection?.infected ? 1 : 2);

/* -------------------------------------------- */
/*  Infection                                   */
/* -------------------------------------------- */

/** GM: a survivor was bitten or scratched by an infected. Secret Strength (Endurance) Test, TN Horror + 1. */
export async function bitten(actor) {
  if (!gmOnly() || actor.type !== "character") return;
  if (!infectionOn()) return ui.notifications.info("Infection is switched off in the system settings.");
  if (actor.system.infection.infected) return ui.notifications.info(`${actor.name} is already infected.`);
  if (isImmune(actor)) return card(actor, `${actor.name}: bitten`, ["Has the <b>Immune</b> Talent: immune to the common strain of the IR-Virus."], { whisper: true });

  const s = actor.system, tn = horror() + 1;
  const pen = actor.conditionPenalty("strength", false, "endurance");
  let pool = s.attributes.strength + s.skills.endurance.training - s.stress.value - pen.total;
  let target = tn, desperate = false;
  if (pool <= 0) { pool = 1; target = 6; desperate = true; }
  const roll = await new Roll(`${pool}d6`).evaluate();
  const passed = roll.dice[0].results.some(r => r.result >= target);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }), whisper: gmIds(),
    flavor: `<div class="ir-card"><h3>${actor.name}: infection Test (secret)</h3>
      <div class="ir-math">Strength ${s.attributes.strength} &bull; Endurance +${s.skills.endurance.training}${s.stress.value ? ` &bull; Stress -${s.stress.value}` : ""}${pen.total ? ` &bull; ${pen.reasons.join(", ")}` : ""}
        = <b>${pool}d6</b> vs TN ${tn} (Horror ${horror()} + 1)${desperate ? " (pool 0: one die, 6 only)" : ""}</div>
      <div class="ir-result ${passed ? "success" : "failure"}">${passed ? "RESISTS THE VIRUS" : "INFECTED"}</div>
      ${passed ? "" : `<p>Infected, but no symptoms yet (Stage 0). Roll the hourly check; the first spread brings Stage 1.</p>`}</div>`
  }, { rollMode: "gmroll" });

  if (!passed) await actor.update({ "system.infection.infected": true, "system.infection.stage": 0 });
}

/** GM: an hour passes. 1d6 <= Horror = the virus spreads to the next stage. */
export async function hourPasses(actor) {
  if (!gmOnly() || !actor.system.infection?.infected) return;
  const stage = actor.system.infection.stage;
  if (stage >= 4) return ui.notifications.info(`${actor.name} is already at Stage 4.`);
  const roll = await new Roll("1d6").evaluate();
  const spreads = roll.total <= horror();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }), whisper: gmIds(),
    flavor: `<div class="ir-card"><h3>${actor.name}: infection, one hour on (secret)</h3>
      <div class="ir-math">1d6 vs Horror ${horror()}</div>
      <div class="ir-result ${spreads ? "failure" : "success"}">${spreads ? "THE VIRUS SPREADS" : "NO CHANGE"}</div></div>`
  }, { rollMode: "gmroll" });
  if (spreads) await setStage(actor, stage + 1);
}

/** GM: set the stage (0 = infected, no symptoms yet; cure: true = not infected). Going up applies that stage's effects. */
export async function setStage(actor, stage, { cure = false } = {}) {
  if (!gmOnly() || actor.type !== "character") return;
  stage = Math.max(0, Math.min(4, stage));
  const was = actor.system.infection.stage;
  await actor.update({ "system.infection.infected": !cure, "system.infection.stage": cure ? 0 : stage });
  if (cure) return card(actor, `${actor.name}: cured`, ["No longer infected."], { whisper: true });
  if (stage === 0) return card(actor, `${actor.name}: infection`, ["Stage 0: infected, no symptoms yet."], { whisper: true });
  const lines = [`<b>Stage ${stage}.</b> ${STAGES[stage]}`];
  if (stage > was && stage === 2) {
    const r = await new Roll("2d6").evaluate();
    await addCondition(actor, "dazed");
    lines.push(`Dazed for <b>${r.total} minutes</b>. Remove Dazed yourself when the time is up.`);
  }
  if (stage > was && stage === 3) lines.push("Injured now applies automatically (acts last, -1 Defence, -1 die on Strength/Agility Tests).");
  if (stage > was && stage === 4) lines.push("Use the <b>10 minutes</b> button for each 1 damage.");
  return card(actor, `${actor.name}: infection`, lines, { whisper: true });
}

/** GM: ten minutes pass. Stage 4 = 1 damage (ignores Armour). */
export async function tenMinutes(actor) {
  if (!gmOnly() || !actor.system.infection?.infected) return;
  if (actor.system.infection.stage < 4) return ui.notifications.info("Only Stage 4 deals damage over time.");
  await actor.applyDamage(1, "ignore", { label: "IR-Virus" });
}

/** A Dazed (Stage 2) survivor is shaken out of it by a blow that deals at least 1 damage. */
export async function snapOutOfMalaise(actor, damage) {
  const inf = actor.system.infection;
  if (!inf?.infected || inf.stage !== 2 || damage < 1 || !actor.statuses.has("dazed")) return;
  await actor.toggleStatusEffect("dazed", { active: false });
  return card(actor, `${actor.name}: infection`, ["The blow shakes them out of their malaise (Dazed ends)."], { whisper: true });
}

/** Called when a survivor dies: an infected body comes back. Walker if the virus killed them, Runner if something else did. */
export async function onDeath(actor) {
  if (actor.type !== "character" || !actor.system.infection?.infected || game.user !== game.users.activeGM) return;
  const stage = actor.system.infection.stage;
  if (stage >= 4) {
    const r = await new Roll("1d6").evaluate();
    return card(actor, `${actor.name} was infected`, [`Died of the virus (Stage 4): reanimates in <b>${r.total} minute(s)</b> as a <b>Zombie Walker</b>.`,
      "If something else killed them first, use a Zombie Runner instead: it hasn't necrotised, so it comes back fast and furious."], { whisper: true });
  }
  return card(actor, `${actor.name} was infected`, [`Died with the virus still spreading (Stage ${stage}): they come back as a <b>Zombie Runner</b> (fast and cunning).`,
    "If you'd rather they died of the virus itself, make it a Zombie Walker."], { whisper: true });
}

/* -------------------------------------------- */
/*  Heroic Sacrifice (The Rules p.33)           */
/* -------------------------------------------- */

const SACRIFICE_CONDITIONS = ["dying", "unconscious", "incapacitated", "prone"];

/** Declare a Heroic Sacrifice. Anyone can do this; the end-of-turn death is the GM's button (Horror is a world setting). */
export async function heroicSacrifice(actor) {
  if (actor.type !== "character" || actor.getFlag(SYS, "heroic") || actor.statuses.has("dead")) return;
  const { DialogV2 } = foundry.applications.api;
  const ok = await DialogV2.confirm({
    window: { title: "Heroic Sacrifice" },
    content: `<p>${actor.name} makes a Heroic Sacrifice. At the end of their turn they die.</p>`,
    rejectClose: false
  });
  if (!ok) return;
  for (const id of SACRIFICE_CONDITIONS) if (actor.statuses.has(id)) await actor.toggleStatusEffect(id, { active: false });
  await actor.setFlag(SYS, "heroic", true);
  await actor.update({ "system.adrenaline.value": actor.system.adrenaline.max });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="ir-card"><h3>${actor.name}: HEROIC SACRIFICE</h3>
      <p>Until the end of their next turn:</p>
      <ul><li>No longer Dying; ignores Conditions and Health State effects, Stress and other Complications.</li>
      <li><b>Ignores all damage.</b> Damage ignores Armour.</li>
      <li><b>Double the dice pool</b> on all Tests (Adrenaline doubles it again). Adrenaline is full.</li>
      <li>One last round in any gun that is out of ammo.</li></ul>
      <p>At the end of their turn, they die. The GM presses <b>End Sacrifice</b> on the sheet.</p></div>`
  });
}

/** GM: end of the sacrificer's turn. They die and Horror drops (by 2, or only 1 if infected). */
export async function endSacrifice(actor) {
  if (!gmOnly() || !actor.getFlag(SYS, "heroic")) return;
  const loss = heroicHorrorLoss(actor), before = horror(), after = Math.max(1, before - loss);
  await game.settings.set(SYS, "horror", after);
  await actor.unsetFlag(SYS, "heroic");
  await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="ir-card"><h3>${actor.name} gives their life</h3><p>Horror falls from ${before} to ${after}.</p></div>`
  });
}
