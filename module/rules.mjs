// Automated rules that run around the dice: start/end of turn, condition side effects,
// monster traits (fear, weak points, Back From the Dead, mutation) and combat-tracker hooks.
import { MONSTERS } from "./starter.mjs";
import { showRoll } from "./dice.mjs";

const SYS = "ink-ribbon-quickstart";
const horror = () => game.settings.get(SYS, "horror");
export const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

export function card(actor, title, lines, { whisper = false, buttons = "" } = {}) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: whisper ? gmIds() : [],
    content: `<div class="ir-card"><h3>${title}</h3>${lines.map(l => `<p>${l}</p>`).join("")}${buttons ? `<div class="ir-buttons">${buttons}</div>` : ""}</div>`
  });
}

/** Chat button that applies damage (and optional flags) to the GM's selected tokens. */
export const damageButton = (label, amount, mode = "normal", data = {}) =>
  `<button type="button" data-ir-damage="${amount}" data-ir-mode="${mode}" ${Object.entries(data).map(([k, v]) => `data-ir-${k}="${v}"`).join(" ")}>${label}</button>`;
/** Chat button that gives a condition to the selected tokens. */
export const conditionButton = (id, label) => `<button type="button" data-ir-condition="${id}">${label}</button>`;

export async function addCondition(actor, id) {
  if (actor && !actor.statuses.has(id)) await actor.toggleStatusEffect(id, { active: true, overlay: id === "dead" });
}
export async function removeCondition(actor, id) {
  if (actor?.statuses.has(id)) await actor.toggleStatusEffect(id, { active: false });
}

/** Acts last in combat: Shambler-type trait, or Injured (Danger on the ECG). */
export const actsLast = actor => !!(actor?.system.traits?.actsLast || actor?.system.injured);

/* -------------------------------------------- */
/*  Condition side effects (when gained)        */
/* -------------------------------------------- */

/** Runs on the client that added the condition. */
export async function onConditionGained(actor, id) {
  const s = actor.system;
  if (id === "frightened") {
    const lines = [];
    if (actor.type === "character") { await actor.gainStress(1); lines.push("+1 Stress."); }
    const max = s.adrenaline?.max ?? 0;
    if (max > 0 && s.adrenaline.value < max) { await actor.update({ "system.adrenaline.value": s.adrenaline.value + 1 }); lines.push("Regains 1 Adrenaline."); }
    lines.push("-1 die on all Tests while the source of fear is in sight. TN 5 Heart (Willpower) to move closer to it.");
    return card(actor, `${actor.name} is Frightened`, lines);
  }
  if (id === "dying") return addCondition(actor, "unconscious");
  if (id === "unconscious") {
    await addCondition(actor, "prone");
    await addCondition(actor, "incapacitated");
    const held = actor.items.filter(i => i.type === "gear" && i.system.ready);
    if (held.length) await actor.updateEmbeddedDocuments("Item", held.map(i => ({ _id: i.id, "system.ready": false })));
    return card(actor, `${actor.name} is Unconscious`, [`Drops anything held${held.length ? ` (${held.map(i => i.name).join(", ")})` : ""}, falls Prone and is Incapacitated.`]);
  }
}

/* -------------------------------------------- */
/*  Turns and rounds                            */
/* -------------------------------------------- */

