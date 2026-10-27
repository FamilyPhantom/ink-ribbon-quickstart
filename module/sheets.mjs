import { ATTRIBUTES, SKILLS, CONDITIONS, SUPPLIES, TOOLS, ATTACHMENTS, HOLSTERS } from "./config.mjs";
import { removeCondition, manualTurn, grotesque, roar } from "./rules.mjs";
import { ecgContext } from "./ecg.mjs";
import * as infection from "./infection.mjs";
import { rollZombieTrait } from "./scenario.mjs";
import { PACKABLE, COLS, shapeOf, sizeOf, quickFits, resolveInventory, placementUpdate, inventoryContext } from "./inventory.mjs";

/** The item currently being dragged out of an inventory grid (shared by all open sheets). */
/**
 * The item being dragged onto an inventory grid (shared by all open sheets).
 * Add-on modules can start their own drags by setting `current` to
 *   { foreign: true, item, onDrop: (sheet, placement) => ... }
 * The grid then highlights the item's footprint and, on drop, hands over a checked placement:
 *   { zone: "grid", x, y, rot } | { zone: "quick", index } | { zone: "worn" }
 */
export const invDrag = { current: null };

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
const PATH = "systems/ink-ribbon-quickstart/templates";

/* -------------------------------------------- */
/*  Shared actor sheet behaviour                */
/* -------------------------------------------- */

class InkActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ink-ribbon", "sheet", "actor"],
    position: { width: 760, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      switchTab: InkActorSheet.#onTab,
      rollSkill: InkActorSheet.#onRollSkill,
      rollAttribute: InkActorSheet.#onRollAttribute,
      setPip: InkActorSheet.#onSetPip,
      attack: InkActorSheet.#onAttack,
      reload: InkActorSheet.#onReload,
      useItem: InkActorSheet.#onUseItem,
      createItem: InkActorSheet.#onCreateItem,
      editItem: InkActorSheet.#onEditItem,
      deleteItem: InkActorSheet.#onDeleteItem,
      toggleItem: InkActorSheet.#onToggleItem,
      panic: InkActorSheet.#onPanic,
      rest: InkActorSheet.#onRest,
      damage: InkActorSheet.#onDamage,
      relief: InkActorSheet.#onRelief,
      deathDie: InkActorSheet.#onDeathDie,
      endCondition: InkActorSheet.#onEndCondition,
      escape: InkActorSheet.#onEscape,
      startTurn: InkActorSheet.#onStartTurn,
      infBitten: InkActorSheet.#onInfBitten,
      infHour: InkActorSheet.#onInfHour,
      infTen: InkActorSheet.#onInfTen,
      infUp: InkActorSheet.#onInfUp,
      infDown: InkActorSheet.#onInfDown,
      infCure: InkActorSheet.#onInfCure,
      heroic: InkActorSheet.#onHeroic,
      endHeroic: InkActorSheet.#onEndHeroic
    }
  };

  tab = "main";

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.document;
    const s = actor.system;
    ctx.actor = actor;
    ctx.system = s;
    ctx.tab = this.tab;
    ctx.isGM = game.user.isGM;
    ctx.infectionOn = infection.infectionOn();
    ctx.heroic = !!actor.getFlag("ink-ribbon-quickstart", "heroic");
    ctx.attributes = Object.entries(ATTRIBUTES).map(([key, label]) => ({ key, label, value: s.attributes[key] }));
    ctx.skills = Object.entries(SKILLS).map(([key, [label, attr]]) => {
      const training = s.skills[key].training;
      return {
        key, label, attr: attr.slice(0, 3).toUpperCase(), training,
        pips: [1, 2, 3].map(n => ({ n, filled: n <= training }))
      };
    });
    const byType = t => actor.items.filter(i => i.type === t).sort((a, b) => a.sort - b.sort);
    ctx.weapons = byType("weapon").map(i => {
      const prof = actor.weaponProfile?.(i);
      return { item: i, pool: this.#weaponPool(i), damage: prof?.damage ?? i.system.damage, tags: prof?.tags ?? i.system.tags,
        range: i.system.rangeEff ?? i.system.range, mods: (i.system.mods ?? []).map(m => m.name).join(", ") };
    });
    ctx.armour = byType("armour");
    ctx.gear = byType("gear");
    ctx.talents = byType("talent");
    ctx.attacks = byType("attack");
    // Active conditions with a rules summary and a quick action where the rules give one.
    const actionFor = { prone: "Stand up", burning: "Douse" };
    ctx.conditions = CONDITIONS.filter(c => actor.statuses.has(c.id)).map(c => ({
      id: c.id, name: c.name, img: c.img, tip: c.tip ?? "", action: actionFor[c.id], escape: c.id === "caught"
    }));
    return ctx;
  }

  /** Displayed pool for the Combat table: Attribute + Skill - Stress (before situational dice). */
  #weaponPool(item) {
    const s = this.document.system;
    const [skill, attr] = { melee: ["fighting", "strength"], ranged: ["shooting", "agility"], thrown: ["shooting", "strength"] }[item.system.category];
    return s.attributes[attr] + s.skills[skill].training - (s.stress?.value ?? 0);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Inline edits of owned item fields (e.g. Shots, quantity) without opening the item sheet.
    for (const input of this.element.querySelectorAll("[data-item-field]")) {
      input.addEventListener("change", ev => {
        ev.stopPropagation();
        const item = this.document.items.get(input.closest("[data-item-id]").dataset.itemId);
        const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
        item?.update({ [input.dataset.itemField]: value });
      });
    }
  }

  _item(target) {
    return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static #onTab(event, target) { this.tab = target.dataset.irTab; this.render(); }
  static #onRollSkill(event, target) { this.document.rollSkill(target.dataset.skill); }
  static #onRollAttribute(event, target) { this.document.rollAttribute(target.dataset.attribute); }

  /** Click a pip/box: set the field to that number (click the current value again to lower by one). */
  static #onSetPip(event, target) {
    const { field, n } = target.dataset;
    const current = foundry.utils.getProperty(this.document, field);
    const value = Number(n) === current ? Number(n) - 1 : Number(n);
    this.document.update({ [field]: Math.max(0, value) });
  }

  static #onAttack(event, target) { const i = this._item(target); if (i) this.document.rollAttack(i); }
  static #onReload(event, target) { const i = this._item(target); if (i) this.document.reload(i); }
  static #onUseItem(event, target) { const i = this._item(target); if (i) this.document.useGear(i); }
  static #onEditItem(event, target) { this._item(target)?.sheet.render(true); }
  static #onToggleItem(event, target) {
    const i = this._item(target);
    const field = target.dataset.field;
    if (i) i.update({ [field]: !foundry.utils.getProperty(i, field) });
  }
  static async #onDeleteItem(event, target) {
    const i = this._item(target);
    if (i && await foundry.applications.api.DialogV2.confirm({ window: { title: `Delete ${i.name}?` }, content: `<p>Delete <b>${i.name}</b>?</p>`, rejectClose: false })) i.delete();
  }
  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const [item] = await this.document.createEmbeddedDocuments("Item", [{ name: `New ${game.i18n.localize(`TYPES.Item.${type}`)}`, type }]);
    item?.sheet.render(true);
  }
  static #onPanic() { this.document.rollPanic(); }
  static #onStartTurn() { if (game.user.isGM) manualTurn(this.document); }
  static #onInfBitten() { infection.bitten(this.document); }
  static #onInfHour() { infection.hourPasses(this.document); }
  static #onInfTen() { infection.tenMinutes(this.document); }
  static #onInfUp() { infection.setStage(this.document, (this.document.system.infection?.stage ?? 0) + 1); }
  static #onInfDown() { infection.setStage(this.document, (this.document.system.infection?.stage ?? 0) - 1); }
  static #onInfCure() { infection.setStage(this.document, 0, { cure: true }); }
  static #onHeroic() { infection.heroicSacrifice(this.document); }
  static #onEndHeroic() { infection.endSacrifice(this.document); }

  /** Stand up (Prone), douse the flames (Burning), or the GM clearing any condition. */
  static #onEndCondition(event, target) {
    const id = target.dataset.condition;
    if (["prone", "burning"].includes(id) || game.user.isGM) removeCondition(this.document, id);
  }

  /** Caught: action to escape with Strength (Athletics) or Agility (Reflexes). */
  static async #onEscape(event, target) {
    const [attribute, skill] = target.dataset.via === "reflexes" ? ["agility", "reflexes"] : ["strength", "athletics"];
    const res = await this.document.promptTest({ label: "Escape (Caught)", attribute, skill, tn: 4,
      hints: ["Caught by a creature: this is an Opposed Test (the GM compares). Otherwise the GM sets the TN."] });
    if (res?.result.successes) await removeCondition(this.document, "caught");
  }
  static #onRest() { this.document.safeRoomRest(); }
  static #onDamage() { this.document.promptDamage(); }
  static #onDeathDie() { this.document.rollDeathDie(); }

  /** Mark a Stress Relief box; reduce Stress. When all three are marked, they reset. */
  static async #onRelief(event, target) {
    const actor = this.document;
    const key = target.dataset.relief;
    const r = actor.system.reliefs;
    if (r[key]) return actor.update({ [`system.reliefs.${key}`]: false });
    const formula = key === "major" ? "1d6" : "1d3";
    await actor.relieveStress(formula, key === "moment" ? "Take a Moment" : key === "major" ? r.majorText || "Major Stress Relief" : r.minorText || "Minor Stress Relief");
    const marked = { moment: r.moment, minor: r.minor, major: r.major, [key]: true };
    if (marked.moment && marked.minor && marked.major) {
      await actor.update({ "system.reliefs.moment": false, "system.reliefs.minor": false, "system.reliefs.major": false });
      ui.notifications.info("All Stress Reliefs used: they reset.");
    } else {
      await actor.update({ [`system.reliefs.${key}`]: true });
    }
  }
}

