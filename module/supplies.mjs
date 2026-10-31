/**
 * Finding Supplies (rules p.47-49). GM only: Horror bar > Search.
 * Rolls 3d6 on the Horror column, follows the sub-tables (Useful Item, Healing Item, Crafting Supplies, guns),
 * rolls Shots, applies x2/x3/x4, and the Horror 3+ / 4+ "find the gun as well" rules.
 * The result is whispered to the GM with Give buttons that put each find into a survivor's inventory.
 */
import { FINDING_SUPPLIES, horrorColumn, USEFUL_ITEM, HEALING_ITEM, CRAFTING_FIND, GUN_TABLES, lookup } from "./config.mjs";
import { itemSource } from "./compendium.mjs";

const SYS = "ink-ribbon-quickstart";
const { DialogV2 } = foundry.applications.api;
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const roll = async formula => (await new Roll(formula).evaluate()).total;
const survivors = () => game.actors.filter(a => a.type === "character");

/** Does this survivor (or, with none chosen, anyone in the party) carry a weapon with this name? */
function hasGun(actor, name) {
  const pool = actor ? [actor] : survivors().filter(a => a.hasPlayerOwner);
  return pool.some(a => a.items.some(i => i.type === "weapon" && i.name === name));
}

/**
 * Resolve one table entry into finds. Each find:
 *   { kind: "item", name, qty } | { kind: "gun", name, shots, ammo, plus } | { kind: "ammo", names[], qty } | { kind: "fuel", weapon, qty }
 * `log` collects the dice rolled, for the card.
 */
export async function resolve(entry, { horror, actor, log }) {
  if (typeof entry === "string") return [{ kind: "item", name: entry, qty: 1 }];
  const x = entry.x ?? 1;
  const sub = async (label, formula, table) => { const n = await roll(formula); log.push(`${label}: ${formula} = ${n}`); return lookup(table, n); };
  switch (entry.t) {
    case "healing": return [{ kind: "item", name: await sub("Healing Item", "1d6", HEALING_ITEM), qty: 1 }];
    case "healingTwice": return [...await resolve({ t: "healing" }, { horror, actor, log }), ...await resolve({ t: "healing" }, { horror, actor, log })];
    case "useful": return [{ kind: "item", name: await sub("Useful Item", "3d6", USEFUL_ITEM), qty: 1 }];
    // "x2" etc.: roll once and multiply the result.
    case "crafting": return [{ kind: "item", name: await sub("Crafting Supplies", "1d6", CRAFTING_FIND), qty: x }];
    case "commonAmmo": case "rareAmmo": case "uniqueAmmo": {
      const tier = entry.t.replace("Ammo", "");
      const g = await sub(`${tier[0].toUpperCase()}${tier.slice(1)} Guns & Ammo`, "1d6", GUN_TABLES[tier]);
      const shots = await roll(g.shots);
      log.push(`${g.weapon} Shots: ${g.shots} = ${shots}${x > 1 ? ` &times; ${x}` : ""}`);
      const finds = [g.fuel && !g.ammo.length ? { kind: "fuel", weapon: g.weapon, qty: shots * x } : { kind: "ammo", names: g.ammo, qty: shots * x }];
      // Horror 3+: common ammo without the gun comes with the gun. Horror 4+: rare ammo too.
      const gunToo = (tier === "common" && horror >= 3) || (tier === "rare" && horror >= 4);
      if (gunToo && !hasGun(actor, g.weapon)) finds.push({ kind: "gun", name: g.weapon, shots: 0, ammo: g.ammo, note: "found with the ammo (empty)" });
      return finds;
    }
    case "commonGun": case "rareGun": case "uniqueGun": {
      const tier = entry.t.replace("Gun", "");
      const g = await sub(`${tier[0].toUpperCase()}${tier.slice(1)} Guns & Ammo`, "1d6", GUN_TABLES[tier]);
      const shots = await roll(g.shots);
      log.push(`${g.weapon} Shots left: ${g.shots} = ${shots}`);
      return [{ kind: "gun", name: g.weapon, shots, ammo: g.ammo, plus: !!entry.plus }];
    }
    case "gun": {
      const g = GUN_TABLES.unique.map(r => r[2]).find(r => r.weapon === entry.name);
      const shots = await roll(g.shots);
      log.push(`${g.weapon} Shots left: ${g.shots} = ${shots}`);
      return [{ kind: "gun", name: g.weapon, shots, ammo: g.ammo }];
    }
  }
  return [];
}

