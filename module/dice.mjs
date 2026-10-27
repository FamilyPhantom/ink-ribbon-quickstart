/**
 * Post an already-evaluated Roll as its own chat message, so the dice can be reviewed like any other roll
 * (and Dice So Nice, if installed, shows them). Used for side checks: Brittle, Back From the Dead, etc.
 * gmOnly: whisper to the GM (monster checks, matching the GM-only monster cards).
 */
export function showRoll(roll, actor, title, result, { gmOnly = false } = {}) {
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="ir-card"><h3>${title}</h3><p>${result}</p></div>`
  }, gmOnly ? { rollMode: "gmroll" } : {});
}
