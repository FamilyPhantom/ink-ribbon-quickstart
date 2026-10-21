import { HOLSTERS } from "./config.mjs";

// Resident Evil-style inventory grid.
//
// Storage on each weapon/armour/gear item:
//   system.quick      true = in a Quick Item Slot
//   system.inv.x/y    top-left cell in the Stored grid (x = slot index when quick; -1 = not placed yet)
//   system.inv.rot    rotated 90 degrees (a 2-Slot item becomes 1 wide x 2 tall)
//
// The layout is "resolved" every render: items with a valid saved spot keep it, everything
// else (new items, collisions, a lowered Slot max) is auto-packed into the first free spot.
// Items that can't fit anywhere are shown in the "No room" tray. Slot math is unchanged.

export const COLS = 4;
export const ROWS = 3;
export const MAX_QUICK = 4;
export const PACKABLE = ["weapon", "armour", "gear"];

/** Gun an attachment is fitted to (same actor), or null. Fitted attachments don't take a Slot. */
export function fittedGun(item) {
  const id = item.type === "gear" ? item.system.fittedTo : "";
  const gun = id ? item.parent?.items?.get(id) : null;
  return gun?.type === "weapon" ? gun : null;
}

/** Can this item go in a Quick Slot of this type? ("any", or a holster key: one weapon of the right Size) */
export function quickFits(item, type = "any") {
  const h = HOLSTERS[type];
  if (!h) return true;
  return item.type === "weapon" && h.fits(sizeOf(item));
}

/** Size in Slots, including a fitted Stock (+1, worked out in InkActor.prepareDerivedData). */
export const sizeOf = item => Math.max(0, (item.system.size ?? 0) + (item.system.sizeBonus ?? 0));

/** Footprint of an item: Size cells in a row (wrapping after 4), optionally rotated. */
export function shapeOf(item, rot = item.system.inv?.rot ?? false) {
  const n = Math.max(1, sizeOf(item));
  const w = Math.min(n, COLS);
  const h = Math.ceil(n / COLS);
  return rot ? { w: h, h: w } : { w, h };
}

export class Grid {
  constructor(unlocked) {
    this.unlocked = unlocked;                    // first N cells (row by row) are usable
    this.cells = new Array(COLS * ROWS).fill(null);
  }

  fits(x, y, { w, h }, ignore = null) {
    if (x < 0 || y < 0 || x + w > COLS || y + h > ROWS) return false;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const i = (y + dy) * COLS + x + dx;
      if (i >= this.unlocked) return false;
      const occupant = this.cells[i];
      if (occupant && occupant !== ignore) return false;
    }
    return true;
  }

  place(id, x, y, { w, h }) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.cells[(y + dy) * COLS + x + dx] = id;
  }

  remove(id) {
    this.cells = this.cells.map(c => (c === id ? null : c));
  }

  firstFit(shape, ignore = null) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (this.fits(x, y, shape, ignore)) return { x, y };
    return null;
  }

  /** First spot for an item, trying its current orientation first, then rotated. */
  firstFitItem(item, ignore = null) {
    const rot = item.system.inv?.rot ?? false;
    for (const r of [rot, !rot]) {
      const spot = this.firstFit(shapeOf(item, r), ignore);
      if (spot) return { ...spot, rot: r };
    }
    return null;
  }
}

/**
 * Work out where every carried item sits.
 * Returns { grid, quick[], qmax, worn[], loose[], pos{id: placement}, auto{id: placement} }.
 * `auto` lists items whose displayed spot differs from what's saved (so a move can freeze them).
 */