/** Start of an actor's turn: Bleeding, Burning, Adrenaline regain, Back From the Dead, timed conditions. */
export async function startTurn(actor) {
  if (!actor || actor.statuses.has("dead")) return;
  const s = actor.system, t = s.traits ?? {};
  const lines = [], update = {};
  let buttons = "";

  if (t.reviving) {
    const r = await new Roll("1d3").evaluate();
    await showRoll(r, actor, `${actor.name}: Back From the Dead`, `It gets back up with ${r.total} Toughness.`, { gmOnly: actor.type !== "character" });
    update["system.toughness.value"] = Math.min(s.toughness.max, s.toughness.value + r.total);
    update["system.traits.reviving"] = false;
    lines.push(`<b>Back From the Dead:</b> it gets back up with ${r.total} Toughness.`);
  }

  const regain = actor.type === "character" ? (s.ecg.value >= 5 ? 1 : 0) : (t.adrenalineRegen ?? 0);
  if (regain && s.adrenaline.value < s.adrenaline.max && !actor.statuses.has("incapacitated")) {
    update["system.adrenaline.value"] = Math.min(s.adrenaline.max, s.adrenaline.value + regain);
    lines.push(`Regains ${regain} Adrenaline${actor.type === "character" ? " (Danger)" : ""}.`);
  }

  // Timed condition from a weak point (e.g. Incapacitated for 1d6 rounds, 1d6 <= Horror ends it early).
  const rec = s.recover;
  if (rec?.condition && actor.statuses.has(rec.condition)) {
    const r = await new Roll("1d6").evaluate();
    await showRoll(r, actor, `${actor.name}: ${rec.condition}`, `1d6 = ${r.total} vs Horror ${horror()}${r.total <= horror() ? ": shakes it off." : "."}`, { gmOnly: actor.type !== "character" });
    const left = rec.rounds - 1;
    if (r.total <= horror() || left <= 0) {
      await removeCondition(actor, rec.condition);
      update["system.recover.condition"] = "";
      lines.push(`Shakes off ${rec.condition} (rolled ${r.total}${left <= 0 ? ", time's up" : ` &le; Horror ${horror()}`}).`);
    } else {
      update["system.recover.rounds"] = left;
      lines.push(`Still ${rec.condition} (rolled ${r.total} &gt; Horror ${horror()}, ${left} round(s) left).`);
    }
  }

  if (!foundry.utils.isEmpty(update)) await actor.update(update);

  if (actor.statuses.has("burning")) {
    lines.push("<b>Burning:</b> Adjacent creatures take 1 damage (select them, then click).");
    buttons += damageButton("1 damage to Adjacent (ignores Armour)", 1, "ignore", { label: "Burning (Adjacent)" });
  }
  if (lines.length) await card(actor, `${actor.name}: start of turn`, lines, { whisper: actor.type !== "character", buttons });

  if (actor.statuses.has("bleeding")) await actor.applyDamage(1, "ignore", { label: "Bleeding" });
  if (actor.statuses.has("burning")) await actor.applyDamage(3, "ignore", { label: "Burning" });
}

/** Start of a round: Self Healing. */
export async function startRound(actor) {
  const s = actor?.system, heal = s?.traits?.selfHeal ?? 0;
  if (!heal || actor.statuses.has("dead") || s.toughness.value >= s.toughness.max) return;
  const value = Math.min(s.toughness.max, s.toughness.value + heal);
  await actor.update({ "system.toughness.value": value });
  return card(actor, `${actor.name}: Self Healing`, [`Regains ${value - s.toughness.value} Toughness (now ${value}).`], { whisper: true });
}

/** End of an actor's turn: "My Turn" extra turn. */
export async function endTurn(actor) {
  if (!actor?.system.traits?.extraTurn || actor.statuses.has("dead")) return;
  const r = await new Roll("1d6").evaluate();
  const again = r.total <= horror();
  await showRoll(r, actor, `${actor.name}: My Turn`, `1d6 = ${r.total} vs Horror ${horror()}${again ? ": another turn!" : "."}`, { gmOnly: actor.type !== "character" });
  return card(actor, `${actor.name}: My Turn`, [`Rolled ${r.total} vs Horror ${horror()}: ${again ? "<b>it takes another turn!</b>" : "no extra turn."}`]);
}

/** GM button on a sheet, for games that don't use the combat tracker. */
export async function manualTurn(actor) {
  await startRound(actor);
  await startTurn(actor);
}

export class InkCombat extends Combat {
  async _onStartTurn(combatant, context) {
    await super._onStartTurn?.(combatant, context);
    await startTurn(combatant.actor);
  }
  async _onEndTurn(combatant, context) {
    await super._onEndTurn?.(combatant, context);
    await endTurn(combatant.actor);
  }
  async _onStartRound(context) {
    await super._onStartRound?.(context);
    for (const c of this.combatants) await startRound(c.actor);
  }
}

export class InkCombatant extends Combatant {
  /** Injured survivors and Shamblers always act last. */
  _getInitiativeFormula() {
    return actsLast(this.actor) ? "0" : super._getInitiativeFormula();
  }
}

/* -------------------------------------------- */
/*  Monster traits                              */
/* -------------------------------------------- */

/** Survivors affected by a fear effect: selected tokens, or every survivor token in the scene. */
function fearTargets() {
  const pick = tokens => [...new Set(tokens.map(t => t.actor).filter(a => a?.type === "character"))];
  const selected = pick(canvas.tokens?.controlled ?? []);
  return selected.length ? selected : pick(canvas.tokens?.placeables ?? []);
}

/** Grotesque: first sighting = 1 Stress + Panic Test; later = TN 4 Heart (Willpower) or 1 Stress. */
export async function grotesque(monster, first) {
  const targets = fearTargets();
  if (!targets.length) return ui.notifications.warn("No survivor tokens in the scene (or select the ones who see it).");
  for (const a of targets) {
    if (first) {
      const atLimit = a.system.stress.value >= 6;
      await a.gainStress(1);
      if (!atLimit) await a.rollPanic();          // at the limit, gainStress already triggered Panic
    } else {
      const r = await a.rollTest({ label: `${monster.name}: keep it together`, attribute: "heart", skill: "willpower", tn: 4 });
      if (!r.successes) await a.gainStress(1);
    }
  }
}