/** Why an item can't go in a holster's Quick Slot. */
function holsterWarning(item, type) {
  const h = HOLSTERS[type];
  return `That Quick Slot is a ${h.label}: it holds ${h.needs}${item.type === "weapon" ? ` (${item.name} is Size ${sizeOf(item)})` : ""}.`;
}

/** "Name: text" lines -> paragraphs with the name in bold. Everything is HTML-escaped first. */
function formatAbilities(text = "") {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^([^:]{1,40}):\s*(.*)$/);           // short name before the first colon
    return m ? `<p><b>${esc(m[1])}:</b> ${esc(m[2])}</p>` : `<p>${esc(line)}</p>`;
  }).join("");
}

/* -------------------------------------------- */
/*  Character sheet                             */
/* -------------------------------------------- */

export class InkCharacterSheet extends InkActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["character"],
    actions: {
      selectItem: InkCharacterSheet.#onSelectItem,
      rotateItem: InkCharacterSheet.#onRotateItem,
      wearArmour: InkCharacterSheet.#onWearArmour,
      readyGear: InkCharacterSheet.#onReadyGear,
      craft: InkCharacterSheet.#onCraft,
      splitStack: InkCharacterSheet.#onSplitStack,
      fitAttachment: InkCharacterSheet.#onFitAttachment,
      removeAttachment: InkCharacterSheet.#onRemoveAttachment
    }
  };
  static PARTS = { sheet: { template: `${PATH}/character.hbs`, scrollable: [".ir-body"] } };

  /** Item shown in the inventory's examine panel. */
  selectedItemId = null;

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const s = this.document.system;
    ctx.stressPips = [1, 2, 3, 4, 5, 6].map(n => ({ n, filled: n <= s.stress.value }));
    ctx.ecg = ecgContext(this.document);
    ctx.healthState = ctx.ecg.state;
    ctx.adrenalinePips = Array.from({ length: s.adrenaline.max }, (_, i) => ({ n: i + 1, filled: i < s.adrenaline.value }));
    ctx.useOptions = { none: "No auto effect", heal: "Heal (herb / spray)", healthpack: "Health Pack", adrenaline: "Adrenaline Shot", sedative: "Sedative" };
    if (this.tab === "inventory") ctx.inv = inventoryContext(this.document, this.selectedItemId);
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this.tab === "inventory" && this.isEditable) this.#bindInventory();
  }

  /* ---------------- Inventory: actions ---------------- */

  static #onSelectItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.selectedItemId = this.selectedItemId === id ? null : id;
    this.render();
  }

  /** Rotate in place if it fits, otherwise move to the first spot where the rotated item fits. */
  static async #onRotateItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const r = resolveInventory(this.document);
    const p = r.pos[item.id];
    if (p?.zone !== "grid") return;
    const rot = !p.rot;
    const shape = shapeOf(item, rot);
    r.grid.remove(item.id);
    const unwear = item.type === "armour" ? { "system.equipped": false } : {};
    const spot = r.grid.fits(p.x, p.y, shape) ? { x: p.x, y: p.y } : r.grid.firstFit(shape);
    if (!spot) return ui.notifications.warn(`No room to rotate ${item.name}.`);
    return this._moveItem(item, "grid", { ...spot, rot, strict: true });
  }

  /** Wear one armour (others come off and go back in the grid), or take it off (it's packed into the grid). */
  static async #onWearArmour(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item?.type !== "armour") return;
    const wear = !item.system.equipped;
    const updates = [{ _id: item.id, "system.equipped": wear, "system.quick": false, "system.inv.x": -1 }];
    if (wear) for (const other of this.document.items) {
      if (other.type === "armour" && other.id !== item.id && other.system.equipped) updates.push({ _id: other.id, "system.equipped": false, "system.inv.x": -1 });
    }
    return this.document.updateEmbeddedDocuments("Item", updates);
  }

  /** Ready / put away defensive gear (e.g. Riot Shield). */
  static #onReadyGear(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item?.type === "gear") item.update({ "system.ready": !item.system.ready });
  }

  /** Crafting dialog. From a supply or tool in Examine, it shows the recipes that use it. */
  static #onCraft(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    this.document.promptCraft({ item });
  }

  /** Over its Stack size: split into separate items. */
  static #onSplitStack(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) this.document.splitStack(item);
  }

  /** Gun attachments: fit to a gun / take off. */
  static #onFitAttachment(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) this.document.promptFit(item);
  }
  static #onRemoveAttachment(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) this.document.removeAttachment(item);
  }

  /* ---------------- Inventory: drag & drop ---------------- */

  #bindInventory() {
    const root = this.element.querySelector(".ir-inventory");
    if (!root) return;
    const grid = root.querySelector(".inv-grid");

    // Drag sources: every item tile.
    for (const tile of root.querySelectorAll(".inv-tile[data-item-id]")) {
      tile.addEventListener("dragstart", ev => {
        const item = this.document.items.get(tile.dataset.itemId);
        if (!item) return;
        // Which cell of the item was grabbed, so it lands where the cursor is.
        let dx = 0, dy = 0;
        if (tile.parentElement === grid) {
          const rect = tile.getBoundingClientRect();
          const w = Number(tile.dataset.w), h = Number(tile.dataset.h);
          dx = Math.clamp(Math.floor((ev.clientX - rect.left) / (rect.width / w)), 0, w - 1);
          dy = Math.clamp(Math.floor((ev.clientY - rect.top) / (rect.height / h)), 0, h - 1);
        }
        invDrag.current = { id: item.id, actorUuid: this.document.uuid, dx, dy };
        ev.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
        ev.dataTransfer.effectAllowed = "copyMove";
        ev.stopPropagation();
        requestAnimationFrame(() => tile.classList.add("dragging"));
      });
      tile.addEventListener("dragend", () => {
        invDrag.current = null;
        tile.classList.remove("dragging");
        this.#clearHighlight();
      });
      tile.addEventListener("dblclick", () => this.document.items.get(tile.dataset.itemId)?.sheet.render(true));
    }

    // Drop target: the Stored grid (hit-tested by cursor position, since tiles cover the cells).
    if (grid) {
      grid.addEventListener("dragover", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const t = this.#gridTarget(ev, grid);
        this.#highlight(t);
      });
      grid.addEventListener("dragleave", ev => { if (!grid.contains(ev.relatedTarget)) this.#clearHighlight(); });
      grid.addEventListener("drop", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const t = this.#gridTarget(ev, grid);
        this.#clearHighlight();
        this.#onInvDrop(ev, "grid", t);
      });
    }

    // Drop targets: Quick Item Slots and the Worn armour slot.
    for (const el of root.querySelectorAll(".quick-cell, .inv-worn")) {
      const zone = el.classList.contains("inv-worn") ? "worn" : "quick";
      el.addEventListener("dragover", ev => { ev.preventDefault(); ev.stopPropagation(); el.classList.add("drop-hover"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop-hover"));
      el.addEventListener("drop", ev => {
        ev.preventDefault(); ev.stopPropagation();
        el.classList.remove("drop-hover");
        this.#onInvDrop(ev, zone, { index: Number(el.dataset.index ?? 0) });
      });
    }
  }

  /** The grid cell under the cursor, adjusted by where the item was grabbed. */
  #gridTarget(ev, grid) {
    const rect = grid.getBoundingClientRect();
    const cx = Math.floor((ev.clientX - rect.left) / (rect.width / COLS));
    const cy = Math.floor((ev.clientY - rect.top) / (rect.height / 3));
    const drag = invDrag.current?.foreign || invDrag.current?.actorUuid === this.document.uuid ? invDrag.current : null;
    const item = drag?.foreign ? drag.item : drag && this.document.items.get(drag.id);
    const x = cx - (drag?.dx ?? 0), y = cy - (drag?.dy ?? 0);
    if (!item) return { x, y, shape: { w: 1, h: 1 }, ok: true };
    const r = resolveInventory(this.document);
    const rot = r.pos[item.id]?.zone === "grid" ? r.pos[item.id].rot : item.system.inv.rot;
    const shape = shapeOf(item, rot);
    return { x, y, rot, shape, ok: r.grid.fits(x, y, shape, item.id) };
  }

  #highlight({ x, y, shape, ok }) {
    this.#clearHighlight();
    for (let dy = 0; dy < shape.h; dy++) for (let dx = 0; dx < shape.w; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= 3) continue;
      this.element.querySelector(`.inv-cell[data-i="${cy * COLS + cx}"]`)?.classList.add(ok ? "drop-ok" : "drop-bad");
    }
  }

  /** Public so add-on modules can clear the drop highlight when their drag ends. */
  clearDropHighlight() { this.#clearHighlight(); }

  #clearHighlight() {
    for (const el of this.element.querySelectorAll(".drop-ok, .drop-bad, .drop-hover")) el.classList.remove("drop-ok", "drop-bad", "drop-hover");
  }

  async #onInvDrop(ev, zone, target) {
    const drag = invDrag.current;
    invDrag.current = null;

    // A drag started by an add-on module: check the spot, then let the module do the move.
    if (drag?.foreign) {
      const placement = this.#placementFor(drag.item, zone, target);
      if (placement) return drag.onDrop?.(this, placement);
      return;
    }
    let item = drag?.actorUuid === this.document.uuid ? this.document.items.get(drag.id) : null;

    // Dropped from the sidebar, a compendium or another actor: copy it onto this actor first.
    if (!item) {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if (data?.type !== "Item") return;
      const source = await Item.implementation.fromDropData(data);
      if (!source) return;
      if (!PACKABLE.includes(source.type)) return ui.notifications.warn("Only weapons, armour and gear go in the inventory.");
      if (source.parent === this.document) item = source;
      else {
        const obj = source.toObject();
        delete obj._id;
        foundry.utils.setProperty(obj, "system.inv", { x: -1, y: -1, rot: false });
        foundry.utils.setProperty(obj, "system.quick", false);
        if (obj.type === "armour") foundry.utils.setProperty(obj, "system.equipped", false);
        [item] = await this.document.createEmbeddedDocuments("Item", [obj]);
        if (!item) return;
      }
    }
    return this._moveItem(item, zone, target);
  }

  /** Where an item not yet on this survivor would land (null + warning if it can't go there). */
  #placementFor(item, zone, target) {
    const r = resolveInventory(this.document);
    if (zone === "grid") {
      const rot = item.system.inv?.rot ?? false;
      for (const rr of sizeOf(item) > 1 ? [rot, !rot] : [rot]) {
        if (r.grid.fits(target.x, target.y, shapeOf(item, rr))) return { zone: "grid", x: target.x, y: target.y, rot: rr };
      }
      ui.notifications.warn(`${item.name} doesn't fit there.`);
      return null;
    }
    if (zone === "quick") {
      if (target.index >= r.qmax || r.quick[target.index]) { ui.notifications.warn("That Quick Item Slot isn't free."); return null; }
      if (!quickFits(item, r.types[target.index])) { ui.notifications.warn(holsterWarning(item, r.types[target.index])); return null; }
      if (item.type === "weapon" && item.system.hasTag?.("Heavy")) { ui.notifications.warn(`${item.name} is Heavy: it can't go in a Quick Item Slot.`); return null; }
      return { zone: "quick", index: target.index };
    }
    if (zone === "worn") {
      if (item.type !== "armour") { ui.notifications.warn("Only armour can be worn."); return null; }
      return { zone: "worn" };
    }
    return null;
  }

  /**
   * Move an owned item to the grid ({x, y, rot}), a quick slot ({index}) or the Worn slot.
   * Also saves the current spot of any auto-packed items, so the grid doesn't reshuffle afterwards.
   */
  async _moveItem(item, zone, { x = 0, y = 0, index = 0, rot, strict = false } = {}) {
    const actor = this.document;
    const r = resolveInventory(actor);
    const prev = r.pos[item.id];
    const updates = new Map();
    const set = (id, data) => updates.set(id, { ...(updates.get(id) ?? { _id: id }), ...data });
    for (const [id, p] of Object.entries(r.auto)) set(id, placementUpdate(p));

    r.grid.remove(item.id);
    const unwear = item.type === "armour" ? { "system.equipped": false } : {};

    if (zone === "grid") {
      rot ??= prev?.zone === "grid" ? prev.rot : item.system.inv.rot;
      if (!r.grid.fits(x, y, shapeOf(item, rot))) {
        // Helpful fallback: a 2-wide item dropped where only 2-tall fits gets rotated for you.
        if (!strict && sizeOf(item) > 1 && r.grid.fits(x, y, shapeOf(item, !rot))) rot = !rot;
        else return ui.notifications.warn(`${item.name} doesn't fit there.`);
      }
      set(item.id, { ...placementUpdate({ zone: "grid", x, y, rot }), ...unwear });
    }

    else if (zone === "quick") {
      if (index >= r.qmax) return ui.notifications.warn("That Quick Item Slot is locked (raise Quick Slots).");
      if (!quickFits(item, r.types[index])) return ui.notifications.warn(holsterWarning(item, r.types[index]));
      if (sizeOf(item) <= 0) return ui.notifications.info(`${item.name} doesn't need a slot.`);
      if (item.type === "weapon" && item.system.hasTag("Heavy")) return ui.notifications.warn(`${item.name} is Heavy: it can't go in a Quick Item Slot.`);
      const occupant = r.quick[index];
      if (occupant && occupant !== item.id) {
        // Swap: the occupant takes the dragged item's old quick slot, or the first free grid spot.
        const occ = actor.items.get(occupant);
        if (prev?.zone === "quick" && quickFits(occ, r.types[prev.index])) set(occupant, placementUpdate({ zone: "quick", index: prev.index }));
        else {
          const spot = r.grid.firstFitItem(occ);
          if (!spot) return ui.notifications.warn(`No room in the inventory to swap out ${occ.name}.`);
          set(occupant, placementUpdate({ zone: "grid", ...spot }));
        }
      }
      set(item.id, { ...placementUpdate({ zone: "quick", index }), ...unwear });
    }

    else if (zone === "worn") {
      if (item.type !== "armour") return ui.notifications.warn("Only armour can be worn.");
      for (const id of r.worn) if (id !== item.id) set(id, { "system.equipped": false, "system.inv.x": -1 });
      set(item.id, { "system.equipped": true, "system.quick": false });
    }

    this.selectedItemId = item.id;
    return actor.updateEmbeddedDocuments("Item", [...updates.values()]);
  }
}

