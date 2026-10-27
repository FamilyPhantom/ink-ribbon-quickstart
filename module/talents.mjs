/**
 * Talents that change the character when they're added (rules p.16):
 *   - training:       +1 Training in each listed skill (Chemist, Sneak, Tinkerer). Capped at level 2 in the demo.
 *   - trainingChoice: +1 Training in N skills the player picks (Hobby).
 *   - kit:            starting items (Always Prepared, Chemist, Sneak, Tinkerer).
 *                     "One-handed Weapon > Pocket Knife" = copy that item and rename it.
 * Applied once, by the user who added the Talent. Removing the Talent takes the Training back
 * (the starting items stay: they may have been used, traded or stored by then).
 *
 * Talents applied during rolls live in actor.mjs: panicBest (Calm Mind) and lowAdvantage (Will to Live).
 */
import { SKILLS } from "./config.mjs";
import { ITEMS } from "./starter.mjs";

const SYS = "ink-ribbon";
const MAX_TRAINING = 2;                                   // "If a Talent increases your Training with a Skill, it can't go above level 2."
const PACKABLE = ["weapon", "armour", "gear"];
const { DialogV2 } = foundry.applications.api;

const skillKeys = s => String(s ?? "").split(",").map(k => k.trim().toLowerCase()).filter(k => SKILLS[k]);
const skillName = k => SKILLS[k]?.[0] ?? k;
const grantsSomething = t => !!(skillKeys(t.training).length || t.trainingChoice > 0 || String(t.kit ?? "").trim());

/** Item data for one kit entry, from the world's Items first, then the starter list. */
function kitSource(entry) {
  const [base, rename] = entry.split(">").map(s => s.trim());
  const world = game.items.find(i => i.name === base && PACKABLE.includes(i.type));
  const src = world ? world.toObject() : foundry.utils.deepClone(ITEMS.find(i => i.name === base) ?? null);
  if (!src) { console.warn(`Ink Ribbon | Talent kit item not found: ${base}`); return null; }
  delete src._id; delete src.folder; delete src.sort; delete src.ownership;
  if (rename) src.name = rename;
  src.system = { ...(src.system ?? {}), inv: { x: -1, y: -1, rot: false }, quick: false };
  return src;
}

/** Ask the player which skills to train (Hobby). Skills already at the cap are left out. */
async function pickSkills(actor, talent, count) {
  const open = Object.keys(SKILLS).filter(k => (actor.system.skills?.[k]?.training ?? 0) < MAX_TRAINING);
  if (!open.length) return [];
  const options = open.map(k => `<option value="${k}">${skillName(k)} (${actor.system.skills[k].training})</option>`).join("");
  const selects = Array.from({ length: Math.min(count, open.length) }, (_, i) =>
    `<div class="form-group"><label>Skill ${i + 1}</label><select name="s${i}">${options.replace(`value="${open[i]}"`, `value="${open[i]}" selected`)}</select></div>`).join("");
  const picked = await DialogV2.prompt({
    window: { title: `${talent.name}: choose ${count} Skill${count > 1 ? "s" : ""}` },
    content: `<div class="ir-dialog">${selects}<p class="hint">Each gains a level of Training (max ${MAX_TRAINING}). Pick different Skills.</p></div>`,
    ok: { label: "Train", callback: (event, button) => [...button.form.querySelectorAll("select")].map(s => s.value) },
    rejectClose: false
  });
  return [...new Set(picked ?? [])];
}

const whisperFor = actor => game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);

/** Apply a newly added Talent's Training and starting kit. */
export async function applyTalent(item) {
  const actor = item.parent;
  const t = item.system;
  if (actor?.type !== "character" || !grantsSomething(t)) return;

  const wanted = skillKeys(t.training);
  if (t.trainingChoice > 0) wanted.push(...(await pickSkills(actor, item, t.trainingChoice)).filter(k => !wanted.includes(k)));

  const update = {}, raised = [], capped = [];
  for (const k of wanted) {
    const cur = actor.system.skills?.[k]?.training ?? 0;
    if (cur >= MAX_TRAINING) { capped.push(k); continue; }
    update[`system.skills.${k}.training`] = cur + 1;
    raised.push(k);
  }
  if (raised.length) await actor.update(update);

  const kit = String(t.kit ?? "").split(",").map(s => s.trim()).filter(Boolean).map(kitSource).filter(Boolean);
  if (kit.length) await actor.createEmbeddedDocuments("Item", kit);

  await item.setFlag(SYS, "granted", { skills: raised });

  const lines = [];
  if (raised.length) lines.push(`+1 Training: ${raised.map(skillName).join(", ")}.`);
  if (capped.length) lines.push(`Already at level ${MAX_TRAINING} (no change): ${capped.map(skillName).join(", ")}.`);
  if (kit.length) lines.push(`Added to the inventory: ${kit.map(i => i.name).join(", ")}.`);
  if (!lines.length) return;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), whisper: whisperFor(actor),
    content: `<div class="ir-card"><h3>${foundry.utils.escapeHTML?.(item.name) ?? item.name}</h3><p>${lines.join("<br>")}</p></div>`
  });
}

/** A Talent was removed: take back the Training it gave. */
export async function revertTalent(item, actor = item.parent) {
  const raised = item.flags?.[SYS]?.granted?.skills ?? [];
  if (actor?.type !== "character" || !raised.length) return;
  const update = {};
  for (const k of raised) update[`system.skills.${k}.training`] = Math.max(0, (actor.system.skills?.[k]?.training ?? 0) - 1);
  await actor.update(update);
  ui.notifications.info(`${item.name} removed: -1 Training in ${raised.map(skillName).join(", ")}. Starting items were kept.`);
}

export function registerTalentHooks() {
  Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id || item.type !== "talent" || item.parent?.type !== "character") return;
    if (options?.inkRibbonNoGrant) return;                 // e.g. a macro restoring a Talent without its bonuses
    applyTalent(item);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId !== game.user.id || item.type !== "talent") return;
    revertTalent(item);
  });
}