/** Terrifying Roar: TN 5 Heart (Willpower) or 1 Stress; failures within Medium Range are Frightened. */
export async function roar(monster) {
  const targets = fearTargets();
  if (!targets.length) return ui.notifications.warn("No survivor tokens in the scene (or select the ones who hear it).");
  const failed = [];
  for (const a of targets) {
    const r = await a.rollTest({ label: `${monster.name}: Terrifying Roar`, attribute: "heart", skill: "willpower", tn: 5 });
    if (!r.successes) { failed.push(a.name); await a.gainStress(1); }
  }
  return card(monster, `${monster.name}: Terrifying Roar`,
    [failed.length ? `Failed (1 Stress): <b>${failed.join(", ")}</b>. Those within Medium Range are Frightened until the end of their next turn.` : "Everyone holds their nerve."],
    { buttons: failed.length ? conditionButton("frightened", "Frighten selected") : "" });
}

/** A hit on a targeted weak point: burst one if the damage is high enough. */
export async function hitWeakPoint(monster, damage) {
  const w = monster.system.weak;
  if (!w?.count) return;
  if (damage < w.threshold) return card(monster, `${monster.name}: ${w.label}`, [`${damage} damage isn't enough (needs ${w.threshold}+ from one hit).`], { whisper: true });

  await monster.update({ "system.weak.count": w.count - 1 });
  const lines = [`<b>One bursts!</b> (${w.count - 1} of ${w.max} left)`];
  let buttons = "";
  if (w.splashDamage || w.splashCondition) {
    lines.push(`Adjacent creatures: ${w.splashDamage ? `${w.splashDamage} damage (ignores Armour)` : ""}${w.splashCondition ? ` + ${w.splashCondition}` : ""}. Select them, then click.`);
    if (w.splashDamage) buttons += damageButton(`${w.splashDamage} damage to Adjacent`, w.splashDamage, "ignore", { label: w.label });
    if (w.splashCondition) buttons += conditionButton(w.splashCondition, `${w.splashCondition} to Adjacent`);
  }
  if (w.selfCondition) {
    await addCondition(monster, w.selfCondition);
    if (w.selfRounds) {
      const r = await new Roll(w.selfRounds).evaluate();
      await monster.update({ "system.recover.condition": w.selfCondition, "system.recover.rounds": r.total });
      lines.push(`${monster.name} is ${w.selfCondition} for up to ${r.total} round(s) (each round 1d6 &le; Horror ends it).`);
    } else lines.push(`${monster.name} is ${w.selfCondition}.`);
  }
  await card(monster, `${monster.name}: ${w.label}`, lines, { buttons });
  if (w.selfDamage) await monster.applyDamage(w.selfDamage, "ignore", { label: w.label });
}

/** Violent Mutation: turn this monster into another starter monster (keeps its token). */
export async function mutate(monster, intoName, toughness = 6) {
  const tpl = MONSTERS.find(m => m.name === intoName);
  if (!tpl) return ui.notifications.warn(`No starter monster called ${intoName}.`);
  const system = foundry.utils.deepClone(tpl.system);
  system.toughness = { value: toughness, max: tpl.system.toughness.max };
  await monster.update({ name: tpl.name, system });
  const old = monster.items.filter(i => i.type === "attack").map(i => i.id);
  if (old.length) await monster.deleteEmbeddedDocuments("Item", old);
  await monster.createEmbeddedDocuments("Item", tpl.items ?? []);
  if (monster.token) await monster.token.update({ name: tpl.name });
  else for (const t of monster.getActiveTokens(false, true)) await t.update({ name: tpl.name });
  return card(monster, `Violent Mutation!`, [`It tears itself apart and becomes a <b>${tpl.name}</b> (Toughness ${toughness}).`]);
}

/** Horror +1 when a monster with this trait appears (token created visible, or revealed). */
export async function onAppear(tokenDoc) {
  if (!tokenDoc.actor?.system.traits?.horrorOnAppear || game.user !== game.users.activeGM) return;
  const h = horror();
  if (h < 5) await game.settings.set(SYS, "horror", h + 1);
  return card(tokenDoc.actor, `${tokenDoc.name} appears`, [`Horror ${h < 5 ? `rises to ${h + 1}` : "is already at 5"}.`]);
}