/* -------------------------------------------- */
/*  Monster / NPC sheet                         */
/* -------------------------------------------- */

export class InkMonsterSheet extends InkActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["monster"], position: { width: 620, height: 760 },
    actions: {
      fearFirst: InkMonsterSheet.#onFearFirst,
      fearLater: InkMonsterSheet.#onFearLater,
      roar: InkMonsterSheet.#onRoar,
      toggleAbilities: InkMonsterSheet.#onToggleAbilities,
      zombieTrait: InkMonsterSheet.#onZombieTrait
    }
  };

  /** Abilities box: formatted read view, or the text field while editing. */
  editAbilities = false;
  static #onToggleAbilities() { this.editAbilities = !this.editAbilities; this.render(); }
  static #onFearFirst() { if (game.user.isGM) grotesque(this.document, true); }
  static #onFearLater() { if (game.user.isGM) grotesque(this.document, false); }
  static #onRoar() { if (game.user.isGM) roar(this.document); }
  static #onZombieTrait() { rollZombieTrait(this.document); }
  static PARTS = { sheet: { template: `${PATH}/monster.hbs`, scrollable: [".ir-body"] } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enemyTypes = { horde: "Horde", boss: "Boss", nemesis: "Nemesis", ally: "Ally / NPC" };
    ctx.trainedSkills = ctx.skills.filter(sk => sk.training > 0);
    const t = this.document.system.traits;
    ctx.hasFear = t.grotesque || t.roar;
    ctx.isZombie = /zombie/i.test(this.document.name) || /zombie/i.test(this.document.system.tags);
    ctx.traitSummary = [
      t.vsRanged && `+${t.vsRanged} Defence vs ranged`, t.vsMelee && `+${t.vsMelee} Defence vs melee`,
      t.aimForHead && "Aim For the Head", t.backFromDead && `Back From the Dead${t.bftdUsed ? " (used)" : ""}`,
      t.actsLast && "Acts last", t.adrenalineRegen && `+${t.adrenalineRegen} Adrenaline / turn`,
      t.selfHeal && `Self Healing ${t.selfHeal}`, t.extraTurn && "My Turn", t.horrorOnAppear && "Horror +1 on appearing",
      t.mutatesInto && `Mutates into ${t.mutatesInto}${t.mutationChecked ? " (checked)" : ""}`,
      t.grotesque && "Grotesque", t.roar && "Terrifying Roar"
    ].filter(Boolean);
    ctx.editAbilities = this.editAbilities;
    ctx.abilitiesHtml = formatAbilities(this.document.system.abilities);
    const wk = this.document.system.weak;
    ctx.weakPips = Array.from({ length: wk.max }, (_, i) => i < wk.count);
    ctx.conditionOptions = Object.fromEntries([["", "None"], ...CONDITIONS.map(c => [c.id, c.name])]);
    return ctx;
  }
}

