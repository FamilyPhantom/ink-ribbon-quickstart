// Helpers for rules the Dead on Arrival booklet uses over and over.
import { addCondition, card, gmIds } from "./rules.mjs";

const SYS = "ink-ribbon-quickstart";
const horror = () => game.settings.get(SYS, "horror");

/**
 * Horror Check: "roll 1d6; if the result is equal to or lower than the current Horror, it happens"
 * (morgue bodies, breakouts, backtracking ambushes, stuck gates, Anderson on the roof...). Whispered to the GM.
 */
export async function horrorCheck() {
  if (!game.user.isGM) return;
  const roll = await new Roll("1d6").evaluate();
  const yes = roll.total <= horror();
  return roll.toMessage({
    whisper: gmIds(),
    flavor: `<div class="ir-card"><h3>Horror Check</h3>
      <div class="ir-math">1d6 vs Horror ${horror()}</div>
      <div class="ir-result ${yes ? "failure" : "success"}">${yes ? "IT HAPPENS (rolled &le; Horror)" : "NOT THIS TIME (rolled &gt; Horror)"}</div></div>`
  }, { rollMode: "gmroll" });
}

/* -------------------------------------------- */
/*  Zombie Trait table (Dead on Arrival p.55)   */
/* -------------------------------------------- */

// [low d66, high d66, text, effect]. effect: optional automation { noHead, armour, burning }.
export const ZOMBIE_TRAITS = [
  [11, 12, "Missing their right arm."],
  [13, 14, "Ankle snapped and twisted backwards."],
  [15, 16, "Left eye hanging out of the socket."],
  [21, 22, "Construction worker in a hi-vis vest: Advantage on ranged attacks."],
  [23, 24, "Missing their lower jaw: can't Bite."],
  [25, 26, "Mutters and whispers to themselves incessantly."],
  [31, 32, "Motorcycle helmet: headshots don't work.", { noHead: true }],
  [33, 34, "Sings softly and sways as if listening to music."],
  [35, 36, "Dragging a half-eaten corpse behind them."],
  [41, 42, "Retains much of their intelligence: solves problems and sets ambushes."],
  [43, 44, "Swings a fire axe wildly in front of them (Str + Fighting, 3 damage)."],
  [45, 46, "A huge hole in their chest you can see straight through."],
  [51, 52, "On fire! Has the Burning Condition and spreads it to anyone they attack.", { burning: true }],
  [53, 54, "Holds a handgun limply. 50% chance they fire it at a survivor (Agi + Shooting, 3 damage)."],
  [55, 56, "Highly sensitive to light: attacks anyone holding a light source."],
  [61, 62, "Sits on the ground, weeping uncontrollably."],
  [63, 64, "Bursts of sudden movement between moments of complete stillness."],
  [65, 66, "Former STRIPES member in full tactical gear: Armour 3; headshots don't work.", { noHead: true, armour: 3 }]
];

/** Roll a Zombie Trait (d66) for a zombie sheet. Applies the numbers that are easy to automate, notes the rest. */
export async function rollZombieTrait(actor) {
  if (!game.user.isGM || actor.type === "character") return;
  const tens = (await new Roll("1d6").evaluate()).total, ones = (await new Roll("1d6").evaluate()).total;
  const d66 = tens * 10 + ones;
  const [, , text, fx = {}] = ZOMBIE_TRAITS.find(([lo, hi]) => d66 >= lo && d66 <= hi);

  const update = { "system.abilities": `${actor.system.abilities}${actor.system.abilities ? "\n" : ""}Trait: ${text}` };
  const notes = [];
  if (fx.noHead) { update["system.traits.aimForHead"] = false; notes.push("Headshots no longer work on this zombie (Aim For the Head turned off)."); }
  if (fx.armour) { update["system.armour.value"] = Math.max(actor.system.armour.value, fx.armour); notes.push(`Armour set to ${fx.armour}.`); }
  await actor.update(update);
  if (fx.burning) { await addCondition(actor, "burning"); notes.push("Burning applied."); }

  return card(actor, `${actor.name}: Zombie Trait`, [`<b>d66 = ${d66}</b>: ${text}`, ...notes, "Added to its Abilities."], { whisper: true });
}