const label = f => {
  if (f.kind === "item") return `${f.qty > 1 ? `${f.qty} &times; ` : ""}${esc(f.name)}`;
  if (f.kind === "ammo") return `${esc(f.names.join(" or "))}: ${f.qty} Shots`;
  if (f.kind === "fuel") return `${esc(f.weapon)} fuel: ${f.qty}`;
  return `${esc(f.name)}${f.plus ? "+" : ""} (${f.shots} Shots${f.note ? `, ${f.note}` : " left"})`;
};

function cardHtml({ total, horror, entryText, log, finds, actorName }) {
  const rows = finds.map((f, i) => {
    let buttons = "";
    if (f.given) buttons = `<span class="hint">Given to ${esc(f.given)}</span>`;
    else if (f.kind === "ammo" && f.names.length > 1) buttons = f.names.map(n => `<button type="button" data-ir-give="${i}" data-ir-pick="${esc(n)}">${esc(n)}</button>`).join("");
    else buttons = `<button type="button" data-ir-give="${i}">Give</button>`;
    const notes = [];
    if (f.plus) notes.push("Gun+: it has an upgrade (attachment or extra Tag): GM's choice.");
    if (f.kind === "fuel" && f.weapon === "Chainsaw") notes.push("Refuels a Chainsaw (up to 10).");
    return `<li><b>${label(f)}</b>${notes.map(n => `<br><span class="hint">${n}</span>`).join("")}<div class="ir-buttons">${buttons}</div></li>`;
  }).join("");
  return `<div class="ir-card ir-supplies"><h3>Finding Supplies</h3>
    <div class="ir-math">3d6 = ${total} on Horror ${horror}: ${esc(entryText)}${log.length ? `<br>${log.join("<br>")}` : ""}</div>
    <ul>${rows}</ul>
    ${finds.some(f => !f.given) ? `<div class="ir-buttons"><button type="button" data-ir-give="all">Give all${actorName ? ` to ${esc(actorName)}` : ""}</button></div>` : ""}
    <p class="hint">${actorName ? `Give puts it in ${esc(actorName)}'s inventory.` : "Give puts it in the inventory of the survivor whose token you've selected."}</p></div>`;
}

const entryName = e => typeof e === "string" ? e : ({
  healing: "Healing Item", healingTwice: "Healing Items (roll twice)", useful: "Useful Item", crafting: "Crafting Supplies",
  commonAmmo: "Common Ammo", rareAmmo: "Rare Ammo", uniqueAmmo: "Unique Ammo",
  commonGun: "Common Gun", rareGun: "Rare Gun", uniqueGun: e.weapon ? "Unique Weapon" : "Unique Gun", gun: e.name
}[e.t] + (e.plus ? "+" : "") + (e.x > 1 ? ` x${e.x}` : ""));