/* -------------------------------------------- */
/*  Item sheet (all item types)                 */
/* -------------------------------------------- */

export class InkItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ink-ribbon", "sheet", "item"],
    position: { width: 460, height: 520 },
    window: { resizable: true },
    form: { submitOnChange: true }
  };
  static PARTS = { sheet: { template: `${PATH}/item.hbs` } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.item = this.document;
    ctx.system = this.document.system;
    ctx.type = this.document.type;
    ctx.isType = Object.fromEntries(["weapon", "armour", "gear", "talent", "attack"].map(t => [t, t === this.document.type]));
    ctx.categories = { melee: "Melee (Str + Fighting)", ranged: "Ranged gun (Agi + Shooting)", thrown: "Thrown (Str + Shooting)" };
    ctx.kinds = { melee: "Melee", ranged: "Ranged" };
    ctx.ranges = { Adjacent: "Adjacent", Short: "Short", Medium: "Medium", Long: "Long", Extreme: "Extreme" };
    ctx.useOptions = { none: "No automatic effect", heal: "Heal: restore Toughness + clear ECG boxes", healthpack: "Health Pack (Medicine Test)", adrenaline: "Adrenaline Shot", sedative: "Sedative: Stress -1d3", light: "Light: Losing Light check (not used up)" };
    ctx.supplyOptions = { "": "Not a crafting supply", ...SUPPLIES };
    ctx.holsterOptions = { "": "Not a holster", ...Object.fromEntries(Object.entries(HOLSTERS).map(([k, v]) => [k, v.label])) };
    ctx.attachmentOptions = { "": "Not a gun attachment", ...Object.fromEntries(Object.entries(ATTACHMENTS).map(([k, v]) => [k, v.label])) };
    ctx.source = this.document._source.system;            // raw values (Expanded Mag changes the live Shots max)
    ctx.toolOptions = { "": "Not a crafting tool", ...TOOLS };
    return ctx;
  }
}