export function resolveInventory(actor) {
  const s = actor.system;
  const qmax = Math.clamp(s.quickSlots?.total ?? s.quickSlots?.max ?? 2, 0, MAX_QUICK);
  const types = Array.from({ length: MAX_QUICK }, (_, i) => s.quickSlots?.types?.[i] ?? "any");
  const grid = new Grid(Math.clamp(s.slots.total ?? s.slots.max, 0, COLS * ROWS));
  const quick = new Array(MAX_QUICK).fill(null);
  const worn = [], loose = [], pos = {}, auto = {};
  const laterQuick = [], laterGrid = [];

  const items = actor.items.filter(i => PACKABLE.includes(i.type)).sort((a, b) => a.sort - b.sort);
  for (const item of items) {
    const sys = item.system;
    const inv = sys.inv ?? { x: -1, y: -1, rot: false };
    if (item.type === "armour" && sys.equipped) { worn.push(item.id); pos[item.id] = { zone: "worn" }; continue; }  // worn: no Slots
    if (fittedGun(item)) { pos[item.id] = { zone: "fitted" }; continue; }                                         // on a gun: no Slots
    if (sizeOf(item) <= 0 && item.type === "weapon") continue;  // e.g. Unarmed: lives in the Combat table only
    if (sizeOf(item) <= 0) { loose.push({ id: item.id, reason: "free" }); pos[item.id] = { zone: "loose" }; continue; }
    if (sys.quick) {
      if (inv.x >= 0 && inv.x < qmax && !quick[inv.x] && quickFits(item, types[inv.x])) { quick[inv.x] = item.id; pos[item.id] = { zone: "quick", index: inv.x }; }
      else laterQuick.push(item);
      continue;
    }
    const shape = shapeOf(item, inv.rot);
    if (inv.x >= 0 && inv.y >= 0 && grid.fits(inv.x, inv.y, shape)) {
      grid.place(item.id, inv.x, inv.y, shape);
      pos[item.id] = { zone: "grid", x: inv.x, y: inv.y, rot: inv.rot };
    } else laterGrid.push(item);
  }

  for (const item of laterQuick) {
    // A weapon that fits a free holster goes there first, keeping the general Quick Slots free.
    const free = i => !quick[i] && i < qmax && quickFits(item, types[i]);
    let index = quick.findIndex((q, i) => free(i) && types[i] !== "any");
    if (index < 0) index = quick.findIndex((q, i) => free(i));
    if (index >= 0) { quick[index] = item.id; pos[item.id] = auto[item.id] = { zone: "quick", index }; }
    else laterGrid.push(item);                               // no Quick Slot it fits: back into the grid
  }
  for (const item of laterGrid) {
    const spot = grid.firstFitItem(item);
    if (spot) {
      grid.place(item.id, spot.x, spot.y, shapeOf(item, spot.rot));
      pos[item.id] = auto[item.id] = { zone: "grid", ...spot };
    } else { loose.push({ id: item.id, reason: "noroom" }); pos[item.id] = { zone: "loose" }; }
  }
  return { grid, quick, qmax, types, worn, loose, pos, auto };
}

/** Item update data for a placement. */
export function placementUpdate(p) {
  if (p.zone === "quick") return { "system.quick": true, "system.inv.x": p.index };
  return { "system.quick": false, "system.inv.x": p.x, "system.inv.y": p.y, "system.inv.rot": !!p.rot };
}

/** Short corner badge, like RE's ammo counter. */
function badgeFor(item) {
  const s = item.system;
  if (item.type === "weapon" && s.shots?.max) return `${s.shots.value}/${s.shots.max}`;
  if (item.type === "gear" && s.quantity !== 1) return `x${s.quantity}${s.stack > 0 && s.quantity > s.stack ? "!" : ""}`;
  if (item.type === "armour") return `AR ${s.rating}`;
  return "";
}

function bonusText(item) {
  const s = item.system;
  return [s.slotBonus ? `+${s.slotBonus} Slots` : "", s.quickBonus ? `+${s.quickBonus} Quick` : ""].filter(Boolean).join(", ");
}

function tileFor(item, selectedId, extra = {}) {
  return {
    id: item.id, name: item.name, img: item.img, type: item.type,
    badge: badgeFor(item), selected: item.id === selectedId,
    worn: item.type === "armour" && item.system.equipped, ready: item.type === "gear" && item.system.ready, bonus: item.system.slotBonus || item.system.quickBonus ? bonusText(item) : "", ...extra
  };
}

/** Tile view data (name, image, corner badge) for a list of items, e.g. for an add-on's item panel. */
export function itemTiles(items) {
  return [...items].filter(i => PACKABLE.includes(i.type)).sort((a, b) => a.name.localeCompare(b.name))
    .map(i => ({ id: i.id, name: i.name, img: i.img, type: i.type, badge: badgeFor(i) }));
}