/** GM: search a location. */
export async function findSupplies() {
  if (!game.user.isGM) return;
  const horror = game.settings.get(SYS, "horror");
  const pcs = survivors();
  const r = await DialogV2.prompt({
    window: { title: "Finding Supplies", icon: "fa-solid fa-magnifying-glass" },
    content: `<div class="ir-dialog">
      <div class="form-group"><label>Who's searching?</label><select name="actor"><option value="">Decide later (selected token)</option>
        ${pcs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Horror column</label><input type="number" name="horror" value="${horror}" min="1" max="5"></div>
      <p class="hint">Only roll if there's anything to be found. The result is whispered to you.</p></div>`,
    rejectClose: false,
    ok: { label: "Search", icon: "fa-solid fa-magnifying-glass", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object }
  });
  if (!r) return;
  const h = Math.clamp(Number(r.horror) || horror, 1, 5);
  const actor = r.actor ? game.actors.get(r.actor) : null;
  const total = await roll("3d6");
  const entry = FINDING_SUPPLIES[total][horrorColumn(h)];
  const log = [];
  const finds = await resolve(entry, { horror: h, actor, log });
  const data = { total, horror: h, entryText: entryName(entry), log, finds, actorId: actor?.id ?? "", actorName: actor?.name ?? "" };
  return ChatMessage.create({
    speaker: { alias: "Finding Supplies" },
    content: cardHtml(data),
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [SYS]: { supplies: data } }
  });
}

/** Item data for a find: world item, else Equipment compendium (keeps your art), else the starter data. */
const sourceFor = name => itemSource(name);

/** Put one find into a survivor's inventory. Returns a short note. */
export async function give(actor, f, pick) {
  if (f.kind === "item") {
    const src = await sourceFor(f.name);
    if (src.type === "gear") await actor.addToStacks(src, f.qty);
    else await actor.createEmbeddedDocuments("Item", Array.from({ length: f.qty }, () => ({ ...foundry.utils.deepClone(src), system: { ...src.system, inv: { x: -1, y: -1, rot: false }, quick: false } })));
    return `${f.qty > 1 ? `${f.qty} ` : ""}${f.name}`;
  }
  if (f.kind === "ammo") {
    const name = pick ?? f.names[0];
    await actor.addToStacks(await sourceFor(name), f.qty);
    return `${f.qty} ${name}`;
  }
  if (f.kind === "fuel") {
    const saw = actor.items.find(i => i.type === "weapon" && i.name === f.weapon);
    if (!saw) { ui.notifications.warn(`${actor.name} has no ${f.weapon} to refuel.`); return null; }
    const value = Math.min(saw.system.shots.max, saw.system.shots.value + f.qty);
    await saw.update({ "system.shots.value": value });
    return `${f.weapon} refuelled (${value}/${saw.system.shots.max})`;
  }
  // A gun: loaded with the Shots left (up to its capacity); any extra comes as matching ammo.
  const src = await sourceFor(f.name);
  const max = src.system.shots?.max ?? 0;
  const loaded = Math.min(f.shots, max);
  src.system.shots = { value: loaded, max };
  src.system.inv = { x: -1, y: -1, rot: false };
  src.system.quick = false;
  await actor.createEmbeddedDocuments("Item", [src]);
  const extra = f.shots - loaded;
  let note = `${f.name} (${loaded}/${max})`;
  if (extra > 0 && f.ammo?.length) { await actor.addToStacks(await sourceFor(f.ammo[0]), extra); note += ` + ${extra} ${f.ammo[0]}`; }
  return note;
}

/** Give buttons on the Finding Supplies card (GM). */
export function bindSupplyButtons(message, html) {
  const data = message.getFlag?.(SYS, "supplies");
  if (!data) return;
  for (const btn of html.querySelectorAll("[data-ir-give]")) {
    btn.addEventListener("click", async ev => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      const actor = game.actors.get(data.actorId) ?? canvas.tokens?.controlled[0]?.actor;
      if (actor?.type !== "character") return ui.notifications.warn("Pick a survivor: select their token first.");
      const idx = btn.dataset.irGive === "all" ? data.finds.map((f, i) => i).filter(i => !data.finds[i].given) : [Number(btn.dataset.irGive)];
      const notes = [];
      for (const i of idx) {
        const note = await give(actor, data.finds[i], btn.dataset.irPick);
        if (note) { data.finds[i].given = actor.name; notes.push(note); }
      }
      if (!notes.length) return;
      await message.update({ content: cardHtml(data), [`flags.${SYS}.supplies`]: data });
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="ir-card"><h3>${esc(actor.name)} finds something</h3><p>${notes.map(esc).join(", ")}.</p></div>` });
    });
  }
}
