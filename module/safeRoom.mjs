/**
 * Safe Rooms (rules p.34).
 * The GM says when the survivors are in a Safe Room (the Horror bar's Safe Room button); the system applies the rules:
 *   - Safe Room Rest: all Toughness, Stress -1d3, Danger -> Caution, Panic effects end (actor.safeRoomRest)
 *   - Health packs and crafting need no Test, if you're at least Trained in the Skill
 *   - You can't be attacked while in a Safe Room (GM)
 * Making it Safe: an hour's work, then the GM secretly rolls 1d6 > Horror. It works as a Safe Room either way,
 * but only the GM knows whether it's truly safe.
 * Other packages can react with the "inkRibbon.safeRoom" hook (open: boolean).
 */

const SYS = "ink-ribbon";

export const isSafeRoomOpen = () => !!game.settings.get(SYS, "safeRoom");

export function registerSafeRoom() {
  game.settings.register(SYS, "safeRoom", {
    name: "Safe Room", hint: "The survivors are in a Safe Room.",
    scope: "world", config: false, type: Boolean, default: false,
    onChange: open => {
      game.inkRibbon?.renderHorrorBar?.();
      for (const app of foundry.applications.instances?.values() ?? []) {
        if (app.document?.type === "character" && app.rendered) app.render();
      }
      Hooks.callAll("inkRibbon.safeRoom", open);
    }
  });
}

/** GM: open or close a Safe Room. */
export async function toggleSafeRoom(open = !isSafeRoomOpen(), { quiet = false } = {}) {
  if (!game.user.isGM) return;
  await game.settings.set(SYS, "safeRoom", open);
  if (quiet) return;
  return ChatMessage.create({
    speaker: { alias: "Safe Room" },
    content: open
      ? `<div class="ir-card"><h3>You've reached a Safe Room</h3>
          <p>You can't be attacked here. Rest for 10 minutes to recover all Toughness, reduce Stress by 1d3 and step back from Danger.</p>
          <p>Health packs and crafting need no Test, if you're at least Trained in the Skill.</p></div>`
      : `<div class="ir-card"><h3>Leaving the Safe Room</h3><p>Back out there.</p></div>`
  });
}

/** GM: the survivors spent an hour making an area safe. Secret 1d6 vs Horror; the area works as a Safe Room either way. */
export async function makeItSafe() {
  if (!game.user.isGM) return;
  const horror = game.settings.get(SYS, "horror");
  const roll = await new Roll("1d6").evaluate();
  const safe = roll.total > horror;
  await roll.toMessage({
    speaker: { alias: "Making it Safe" },
    flavor: `<div class="ir-card"><h3>Making it Safe (GM only)</h3>
      <p>1d6 = ${roll.total} vs Horror ${horror}: <b class="${safe ? "" : "failure"}">${safe ? "It IS safe." : "It is NOT safe. Something can still get in."}</b></p>
      <p class="hint">Don't tell the players. They can rest and recover here like in a Safe Room either way.</p></div>`
  }, { rollMode: "gmroll" });
  await toggleSafeRoom(true, { quiet: true });
  return ChatMessage.create({
    speaker: { alias: "Safe Room" },
    content: `<div class="ir-card"><h3>It seems safe&hellip;</h3>
      <p>After an hour of barricading doors and checking corners, you can rest and recover here like in a Safe Room. Whether it really is safe, only the GM knows.</p></div>`
  });
}

/** Can this actor skip the Test in a Safe Room? (open Safe Room + at least Trained in one of the skills) */
export function safeRoomNoTest(actor, skills) {
  if (!isSafeRoomOpen()) return { ok: false, reason: "" };
  const trained = skills.filter(k => (actor.system.skills?.[k]?.training ?? 0) >= 1);
  return trained.length ? { ok: true, skill: trained[0] } : { ok: false, reason: "untrained" };
}