/** View data for the template. */
export function inventoryContext(actor, selectedId) {
  const r = resolveInventory(actor);
  const get = id => actor.items.get(id);

  const cells = r.grid.cells.map((_, i) => ({ i, col: (i % COLS) + 1, row: Math.floor(i / COLS) + 1, locked: i >= r.grid.unlocked }));
  const tiles = Object.entries(r.pos).filter(([, p]) => p.zone === "grid").map(([id, p]) => {
    const item = get(id);
    const { w, h } = shapeOf(item, p.rot);
    return tileFor(item, selectedId, { col: p.x + 1, row: p.y + 1, w, h, rot: !!p.rot });
  });
  const quick = r.quick.map((id, i) => ({ i, locked: i >= r.qmax, tile: id ? tileFor(get(id), selectedId) : null,
    holster: i < r.qmax ? HOLSTERS[r.types[i]]?.short ?? "" : "", holsterTip: i < r.qmax && HOLSTERS[r.types[i]] ? `${HOLSTERS[r.types[i]].label}: ${HOLSTERS[r.types[i]].needs}` : "" }));
  const reasons = { free: "No Slot needed", noquick: "No free Quick Slot", noroom: "No room!" };
  const worn = r.worn.map(id => tileFor(get(id), selectedId));
  const loose = r.loose.map(({ id, reason }) => tileFor(get(id), selectedId, { reason: reasons[reason], over: reason !== "free" }));

  let selected = null;
  const sel = selectedId && get(selectedId);
  if (sel && PACKABLE.includes(sel.type)) {
    const s = sel.system;
    const meta = [game.i18n.localize(`TYPES.Item.${sel.type}`), `Size ${sizeOf(sel)}`];
    if (sel.type === "weapon") meta.push(`Dmg ${(s.loaded && s.loadedDamage) || s.damage}`, s.rangeEff ?? s.range);
    if (sel.type === "weapon" && s.loaded && (s.loadedDamage || s.loadedTags)) meta.push(`Loaded: ${s.loaded}`);
    if (sel.type === "armour") meta.push(`Armour ${s.rating}`, s.equipped ? "Worn" : "Not worn");
    if (sel.type === "gear" && s.defenceBonus) meta.push(`Defence ${s.defenceBonus > 0 ? "+" : ""}${s.defenceBonus}`);
    if (sel.type === "gear" && s.reflexesBonus) meta.push(`Reflexes +${s.reflexesBonus} dice`);
    if (sel.type === "gear" && (s.defenceBonus || s.reflexesBonus)) meta.push(s.ready ? "Ready" : "Put away");
    if (sel.type === "gear" && s.stack > 1) meta.push(`Stack ${s.quantity}/${s.stack}`);
    if (sel.type === "gear" && s.stack === 1) meta.push("Doesn't stack");
    if (sel.type === "gear" && s.supply) meta.push("Crafting supply");
    if (sel.type === "gear" && s.tool) meta.push("Crafting tool");
    if (sel.type === "gear" && s.halfStrength) meta.push("Half strength");
    const bonus = bonusText(sel);
    if (bonus) meta.push(bonus);
    selected = {
      item: sel, system: s, meta: meta.join(" · "),
      isWeapon: sel.type === "weapon", isGear: sel.type === "gear", isArmour: sel.type === "armour",
      canUse: sel.type === "gear" && !!s.use && s.use !== "none",
      canReady: sel.type === "gear" && !!(s.defenceBonus || s.reflexesBonus),
      canReload: sel.type === "weapon" && s.shots.max > 0,
      canCraft: sel.type === "gear" && !!(s.supply || s.tool),
      overStack: sel.type === "gear" && s.stack > 0 && s.quantity > s.stack,
      isAttachment: sel.type === "gear" && !!s.attachment,
      mods: sel.type === "weapon" ? (s.mods ?? []) : [],
      useLabel: s.use === "light" ? "Light check" : "Use",
      canRotate: sizeOf(sel) > 1 && r.pos[sel.id]?.zone === "grid"
    };
  }

  const heavy = actor.items.filter(i => i.type === "weapon" && i.system.hasTag?.("Heavy")).length;
  const strength = actor.system.attributes?.strength ?? 0;
  return {
    heavy, heavyOver: heavy > strength, strength,
    cells, tiles, quick, worn, loose, selected,
    quickUsed: r.quick.filter(Boolean).length, qmax: r.qmax, extraHolsters: actor.system.quickSlots?.extraHolsters ?? 0,
    hasOverflow: loose.some(l => l.over)
  };
}
