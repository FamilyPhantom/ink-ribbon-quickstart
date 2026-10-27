import { ATTRIBUTES, SKILLS, CONDITIONS, panicEffect, deathResult, SUPPLIES, TOOLS, TOOL_ADVANTAGE, RECIPES, CRAFT_FAILURE, ATTACHMENTS, RANGE_BANDS, HOLSTERS, MAX_HOLSTERS } from "./config.mjs";
import { showRoll } from "./dice.mjs";
import { addCondition, removeCondition, damageButton, conditionButton, hitWeakPoint, mutate } from "./rules.mjs";
import { ITEMS } from "./starter.mjs";
import { resolveInventory, fittedGun, sizeOf } from "./inventory.mjs";
import { isSafeRoomOpen, safeRoomNoTest } from "./safeRoom.mjs";
import { snapOutOfMalaise } from "./infection.mjs";

const { DialogV2 } = foundry.applications.api;
const SYS = "ink-ribbon-quickstart";

export const getHorror = () => game.settings.get(SYS, "horror");

/** Small helper: open a DialogV2 form and return its values as an object (or null if closed). */
async function formDialog(title, content, label = "Roll") {
  return DialogV2.prompt({
    window: { title },
    content,
    rejectClose: false,
    ok: { label, callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
  });
}

/** Ammo names a weapon reloads from ("Explosive Rounds, Flame Rounds"), lowercase. */
const ammoList = w => (w.ammo ?? "").split(",").map(a => a.trim().toLowerCase()).filter(Boolean);

function chat(actor, content, extra = {}) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, ...extra });
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


/** "Green Flower x2 + Resources" */
export const ingredientText = inputs =>
  Object.entries(inputs).map(([k, n]) => `${SUPPLIES[k] ?? k}${n > 1 ? ` &times;${n}` : ""}`).join(" + ");

export class InkActor extends Actor {

  /* -------------------------------------------- */
  /*  Data preparation                            */
  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData();
    const s = this.system;
    if (!["character", "monster", "npc"].includes(this.type)) return;   // e.g. module-added actor types

    // Weapons: attachments fitted to them (Silencer, Scope, Stock, Expanded Mag), from source values so it never stacks up.
    for (const w of this.items.filter(i => i.type === "weapon")) {
      const mods = this.items.filter(i => fittedGun(i) === w);
      const has = key => mods.some(m => m.system.attachment === key);
      const src = w._source.system;
      w.system.mods = mods.map(m => ({ id: m.id, name: m.name, key: m.system.attachment, botched: m.system.halfStrength }));
      w.system.shots.max = has("mag") ? Math.floor(src.shots.max * 1.5) : src.shots.max;
      w.system.sizeBonus = has("stock") ? 1 : 0;
      w.system.silenced = has("silencer") || has("makeshiftSilencer");
      w.system.scoped = has("scope") || has("infrared");
      const band = RANGE_BANDS.indexOf(src.range);
      w.system.rangeEff = w.system.scoped && band >= 0 && band < 3 ? RANGE_BANDS[band + 1] : src.range;
    }

    // Characters: Armour = best equipped armour item + bonus.
    if (this.type === "character") {
      const worn = this.items.filter(i => i.type === "armour" && i.system.equipped).map(i => i.system.rating);
      s.armour.value = s.armour.bonus + Math.max(0, ...worn);
      // Slots: carried items use their Size; Quick items, worn armour and fitted attachments don't.
      s.slots.used = this.items
        .filter(i => ["weapon", "armour", "gear"].includes(i.type) && !i.system.quick && !(i.type === "armour" && i.system.equipped) && !fittedGun(i))
        .reduce((n, i) => n + sizeOf(i), 0);
      // Gear like a Backpack raises the maximum while carried.
      const gear = this.items.filter(i => i.type === "gear");
      s.slots.bonus = gear.reduce((n, i) => n + (i.system.slotBonus ?? 0), 0);
      s.slots.total = Math.clamp(s.slots.max + s.slots.bonus, 0, 12);
      s.slots.over = s.slots.used > s.slots.total;
      s.quickSlots.bonus = gear.reduce((n, i) => n + (i.system.quickBonus ?? 0), 0);
      // Holsters: up to 2 (any combination), each one Quick Slot for a weapon of the right Size. Max 4 Quick Slots in all.
      const holsters = gear.filter(i => HOLSTERS[i.system.holster]).sort((a, b) => a.sort - b.sort);
      const holsterKeys = holsters.slice(0, MAX_HOLSTERS).map(i => i.system.holster);
      const general = Math.clamp((s.quickSlots.max ?? 2) + s.quickSlots.bonus, 0, 4 - holsterKeys.length) || 0;
      s.quickSlots.types = [...Array(general).fill("any"), ...holsterKeys];
      s.quickSlots.total = s.quickSlots.types.length;
      s.quickSlots.extraHolsters = Math.max(0, holsters.length - MAX_HOLSTERS);

      // Talents with fixed bonuses (Hard to Kill, Nimble...).
      const talents = this.items.filter(i => i.type === "talent");
      const tTough = talents.reduce((n, i) => n + (i.system.toughness ?? 0), 0);
      const tDef = talents.reduce((n, i) => n + (i.system.defence ?? 0), 0);
      s.toughness.max += tTough;
      s.defence.value += tDef;
      s.defence.talents = tDef;

      // Readied defensive gear (e.g. Riot Shield) adds to Defence.
      const ready = gear.filter(i => i.system.ready);
      s.defence.gear = ready.reduce((n, i) => n + (i.system.defenceBonus ?? 0), 0);
      s.defence.value += s.defence.gear;
      s.readyGear = ready.map(i => i.name);
    }

    // Conditions change Defence (both PCs and monsters).
    let forced = null;
    for (const c of CONDITIONS) {
      if (!this.statuses.has(c.id)) continue;
      if (c.defence) s.defence.value += c.defence;
      if (c.setDefence) forced = c.setDefence;
    }
    if (forced !== null) s.defence.value = forced;
    s.defence.value = Math.clamp(s.defence.value, 1, 6);
  }

  /* -------------------------------------------- */
  /*  Tests                                       */
  /* -------------------------------------------- */

  /** Dice removed by Conditions (and Injured) for a given test. Returns { total, reasons[] }. */
  conditionPenalty(attribute, isAttack, skill = null) {
    let total = 0;
    const reasons = [], hints = [];
    for (const c of CONDITIONS) {
      if (!this.statuses.has(c.id)) continue;
      // attackPool and skillPool don't stack (e.g. Blinded: -2 on an attack, not -4).
      const situational = Math.max(isAttack ? (c.attackPool ?? 0) : 0, skill ? (c.skillPool?.[skill] ?? 0) : 0);
      const n = (c.pool ?? 0) + situational;
      if (n) { total += n; reasons.push(`${c.name} -${n}`); }
      if (c.hint) hints.push(c.hint);
    }
    if (this.system.injured && ["strength", "agility"].includes(attribute)) {
      total += 1; reasons.push("Injured -1");
    }
    return { total, reasons, hints };
  }

  /**
   * Core Ink Ribbon Test.
   * pool = (Attribute + Training + Advantages + bonus) x2 if Adrenaline, then - Complications - Stress.
   * Pool of 0 or less: roll 1 die, only a 6 succeeds.
   */
  async rollTest({ label, attribute, skill = null, tn = 4, advantage = 0, complication = 0,
                   adrenaline = false, ignoreStress = 0, useBanked = false, fixedPool = null, flavorExtra = "" }) {
    const s = this.system;

    if (adrenaline) {
      if (s.adrenaline.value < 1) { ui.notifications.warn(`${this.name} has no Adrenaline.`); adrenaline = false; }
      else await this.update({ "system.adrenaline.value": s.adrenaline.value - 1 });
    }
    if (useBanked && s.bankedDie) await this.update({ "system.bankedDie": false });
    else useBanked = false;

    const attrValue = attribute ? (s.attributes[attribute] ?? 0) : 0;
    const training = skill ? (s.skills[skill]?.training ?? 0) : 0;
    const stress = Math.max(0, (s.stress?.value ?? 0) - ignoreStress);

    let base = fixedPool ?? (attrValue + training);
    base += advantage + (useBanked ? 1 : 0);
    if (adrenaline) base *= 2;
    let pool = base - complication - stress;

    const parts = [fixedPool !== null ? `Pool ${fixedPool}` : `${ATTRIBUTES[attribute] ?? "?"} ${attrValue}`];
    if (skill && fixedPool === null) parts.push(`${SKILLS[skill][0]} +${training}`);
    if (advantage) parts.push(`Adv +${advantage}`);
    if (useBanked) parts.push("Banked +1");
    if (adrenaline) parts.push("<b>x2 Adrenaline</b>");
    if (complication) parts.push(`Comp -${complication}`);
    if (stress) parts.push(`Stress -${stress}`);

    let target = tn, desperate = false;
    if (pool <= 0) { pool = 1; target = 6; desperate = true; }

    const roll = await new Roll(`${pool}d6`).evaluate();
    const successes = roll.dice[0].results.filter(r => r.result >= target).length;
    const extras = Math.max(0, successes - 1);

    let outcome = successes
      ? `<div class="ir-result success">SUCCESS${extras ? ` &mdash; ${extras} extra` : ""}</div>`
      : `<div class="ir-result failure">FAILURE</div>`;
    if (extras >= 2) outcome += `<div class="ir-hint">2 extra: may bank a die${extras >= 3 ? " &bull; 3 extra: may reduce Stress by 1d3" : ""}</div>`;

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>${label}</h3>
        <div class="ir-math">${parts.join(" &bull; ")} = <b>${pool}d6</b> vs TN ${tn}${desperate ? " (pool 0: one die, 6 only)" : ""}</div>
        ${flavorExtra}${outcome}</div>`
    });
    return { successes, extras, roll };
  }

  /** Open the roll dialog with everything pre-filled, then roll. */
  async promptTest({ label, attribute, skill = null, tn = 4, isAttack = false, fixedPool = null, extraFields = "", complication = 0, complicationReason = "",
                     advantage: extraAdv = 0, advantageReasons = [], hints: extraHints = [], modify = null }) {
    const s = this.system;
    const pen = this.conditionPenalty(attribute, isAttack, skill);
    if (complication) { pen.total += complication; pen.reasons.push(complicationReason || `+${complication}`); }
    pen.hints.push(...extraHints);
    const noAdrenaline = CONDITIONS.some(c => c.noAdrenaline && this.statuses.has(c.id));
    const attrOptions = Object.entries(ATTRIBUTES)
      .map(([k, v]) => `<option value="${k}" ${k === attribute ? "selected" : ""}>${v} (${s.attributes[k]})</option>`).join("");
    const isPC = this.type === "character";

    // Pre-filled Advantages: attack situation, readied gear (Riot Shield), Talents (Nimble).
    let advantage = extraAdv;
    const advReasons = [...advantageReasons];
    if (isPC && skill === "reflexes") {
      for (const g of this.items.filter(i => i.type === "gear" && i.system.ready && i.system.reflexesBonus)) {
        advantage += g.system.reflexesBonus;
        advReasons.push(`${g.name} +${g.system.reflexesBonus} (only when avoiding danger)`);
      }
    }
    let ignoreStress = 0;
    const talentNotes = [];
    if (isPC && skill) for (const t of this.items.filter(i => i.type === "talent")) {
      const ts = t.system;
      if (ts.ignoreStress && ts.ignoreSkills.split(",").map(k => k.trim()).includes(skill)) {
        ignoreStress = Math.max(ignoreStress, ts.ignoreStress);
        talentNotes.push(`${t.name}: ignore ${ts.ignoreStress} Stress`);
      }
      if (ts.advantage && ts.advSkill === skill) {
        advantage += ts.advantage;
        advReasons.push(`${t.name} +${ts.advantage}${ts.advNote ? ` (${ts.advNote})` : ""}`);
      }
    }
    // Will to Live: Advantage on every Test at 0 Toughness while in Caution or Danger.
    if (isPC && s.toughness.value <= 0 && ["Caution", "Danger"].includes(s.ecg.state)) {
      for (const t of this.items.filter(i => i.type === "talent" && i.system.lowAdvantage > 0)) {
        advantage += t.system.lowAdvantage;
        advReasons.push(`${t.name} +${t.system.lowAdvantage} (0 Toughness, ${s.ecg.state})`);
      }
    }

    const content = `<div class="ir-dialog">
      ${fixedPool === null ? `<div class="form-group"><label>Attribute</label><select name="attribute">${attrOptions}</select></div>` : ""}
      <div class="form-group"><label>Target Number</label><input type="number" name="tn" value="${tn}" min="2" max="6"></div>
      <div class="form-group"><label>Advantages (+dice)</label><input type="number" name="advantage" value="${advantage}" min="0"></div>
      ${advReasons.length ? `<p class="hint">Pre-filled from: ${advReasons.join(", ")}. Remove any that don't apply.</p>` : ""}
      <div class="form-group"><label>Complications (-dice)</label><input type="number" name="complication" value="${pen.total}" min="0"></div>
      ${pen.reasons.length ? `<p class="hint">Pre-filled from: ${pen.reasons.join(", ")}</p>` : ""}
      ${pen.hints.map(h => `<p class="hint">${h}</p>`).join("")}
      ${isPC ? `<div class="form-group"><label>Ignore Stress (Talent)</label><input type="number" name="ignoreStress" value="${ignoreStress}" min="0" max="6"></div>
        ${talentNotes.length ? `<p class="hint">${talentNotes.join(", ")}</p>` : ""}` : ""}
      ${s.adrenaline.value > 0 && !noAdrenaline ? `<div class="form-group"><label>Spend 1 Adrenaline: double pool (${s.adrenaline.value} left)</label><input type="checkbox" name="adrenaline"></div>` : ""}
      ${s.adrenaline.value > 0 && noAdrenaline ? `<p class="hint">Can't use Adrenaline right now (Incapacitated).</p>` : ""}
      ${isPC && s.bankedDie ? `<div class="form-group"><label>Use banked die</label><input type="checkbox" name="useBanked"></div>` : ""}
      ${extraFields}
    </div>`;

    const r = await formDialog(label, content);
    if (!r) return null;
    // Choices made in the dialog (headshot, weak point...) can change the TN and label.
    const mod = modify?.(r) ?? {};
    return {
      form: r,
      result: await this.rollTest({
        label: mod.label ?? label, skill: mod.skill ?? skill, fixedPool, flavorExtra: mod.note ?? "",
        attribute: r.attribute ?? attribute,
        tn: mod.tn ?? Number(r.tn), advantage: Number(r.advantage) + (mod.advantage ?? 0),
        complication: Number(r.complication) + (mod.complication ?? 0),
        ignoreStress: Number(r.ignoreStress ?? 0), adrenaline: !!r.adrenaline, useBanked: !!r.useBanked
      })
    };
  }

  rollSkill(skill) {
    const [label, attribute] = SKILLS[skill];
    return this.promptTest({ label: `${label} Test`, attribute, skill });
  }

  rollAttribute(attribute) {
    return this.promptTest({ label: `${ATTRIBUTES[attribute]} Test`, attribute });
  }

  /* -------------------------------------------- */
  /*  Attacks                                     */
  /* -------------------------------------------- */

  /** A weapon's working profile: damage and Tags with the loaded round and fitted attachments applied. */
  weaponProfile(item) {
    const w = item.system;
    if (item.type !== "weapon") return { damage: w.damage, has: () => false, tags: "" };
    let tags = [...new Set(`${w.tags},${w.loaded ? w.loadedTags : ""}`.split(",").map(t => t.trim()).filter(Boolean))];
    if (w.silenced) tags = tags.filter(t => t.toLowerCase() !== "loud");      // Silencer: no Loud Tag
    const has = tag => {
      const t = tag.toLowerCase();
      return tags.some(x => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t} (`));
    };
    return { damage: (w.loaded && w.loadedDamage) || w.damage, has, tags: tags.join(", ") };
  }

  /** Attack with a weapon (PC) or a stat-block attack (monster). TN = targeted token's Defence (+ its traits). */
  async rollAttack(item) {
    const target = game.user.targets.first();
    const tActor = target?.actor;
    const ts = tActor?.system ?? {};
    const traits = ts.traits ?? {};
    const w = item.system;
    const isWeapon = item.type === "weapon";
    const prof = this.weaponProfile(item);
    const tag = t => isWeapon && prof.has(t);
    const usesShots = isWeapon && w.shots.max > 0 && !w.singleUse;   // guns, and fuel for a Chainsaw
    let attribute, skill, fixedPool = null, isRanged;

    if (item.type === "attack") {
      fixedPool = w.pool; isRanged = w.kind === "ranged";
      attribute = isRanged ? "agility" : "strength";
      if (w.noTest) return this.#damageCard(item, w.damage, 0, { target, notes: ["No Test needed."] });
    } else {
      isRanged = w.category !== "melee";
      [skill, attribute] = { melee: ["fighting", "strength"], ranged: ["shooting", "agility"], thrown: ["shooting", "strength"] }[w.category];
      if (usesShots && w.shots.value < 1)
        return ui.notifications.warn(`${item.name} is out of ${w.category === "melee" ? "fuel" : "Shots"}. Reload first.`);
    }
    const explosive = tag("Explosive");
    const isGun = isWeapon && w.category === "ranged";

    // Target Number: Defence + the target's vs-ranged / vs-melee trait. Explosives target a Zone at TN 3.
    const defence = ts.defence?.value ?? 4;
    const clampTN = n => Math.clamp(n, 2, 6);
    const tnFor = ranged => explosive ? 3 : clampTN(defence + (ranged ? (traits.vsRanged ?? 0) : (traits.vsMelee ?? 0)));
    const tn = tnFor(isRanged);
    const hints = [];
    const rangeMod = isRanged ? (traits.vsRanged ?? 0) : (traits.vsMelee ?? 0);
    if (explosive) hints.push("Explosive: targets a Zone at TN 3. Everyone else in the Zone takes half the base damage.");
    else if (rangeMod) hints.push(`${tActor.name}: ${rangeMod > 0 ? "+" : ""}${rangeMod} Defence vs ${isRanged ? "ranged" : "melee"} attacks (included).`);

    // Prone target: Adjacent attackers +2 dice; ranged attackers -1/-2/-3 dice by range.
    let advantage = 0, complication = 0;
    const advantageReasons = [], compReasons = [];
    if (tActor?.statuses.has("prone") && !explosive) {
      if (isRanged) { complication += 1; compReasons.push("Target Prone, Short Range -1"); hints.push("Target Prone: -1 die at Short Range (pre-filled), -2 at Medium, -3 at Long."); }
      else { advantage += 2; advantageReasons.push("Target Prone +2 (Adjacent)"); }
    }
    // Two-handed with a Riot Shield (or other held gear) ready: two Complications.
    const held = this.items.filter(i => i.type === "gear" && i.system.ready);
    if (tag("Two-handed") && held.length) { complication += 2; compReasons.push(`Two-handed with ${held[0].name} ready -2`); }

    // Gun attachments: Stock (+1), Scope (+1 on a Long Range gun, otherwise +1 Range Band), botched Makeshift Silencer.
    const mods = isGun ? (w.mods ?? []) : [];
    const mod = key => mods.find(m => m.key === key);
    if (mod("stock")) { advantage += 1; advantageReasons.push("Stock +1"); }
    if (w.scoped && item._source.system.range === "Long") { advantage += 1; advantageReasons.push("Scope on a Long Range gun +1"); }
    else if (w.scoped) hints.push(`Scope: Range Band ${item._source.system.range} &rarr; ${w.rangeEff}.`);
    if (mod("infrared")) hints.push("Infrared Scope: can remove Complications caused by smoke or darkness.");
    if (mod("makeshiftSilencer")?.botched) { complication += 1; compReasons.push("Botched Makeshift Silencer -1"); }
    if (w.silenced && isWeapon && w.hasTag("Loud")) hints.push(`Silenced: ${item.name} isn't Loud.`);
    if (isWeapon && w.loaded && (w.loadedDamage || w.loadedTags)) hints.push(`Loaded: ${w.loaded} (${prof.damage} damage${w.loadedTags ? `, ${w.loadedTags}` : ""}).`);

    // Dialog extras.
    const headMod = isRanged ? 2 : 1;
    const box = (name, text) => `<div class="form-group"><label>${text}</label><input type="checkbox" name="${name}"></div>`;
    let extraFields = "";
    if (traits.aimForHead && !explosive) extraFields += box("headshot", `Aim for the head (TN +${headMod} / +2 if thrown or shot, double damage)`);
    if (ts.weak?.count > 0 && !explosive) extraFields += box("weak", `Target ${ts.weak.label} (TN ${ts.weak.tn}, ${ts.weak.count} left)`);
    const throwable = isWeapon && w.category === "melee" && tag("Thrown");
    if (throwable) extraFields += box("throw", "Throw it (Strength + Shooting)");
    if (tag("Two-handed") && !held.length) extraFields += box("oneHand", "Using it one-handed (+2 Complications)");
    if (isGun && !tag("Up Close")) extraFields += box("adjacent", "Target is Adjacent (+1 Complication; Up Close guns ignore this)");
    if (isGun && tag("Up Close")) hints.push("Up Close: no Complication for attacking an Adjacent enemy.");
    const maxAuto = isGun && tag("Full-auto") ? Math.max(0, w.shots.value - 1) : 0;
    if (maxAuto) extraFields += `<div class="form-group"><label>Full-auto: extra Shots (+1 die each, max ${maxAuto})</label><input type="number" name="auto" value="0" min="0" max="${maxAuto}"></div>`;

    const label = `${item.name} attack${target ? ` vs ${target.name}` : ""}`;
    const res = await this.promptTest({
      label, attribute, skill, tn, isAttack: true, fixedPool, extraFields, hints,
      advantage, advantageReasons, complication, complicationReason: compReasons.join(", "),
      modify: f => {
        const m = { advantage: 0, complication: 0 };
        const thrown = !!f.throw;
        const ranged = isRanged || thrown;
        let t = Number(f.tn);
        if (thrown) { m.skill = "shooting"; t = tnFor(true) + (t - tn); }   // keep any manual TN change
        if (f.weak) { t = ts.weak.tn; m.label = `${label} (${ts.weak.label})`; }
        else if (f.headshot) { t += ranged ? 2 : 1; m.label = `${label} (headshot)`; }
        m.tn = clampTN(t);
        if (f.oneHand) m.complication += 2;
        if (f.adjacent) m.complication += 1;
        m.advantage += Math.clamp(Number(f.auto ?? 0), 0, maxAuto);
        return m;
      }
    });
    if (!res) return;
    const f = res.form;
    const { successes, extras } = res.result;
    const headshot = !!f.headshot && !f.weak;
    const weak = !!f.weak;
    const autoShots = Math.clamp(Number(f.auto ?? 0), 0, maxAuto);

    // Spend Shots / use up single-use weapons / Brittle / Loud.
    const notes = [];
    if (usesShots) {
      const left = w.shots.value - 1 - autoShots;
      await item.update({ "system.shots.value": left });
      if (autoShots) notes.push(`Full-auto: ${autoShots} extra Shot(s) for +${autoShots} dice.`);
      if (left === 0 && !isGun) notes.push(`${item.name} is out of fuel.`);
      else if (left === 0) {
        // Rules p.38: a gun runs out of Shots with no more ammo for it in the Inventory = 1 Stress.
        const names = ammoList(w);
        const hasAmmo = names.length && this.items.some(i => i.type === "gear" && names.includes(i.name.toLowerCase()) && i.system.quantity > 0);
        if (names.length && !hasAmmo) { notes.push(`${item.name} is empty and there's no ${w.ammo} left: <b>+1 Stress</b>.`); await this.gainStress(1); }
        else if (!names.length) notes.push(`${item.name} is empty! If there's no ammo for it in the Inventory, gain 1 Stress.`);
        else notes.push(`${item.name} is empty. Reload (action).`);
      }
    }
    // Makeshift Silencer: good for a single Shot, then it breaks.
    const makeshift = mod("makeshiftSilencer");
    if (makeshift) { notes.push(`The Makeshift Silencer breaks after this Shot.`); await this.items.get(makeshift.id)?.delete(); }
    if (tag("Loud")) notes.push("Loud: everyone (and everything) within Long Range hears it.");
    if (f.throw) notes.push(`${item.name} is thrown: it's no longer in hand.`);
    let breaks = false, brittleRoll = null;
    if (tag("Brittle")) {
      brittleRoll = await new Roll("1d6").evaluate();
      breaks = brittleRoll.total <= getHorror();
      if (breaks) notes.push(`Brittle: rolled ${brittleRoll.total} &le; Horror. <b>${item.name} breaks!</b> +1 Stress.`);
    }
    if (isWeapon && w.singleUse) notes.push(`${item.name} is used up.`);
    if (isWeapon && w.category === "thrown" && w.description) notes.push(`<i>${w.description}</i>`);

    if (successes) await this.#damageCard(item, prof.damage + extras, extras, { target, notes, headshot, weak, explosive, prof });
    else if (notes.length) await chat(this, `<div class="ir-card"><h3>${item.name}: miss</h3>${notes.map(n => `<p>${n}</p>`).join("")}</div>`);
    if (brittleRoll) await showRoll(brittleRoll, this, `${item.name}: Brittle check`,
      `1d6 = ${brittleRoll.total} vs Horror ${getHorror()}: ${breaks ? `<b class="failure">it breaks!</b> +1 Stress.` : "it holds."}`);
    if (breaks) await this.gainStress(1);
    if (breaks || (isWeapon && w.singleUse)) await item.delete();
  }

  /** Chat card for a hit: damage button plus any on-hit conditions and splash damage. */
  async #damageCard(item, base, extras, { target, notes = [], headshot = false, weak = false, explosive = false, prof = this.weaponProfile(item) }) {
    const w = item.system;
    const isWeapon = item.type === "weapon";
    const inferior = isWeapon && prof.has("Inferior");
    const dmg = headshot ? base * 2 : base;
    const mode = inferior ? "inferior" : "normal";
    const flags = {};
    if (headshot) flags.headshot = 1;
    if (weak) flags.weak = 1;
    if (item.type === "attack" && w.lethal) flags.lethal = 1;

    let buttons = damageButton(`Apply ${dmg} damage`, dmg, mode, flags);
    if (explosive) buttons += damageButton(`${Math.floor(prof.damage / 2)} to rest of Zone`, Math.floor(prof.damage / 2), mode, { label: "Explosive" });
    if (isWeapon && prof.has("Spray")) buttons += damageButton(`Spray: ${Math.floor(dmg / 2)} to Adjacent`, Math.floor(dmg / 2), mode, { label: "Spray" });
    const conds = item.type === "attack" ? w.conditions.split(",").map(c => c.trim()).filter(Boolean) : [];
    if (isWeapon && prof.has("Blaze")) conds.push("burning");
    for (const c of conds) buttons += conditionButton(c, `+ ${c[0].toUpperCase()}${c.slice(1)}`);

    const math = [`${base - extras} base`, extras ? `+ ${extras} extra` : "", headshot ? "&times;2 headshot" : "", inferior ? "&bull; Inferior: target Armour doubled" : ""];
    if (headshot) notes.push("Headshot: a hit that drops it to 0 Toughness kills it outright.");
    if (weak) notes.push(`Hits the ${target?.actor?.system.weak?.label ?? "weak point"}.`);
    if (flags.lethal) notes.push("If this would make the target Dying, they die instantly.");
    if (item.type === "attack" && w.description) notes.push(`<i>${w.description}</i>`);
    await chat(this, `<div class="ir-card"><h3>${item.name}: ${dmg} damage</h3>
      <div class="ir-math">${math.filter(Boolean).join(" ")}</div>
      ${notes.map(n => `<p>${n}</p>`).join("")}
      <div class="ir-buttons">${buttons}</div>
      <p class="hint">GM: select the token(s), then click.${conds.length ? " Condition buttons are optional (read the attack text)." : ""}</p></div>`);
  }

  /**
   * Reload (an action): takes Shots from matching ammo in the inventory (the weapon's Ammo field; "" = free reload).
   * A weapon with several kinds of ammo (Grenade Launcher: Explosive / Flame Rounds) asks which to load; switching
   * kinds puts the loaded Shots back in the inventory first. The loaded round can set the damage and Tags.
   */
  async reload(item) {
    const w = item.system;
    const names = ammoList(w);
    if (!names.length) {
      if (w.shots.value >= w.shots.max) return ui.notifications.info(`${item.name} is already full.`);
      await item.update({ "system.shots.value": w.shots.max });
      return chat(this, `${this.name} reloads the ${item.name}.`);
    }
    const stacks = this.items.filter(i => i.type === "gear" && names.includes(i.name.toLowerCase()) && i.system.quantity > 0);
    const kinds = [...new Set(stacks.map(i => i.name))];
    if (!kinds.length) return ui.notifications.warn(`No ${w.ammo} left for the ${item.name}.`);

    let kind = kinds.find(k => k.toLowerCase() === w.loaded.toLowerCase()) ?? kinds[0];
    if (kinds.length > 1) {
      const options = kinds.map(k => {
        const n = stacks.filter(i => i.name === k).reduce((t, i) => t + i.system.quantity, 0);
        return `<option value="${esc(k)}" ${k === kind ? "selected" : ""}>${esc(k)} (${n})</option>`;
      }).join("");
      const r = await formDialog(`Reload ${item.name}`, `<div class="ir-dialog">
        <div class="form-group"><label>Load</label><select name="kind">${options}</select></div>
        ${w.loaded && w.shots.value ? `<p class="hint">Loaded now: ${esc(w.loaded)} (${w.shots.value}). Switching puts those back in your inventory.</p>` : ""}</div>`, "Reload");
      if (!r) return;
      kind = r.kind;
    }

    // Switching to another kind: unload the current Shots back into the inventory.
    let current = w.shots.value;
    const notes = [];
    if (current > 0 && w.loaded && w.loaded.toLowerCase() !== kind.toLowerCase()) {
      const st = this.items.find(i => i.type === "gear" && i.name.toLowerCase() === w.loaded.toLowerCase());
      const src = st ? st.toObject() : { name: w.loaded, type: "gear", img: "icons/svg/item-bag.svg",
        system: { size: 1, round: { damage: w.loadedDamage, tags: w.loadedTags } } };
      delete src._id; delete src.folder; delete src.sort;
      await this.addToStacks(src, current);
      notes.push(`Unloaded ${current} ${w.loaded}.`);
      current = 0;
    }
    const need = w.shots.max - current;
    if (need <= 0) return ui.notifications.info(`${item.name} is already full.`);

    const use = stacks.filter(i => i.name === kind);
    const round = use[0].system.round ?? { damage: 0, tags: "" };
    const have = use.reduce((n, i) => n + i.system.quantity, 0);
    const take = Math.min(need, have);
    let left = take;
    const updates = [], deletes = [];
    for (const st of use.sort((a, b) => a.system.quantity - b.system.quantity)) {
      if (!left) break;
      const n = Math.min(left, st.system.quantity);
      left -= n;
      if (n === st.system.quantity) deletes.push(st.id); else updates.push({ _id: st.id, "system.quantity": st.system.quantity - n });
    }
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    if (deletes.length) await this.deleteEmbeddedDocuments("Item", deletes);
    await item.update({
      "system.shots.value": current + take, "system.loaded": kind,
      "system.loadedDamage": round.damage ?? 0, "system.loadedTags": round.tags ?? ""
    });
    notes.push(`+${take} Shots of ${kind} (${current + take}/${w.shots.max}). ${kind} left: ${have - take}.`);
    return chat(this, `<div class="ir-card"><h3>${this.name} reloads the ${item.name}</h3>${notes.map(n => `<p>${n}</p>`).join("")}</div>`);
  }

  /* -------------------------------------------- */
  /*  Damage (rules p.31-33)                      */
  /* -------------------------------------------- */

  /**
   * Damage -> minus Armour -> Toughness -> Health.
   * mode: "normal" | "inferior" (Armour doubled) | "ignore" (ignores Armour)
   */
  async applyDamage(amount, mode = "normal", { headshot = false, lethal = false, weak = false, label = "" } = {}) {
    const s = this.system;
    const t = s.traits ?? {};
    const title = `${this.name} takes damage${label ? ` (${label})` : ""}`;
    if (this.getFlag(SYS, "heroic")) return chat(this, `<div class="ir-card"><h3>${title}</h3><p>Heroic Sacrifice: ignores all damage.</p></div>`);
    const armour = mode === "ignore" ? 0 : mode === "inferior" ? s.armour.value * 2 : s.armour.value;
    const dmg = Math.max(0, amount - armour);
    const notes = [`${amount} damage - ${armour} Armour = <b>${dmg}</b>`];
    const update = {};

    const soak = Math.min(s.toughness.value, dmg);
    const toughness = s.toughness.value - soak;
    let rest = dmg - soak;
    update["system.toughness.value"] = toughness;

    if (this.type === "character") {
      let ecg = s.ecg.value, stress = s.stress.value, adr = s.adrenaline.value, panic = false;

      await snapOutOfMalaise(this, dmg);
      const virusDeath = !!s.infection?.infected && s.infection.stage >= 4;   // Stage 4: Dying = dead
      if (rest > 0 && ecg >= 5 && (lethal || virusDeath)) {
        notes.push(lethal ? `<b class="failure">KILLED.</b> This attack would have left them Dying: they die instantly.`
          : `<b class="failure">DEAD.</b> The virus has taken hold: they don't linger in Dying, they die at once.`);
        await addCondition(this, "dead");
      } else if (rest > 0 && ecg >= 5) {
        notes.push(`<b class="failure">DYING!</b> Unconscious. GM rolls the Death Die (use the Death Die button).`);
        await addCondition(this, "dying");
      } else if (rest > 0) {
        const before = ecg;
        ecg = Math.min(5, ecg + rest);                         // overflow past the last box is ignored
        const gainStress = () => { if (stress >= 6) panic = true; else stress += 1; };
        if (before < 1 && ecg >= 1) { gainStress(); adr += 1; notes.push("Enters <b>Fine</b>: +1 Stress, +1 Adrenaline."); }
        if (before < 3 && ecg >= 3) { gainStress(); adr += 1; notes.push("Enters <b>Caution</b>: +1 Stress, +1 Adrenaline, -1 Defence."); }
        if (before < 5 && ecg >= 5) {
          gainStress(); panic = true;
          notes.push("Enters <b>Danger</b>: +1 Stress, Injured, Panic Test now. Regain 1 Adrenaline each round. Any more Health damage = Dying.");
        }
        if (panic && stress >= 6 && !notes.at(-1).includes("Danger")) notes.push("Stress is at the limit: <b>Panic Test!</b>");
        update["system.ecg.value"] = ecg;
        update["system.stress.value"] = stress;
        update["system.adrenaline.value"] = Math.min(adr, s.adrenaline.max);
      }
      await this.update(update);
      await chat(this, `<div class="ir-card"><h3>${title}</h3>${notes.map(n => `<p>${n}</p>`).join("")}</div>`);
      if (panic) await this.rollPanic();
      return;
    }

    // Monsters / NPCs
    let defeated = false;
    if (s.hasHealth) {
      const health = Math.max(0, s.health.value - rest);
      update["system.health.value"] = health;
      if (rest > 0) notes.push(`Health ${s.health.value} &rarr; ${health}`);
      defeated = toughness === 0 && health === 0;
    } else {
      defeated = toughness === 0;
    }
    notes.push(`Toughness ${s.toughness.value} &rarr; ${toughness}`);

    // Aim For the Head / Back From the Dead.
    let mutateNow = false;
    if (defeated && headshot && t.aimForHead) notes.push("<b>Headshot:</b> killed outright, no Back From the Dead.");
    else if (defeated && t.backFromDead && !t.bftdUsed) {
      update["system.traits.bftdUsed"] = true;
      const r = await new Roll("1d6").evaluate();
      await showRoll(r, this, `${this.name}: Back From the Dead`,
        `1d6 = ${r.total} vs Horror ${getHorror()}: ${r.total <= getHorror() ? "<b>it isn't dead.</b> It gets back up next turn." : "it stays down."}`, { gmOnly: true });
      if (r.total <= getHorror()) {
        defeated = false;
        update["system.traits.reviving"] = true;
        notes.push(`<b>Back From the Dead:</b> rolled ${r.total} &le; Horror ${getHorror()}. It isn't dead: it regains 1d3 Toughness at the start of its next turn.`);
      } else notes.push(`Back From the Dead: rolled ${r.total} &gt; Horror ${getHorror()}. It stays down.`);
    }
    // Violent Mutation: the first time it takes damage but isn't killed.
    if (!defeated && dmg > 0 && t.mutatesInto && !t.mutationChecked) {
      update["system.traits.mutationChecked"] = true;
      const r = await new Roll("1d6").evaluate();
      mutateNow = r.total <= getHorror();
      await showRoll(r, this, `${this.name}: Violent Mutation`,
        `1d6 = ${r.total} vs Horror ${getHorror()}: ${mutateNow ? "<b>it mutates!</b>" : "no change."}`, { gmOnly: true });
      notes.push(`Violent Mutation check: rolled ${r.total} vs Horror ${getHorror()}${mutateNow ? ". <b>It mutates!</b>" : ": no change."}`);
    }

    if (defeated) notes.push(`<b class="failure">Defeated.</b>`);
    await this.update(update);
    if (defeated) await addCondition(this, "dead");
    await chat(this, `<div class="ir-card"><h3>${title}</h3>${notes.map(n => `<p>${n}</p>`).join("")}</div>`,
      { whisper: game.users.filter(u => u.isGM).map(u => u.id) });
    if (weak && !defeated) await hitWeakPoint(this, dmg);
    if (mutateNow) await mutate(this, t.mutatesInto);
  }

  /** Ask the GM for an amount and apply it. */
  async promptDamage() {
    const r = await formDialog(`Damage ${this.name}`, `<div class="ir-dialog">
      <div class="form-group"><label>Damage</label><input type="number" name="amount" value="1" min="0" autofocus></div>
      <div class="form-group"><label>Armour</label><select name="mode">
        <option value="normal">Normal</option><option value="ignore">Ignores Armour (Bleeding, Burning...)</option>
        <option value="inferior">Inferior (Armour doubled)</option></select></div></div>`, "Apply");
    if (r) return this.applyDamage(Number(r.amount), r.mode);
  }

  /* -------------------------------------------- */
  /*  Stress, Panic, Death                        */
  /* -------------------------------------------- */

  /** Gain Stress; if it would go over 6, Panic instead. */
  async gainStress(n = 1) {
    const s = this.system.stress.value;
    if (s + n > 6) {
      await this.update({ "system.stress.value": 6 });
      return this.rollPanic();
    }
    return this.update({ "system.stress.value": s + n });
  }

  /** Panic Test: 1d6 vs TN = max(Stress, Horror, 2). Fail -> d66 on the Panic table. */
  async rollPanic() {
    const horror = getHorror();
    const stress = this.system.stress.value;
    const tn = Math.max(stress, horror, 2);
    // Calm Mind: roll two dice and use either result (the higher one is always the better pick).
    const calm = this.type === "character" ? this.items.find(i => i.type === "talent" && i.system.panicBest) : null;
    const roll = await new Roll(calm ? "2d6kh" : "1d6").evaluate();
    let text;
    if (roll.total >= tn) {
      text = `<div class="ir-result success">HOLDS IT TOGETHER</div>`;
      if (roll.total === 6 && stress > 0) {
        await this.update({ "system.stress.value": stress - 1 });
        text += `<p>Rolled a 6: Stress -1.</p>`;
      }
    } else {
      const tens = (await new Roll("1d6").evaluate()).total, ones = (await new Roll("1d6").evaluate()).total;
      const d66 = tens * 10 + ones;
      const effect = panicEffect(d66);
      await this.update({ "system.panicEffect": effect.split(":")[0] });
      text = `<div class="ir-result failure">PANIC!</div><p><b>d66 = ${d66}</b>: ${effect}</p>`;
    }
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>Panic Test</h3>
        <div class="ir-math">TN ${tn} (Stress ${stress}, Horror ${horror}, min 2)${calm ? ` &middot; ${calm.name}: best of two dice` : ""}</div>${text}</div>`
    });
  }

  /** Death Die: GM-only result. */
  async rollDeathDie() {
    const roll = await new Roll("1d6").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>Death Die: ${this.name}</h3><p>${deathResult(roll.total)}</p></div>`
    }, { rollMode: "gmroll" });
  }

  /* -------------------------------------------- */
  /*  Recovery                                    */
  /* -------------------------------------------- */

  /** Safe Room rest (p.34): full Toughness, Stress -1d3, Danger -> Caution. */
  async safeRoomRest() {
    const s = this.system;
    if (!isSafeRoomOpen() && !(await DialogV2.confirm({
      window: { title: "Safe Room Rest" },
      content: "<p>The GM hasn't opened a Safe Room. Rest anyway?</p>", rejectClose: false
    }))) return;
    const wasBleeding = this.statuses.has("bleeding");
    const r = await new Roll("1d3").evaluate();
    const noHeal = !!s.infection?.infected && s.infection.stage >= 4;   // IR-Virus Stage 4: can't be healed in any way
    await this.update({
      ...(noHeal ? {} : { "system.toughness.value": s.toughness.max, "system.ecg.value": s.ecg.value >= 5 ? 4 : s.ecg.value }),
      "system.stress.value": Math.max(0, s.stress.value - r.total),
      "system.panicEffect": ""
    });
    await removeCondition(this, "bleeding");
    await r.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>Safe Room Rest</h3><p class="hint">10 minutes.</p>${wasBleeding ? "<p>Bleeding stops.</p>" : ""}<p>${noHeal ? "Their injuries don't heal. " : `Toughness restored.${s.ecg.value >= 5 ? " Danger &rarr; Caution." : ""} `}Stress reduced by ${r.total}. Panic effects end.</p></div>`
    });
  }

  /** Reduce Stress by a die roll (Stress Reliefs, 3 extra successes...). */
  async relieveStress(formula = "1d3", label = "Stress Relief") {
    const r = await new Roll(formula).evaluate();
    await this.update({ "system.stress.value": Math.max(0, this.system.stress.value - r.total) });
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor: `<div class="ir-card"><h3>${label}</h3><p>Stress -${r.total}</p></div>` });
  }

  /** Use a consumable gear item (healing herb, first-aid spray, health pack, adrenaline shot). */
  async useGear(item) {
    const g = item.system, s = this.system;
    if (g.use === "light") return this.lightCheck(item);
    if (g.quantity < 1) return ui.notifications.warn(`No ${item.name} left.`);
    let msg = "";

    // Crafted on a failed Test: half as effective (half the Toughness, half the ECG spaces).
    const half = g.halfStrength;
    const toughnessHealed = half ? s.toughness.value + Math.floor((s.toughness.max - s.toughness.value) / 2) : s.toughness.max;

    const noHeal = !!s.infection?.infected && s.infection.stage >= 4 && ["heal", "healthpack"].includes(g.use);   // Stage 4: can't be healed
    if (noHeal) {
      msg = "It doesn't seem to do anything. Whatever is wrong with them, healing can't reach it.";
    } else if (g.use === "heal") {
      const clear = half ? Math.floor(g.healEcg / 2) : g.healEcg;
      const gain = half ? Math.floor(g.toughnessGain / 2) : g.toughnessGain;   // Bolstering Herb: permanent +Toughness
      const max = s.toughness.max + gain;
      const toughness = half ? s.toughness.value + Math.floor((max - s.toughness.value) / 2) : max;
      const before = { ecg: s.ecg.value, toughness: s.toughness.value };      // read before the update changes them
      const ecg = Math.max(0, before.ecg - clear);
      await this.update({ "system.ecg.value": ecg, "system.toughness.value": toughness, "system.toughness.bonus": s.toughness.bonus + gain });
      msg = `${half ? `Half strength: Toughness ${before.toughness} &rarr; ${toughness}` : "Toughness restored"}${before.ecg - ecg ? `, ECG cleared ${before.ecg - ecg}` : ""}.`;
      if (gain) msg += ` <b>Permanent Toughness +${gain}</b> (now ${max}).`;
    } else if (g.use === "sedative") {
      await this.relieveStress("1d3", item.name);
      msg = "Free action: Stress -1d3. For the next hour, any time you'd gain Stress roll 1d6: if it's &le; your Heart "
        + `(${s.attributes.heart}), you don't gain it.`;
    } else if (g.use === "healthpack") {
      const tn = Math.max(2, 1 + s.ecg.value);
      const safe = safeRoomNoTest(this, ["medicine"]);
      let success = safe.ok;
      if (success) msg = "Safe Room: no Test needed. ";
      else {
        const res = await this.promptTest({ label: `${item.name} (Wits/Medicine, self)`, attribute: "wits", skill: "medicine", tn,
          complication: 1, complicationReason: "Treating yourself -1",
          hints: safe.reason === "untrained" ? ["Safe Room, but you need to be Trained in Medicine to skip the Test."] : [] });
        if (!res) return;
        success = res.result.successes > 0;
      }
      if (success && half) {
        await this.update({ "system.ecg.value": s.ecg.value - Math.floor(s.ecg.value / 2), "system.toughness.value": toughnessHealed });
        msg += "Half strength: half the ECG cleared, half the missing Toughness restored.";
      } else if (success) {
        await this.update({ "system.ecg.value": 0, "system.toughness.value": s.toughness.max });
        msg += "Fully healed: ECG cleared and Toughness restored.";
      } else {
        await this.update({
          "system.ecg.value": s.ecg.value - Math.floor(s.ecg.value / 2),
          "system.toughness.value": Math.max(s.toughness.value, Math.floor(s.toughness.max / 2)),
          "system.stress.value": Math.min(6, s.stress.value + 1)
        });
        msg = "Botched: half the ECG cleared, half Toughness restored, +1 Stress.";
      }
    } else if (g.use === "adrenaline") {
      await this.update({ "system.adrenaline.value": s.adrenaline.max });
      msg = "Adrenaline fully restored (and +1 each round for 1 minute).";
    } else {
      return ui.notifications.info(`${item.name} has no automatic effect.`);
    }

    if (!noHeal && (g.use === "heal" || g.use === "healthpack")) {
      if (this.statuses.has("bleeding")) msg += " Bleeding stops.";
      await removeCondition(this, "bleeding");             // any healing ends Bleeding
    }
    if (g.quantity <= 1) await item.delete();
    else await item.update({ "system.quantity": g.quantity - 1 });
    await chat(this, `<div class="ir-card"><h3>${this.name} uses ${item.name}</h3><p>${msg}</p></div>`);
  }

  /** Losing Light (rules p.40): after extended use, 1d6 <= Horror = the battery runs out and you gain 1 Stress. */
  async lightCheck(item) {
    const roll = await new Roll("1d6").evaluate();
    const horror = getHorror();
    const out = roll.total <= horror;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>Losing Light: ${esc(item.name)}</h3>
        <div class="ir-math">1d6 vs Horror ${horror}</div>
        ${out ? `<div class="ir-result failure">IT GOES DARK</div><p>The light stops working. <b>+1 Stress.</b></p>`
              : `<div class="ir-result success">STILL WORKING</div>`}</div>`
    });
    if (out) await this.gainStress(1);
  }

  /** Fit an attachment to a gun (one per slot: a Scope replaces an Infrared Scope, and so on). */
  async fitAttachment(item, gun) {
    const def = ATTACHMENTS[item.system.attachment];
    if (!def || gun?.type !== "weapon" || gun.system.category !== "ranged") return ui.notifications.warn("Attachments only fit guns.");
    const updates = [{ _id: item.id, "system.fittedTo": gun.id, "system.quick": false, "system.inv.x": -1 }];
    for (const other of this.items) {
      if (other.id !== item.id && fittedGun(other) === gun && ATTACHMENTS[other.system.attachment]?.slot === def.slot)
        updates.push({ _id: other.id, "system.fittedTo": "", "system.inv.x": -1 });   // swapped out: back into the grid
    }
    await this.updateEmbeddedDocuments("Item", updates);
    // Any gun takes any attachment, but it only helps where there's something to change.
    const src = gun._source.system;
    const tags = src.tags.toLowerCase().split(",").map(t => t.trim());
    let effect = def.tip;
    if (def.slot === "muzzle" && !tags.includes("loud")) effect = `No effect: the ${esc(gun.name)} isn't Loud.`;
    if (item.system.attachment === "mag" && Math.floor(src.shots.max * 1.5) === src.shots.max) effect = `No effect: ${src.shots.max} Shot(s) +50% rounds down to the same.`;
    return chat(this, `<div class="ir-card"><h3>${this.name} fits a ${esc(item.name)}</h3><p>On the ${esc(gun.name)}: ${effect}</p></div>`);
  }

  /** Take an attachment off its gun (it goes back into the inventory). */
  async removeAttachment(item) {
    const gun = fittedGun(item);
    await item.update({ "system.fittedTo": "", "system.inv.x": -1 });
    // Without an Expanded Mag the gun can't hold more than its normal Shots.
    if (gun && item.system.attachment === "mag") {
      const max = gun._source.system.shots.max;
      if (gun.system.shots.value > max) await gun.update({ "system.shots.value": max });
    }
  }

  /** Dialog: pick which gun to fit an attachment to. */
  async promptFit(item) {
    const guns = this.items.filter(i => i.type === "weapon" && i.system.category === "ranged");
    if (!guns.length) return ui.notifications.warn(`${this.name} has no gun to fit the ${item.name} to.`);
    if (guns.length === 1) return this.fitAttachment(item, guns[0]);
    const r = await formDialog(`Fit ${item.name}`, `<div class="ir-dialog"><div class="form-group"><label>Gun</label>
      <select name="gun">${guns.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></div>
      <p class="hint">You need the right one for the right gun (GM's call).</p></div>`, "Fit");
    if (r) return this.fitAttachment(item, this.items.get(r.gun));
  }

  /* -------------------------------------------- */
  /*  Crafting (rules p.46-47)                    */
  /* -------------------------------------------- */

  /** Supplies carried (by supply key, summed over stacks) and tool keys carried. */
  craftingStock() {
    const supplies = Object.fromEntries(Object.keys(SUPPLIES).map(k => [k, 0]));
    const tools = new Set();
    for (const i of this.items) {
      if (i.type !== "gear") continue;
      if (i.system.supply in supplies) supplies[i.system.supply] += i.system.quantity;
      if (i.system.tool in TOOLS) tools.add(i.system.tool);
    }
    return { supplies, tools };
  }

  /** Which of the recipe's skills to roll: highest Training, then most Stress ignored by Talents. */
  craftSkill(recipe) {
    const s = this.system;
    const score = skill => {
      const ignore = Math.max(0, ...this.items.filter(i => i.type === "talent" && i.system.ignoreSkills.split(",").map(k => k.trim()).includes(skill)).map(i => i.system.ignoreStress));
      return (s.skills[skill]?.training ?? 0) * 10 + Math.min(s.stress?.value ?? 0, ignore);
    };
    return [...recipe.skills].sort((a, b) => score(b) - score(a))[0];
  }

  /** Recipes with what's missing: [{ recipe, missing: [supply keys], tools: [{key, label, has}], skill }]. */
  craftingOptions() {
    const { supplies, tools } = this.craftingStock();
    return RECIPES.map(recipe => ({
      recipe, skill: this.craftSkill(recipe),
      missing: Object.entries(recipe.inputs).filter(([k, n]) => supplies[k] < n).map(([k]) => k),
      have: supplies,
      tools: recipe.tools.map(key => ({ key, label: TOOLS[key], has: tools.has(key) }))
    }));
  }

  /** Crafting dialog: pick a recipe (only the ones you have supplies for can be picked). */
  async promptCraft({ item = null } = {}) {
    if (this.type !== "character") return;
    let options = this.craftingOptions();
    // Opened from a supply or tool in the inventory: show the recipes that use it.
    const key = item?.system.supply || item?.system.tool;
    if (key) {
      const uses = options.filter(o => key in o.recipe.inputs || o.recipe.tools.includes(key));
      if (uses.length) options = uses;
    }
    options.sort((a, b) => (a.missing.length > 0) - (b.missing.length > 0));
    const canAny = options.some(o => !o.missing.length);
    const safe = isSafeRoomOpen();

    const rows = options.map((o, idx) => {
      const r = o.recipe, can = !o.missing.length;
      const ingr = Object.entries(r.inputs).map(([k, n]) =>
        `<span class="${o.have[k] >= n ? "have" : "lack"}">${SUPPLIES[k]}${n > 1 ? ` &times;${n}` : ""} <small>(${o.have[k]})</small></span>`).join(" + ");
      const tools = o.tools.map(t => `<span class="${t.has ? "have" : "opt"}">${t.has ? "&#10003; " : ""}${t.label}</span>`).join(", ");
      const noTest = safeRoomNoTest(this, r.skills).ok;
      const test = noTest ? `<span class="have">No Test</span> <small>(Safe Room)</small>`
        : `TN ${r.tn} Wits (${r.skills.map(sk => sk === o.skill ? `<b>${SKILLS[sk][0]}</b>` : SKILLS[sk][0]).join(" or ")})`;
      return `<tr class="${can ? "" : "cant"}">
        <td><label><input type="radio" name="recipe" value="${esc(r.id)}" ${can ? "" : "disabled"} ${can && idx === 0 ? "checked" : ""}> ${esc(r.name)}</label></td>
        <td>${ingr}</td><td>${tools}</td><td>${test}</td><td class="amt">${r.amount}</td></tr>`;
    }).join("");

    const content = `<div class="ir-dialog ir-craft">
      <table>
        <thead><tr><th>Item</th><th>Ingredients <small>(carried)</small></th><th>Tools</th><th>Test</th><th>Amnt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${canAny ? "" : `<p class="hint lack">You don't carry the supplies for any of these yet.</p>`}
      <p class="hint">${safe ? "<b>Safe Room:</b> no Test for recipes whose Skill you're at least Trained in." : "Not in a Safe Room: every recipe needs a Test (the GM opens Safe Rooms from the Horror bar)."}</p>
      <p class="hint">Crafting takes 10 minutes. Tools help but aren't necessary. The skill in bold is the one you'll roll.
        A failed Test still crafts the item, at reduced effect (half the ammo, half-strength healing or explosives).</p>
    </div>`;

    const r = await DialogV2.prompt({
      window: { title: `${this.name}: Crafting`, icon: "fa-solid fa-hammer" },
      position: { width: 760 },
      content, rejectClose: false,
      ok: { label: "Craft", icon: "fa-solid fa-hammer", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
    });
    if (!r?.recipe) return null;
    return this.craft(r.recipe);
  }

  /**
   * Craft a recipe (config RECIPES, by id). Uses up the ingredients, rolls the Test
   * (none in a Safe Room if Trained in the Skill), then adds the result to the inventory.
   * `noTest` overrides the Safe Room check (true = skip the Test, false = always roll).
   */
  async craft(recipeId, { noTest = null } = {}) {
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe) return ui.notifications.warn(`Unknown recipe: ${recipeId}`);
    const option = this.craftingOptions().find(o => o.recipe === recipe);
    if (option.missing.length) return ui.notifications.warn(`${this.name} doesn't have enough ${option.missing.map(k => SUPPLIES[k]).join(", ")} for ${recipe.name}.`);

    // Tool Advantages (Pestle and Mortar: +1 on healing items).
    let advantage = 0;
    const advantageReasons = [], hints = [];
    for (const t of option.tools) {
      const bonus = TOOL_ADVANTAGE[t.key];
      const applies = bonus?.kinds.includes(recipe.kind);
      if (applies && t.has) { advantage += bonus.advantage; advantageReasons.push(`${t.label} +${bonus.advantage}`); }
      else if (applies) hints.push(`No ${t.label}: no Advantage (it isn't required).`);
      else hints.push(`${t.label}: ${t.has ? "carried" : "not carried"} (helps, not required).`);
    }
    hints.push("Crafting takes 10 minutes.");
    const safe = safeRoomNoTest(this, recipe.skills);
    if (safe.reason === "untrained") hints.unshift(`Safe Room, but you need to be Trained in ${recipe.skills.map(k => SKILLS[k][0]).join(" or ")} to skip the Test.`);
    const skipTest = noTest ?? safe.ok;
    let success = true;
    if (!skipTest) {
      const res = await this.promptTest({
        label: `Craft ${recipe.name}`, attribute: recipe.attribute, skill: option.skill, tn: recipe.tn,
        advantage, advantageReasons, hints
      });
      if (!res) return null;                                // dialog closed: nothing used up
      success = res.result.successes > 0;
    }

    await this.#useSupplies(recipe.inputs);
    const { item, qty, stacked } = await this.#addCrafted(recipe, success);

    const lines = [`Used: ${ingredientText(recipe.inputs)}.`];
    if (skipTest) lines.push("Safe Room: no Test needed.");
    lines.push(`<b>+${qty} ${esc(item.name)}</b>${stacked ? " (added to the stack)" : ""}.`);
    if (!success) lines.push(`<span class="failure">${CRAFT_FAILURE[recipe.kind]}</span>`);
    if (!stacked && resolveInventory(this).pos[item.id]?.zone === "loose") lines.push("No room in the inventory: it's in the <b>Not in the grid</b> tray. Make room or drop something.");
    lines.push(`<span class="hint">Takes 10 minutes.</span>`);
    await chat(this, `<div class="ir-card"><h3>${this.name} crafts ${esc(recipe.name)}</h3>${lines.map(l => `<p>${l}</p>`).join("")}</div>`);
    return item;
  }

  /** Remove supplies from the stacks (smallest stacks first, so partial stacks get used up). */
  async #useSupplies(inputs) {
    const updates = [], deletes = [];
    for (const [key, need] of Object.entries(inputs)) {
      let left = need;
      const stacks = this.items.filter(i => i.type === "gear" && i.system.supply === key && i.system.quantity > 0)
        .sort((a, b) => a.system.quantity - b.system.quantity);
      for (const st of stacks) {
        if (!left) break;
        const use = Math.min(left, st.system.quantity);
        left -= use;
        if (use === st.system.quantity) deletes.push(st.id); else updates.push({ _id: st.id, "system.quantity": st.system.quantity - use });
      }
    }
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    if (deletes.length) await this.deleteEmbeddedDocuments("Item", deletes);
  }

  /**
   * Create the crafted item (or add to a matching stack).
   * Source: a world item with that name (so your art is used), else the starter data.
   */
  async #addCrafted(recipe, success) {
    const world = game.items.find(i => i.name === recipe.output && ["gear", "weapon"].includes(i.type));
    const src = world ? world.toObject() : foundry.utils.deepClone(ITEMS.find(i => i.name === recipe.output) ?? { name: recipe.output, type: "gear", img: "icons/svg/item-bag.svg", system: {} });
    delete src._id; delete src.folder; delete src.sort; delete src.ownership;
    src.system ??= {};

    let qty = recipe.amount;
    if (!success && recipe.kind === "ammo") qty = Math.max(1, Math.floor(qty / 2));
    const botched = !success && ["heal", "throwable", "silencer"].includes(recipe.kind);
    if (botched) {
      src.name = `${src.name} (botched)`;
      src.system.description = `${CRAFT_FAILURE[recipe.kind].replace("Failed Test: ", "Crafted on a failed Test: ")} ${src.system.description ?? ""}`.trim();
      if (src.type === "gear") src.system.halfStrength = true;
      if (src.type === "weapon") src.system.damage = Math.floor((src.system.damage ?? 0) / 2);
    }

    if (src.type !== "gear") {                                // weapons (Molotov, Pipe Bomb) are one item each
      const created = await this.#createPacked(src, Array(qty).fill(1));
      return { item: created[0], qty, stacked: false };
    }
    const { first, stacked } = await this.addToStacks(src, qty);
    return { item: first, qty, stacked };
  }

  /** Stack size limit of a gear item: Stack (N); 1 = doesn't stack; 0 (not set) = no limit. */
  static stackMax(sys) { return sys.stack > 0 ? sys.stack : Infinity; }

  /**
   * Add `qty` of a gear item: top up matching stacks to their Stack size, then new items for the rest.
   * Returns { first: the first item touched, stacked: true if nothing new was created }.
   */
  async addToStacks(src, qty) {
    const max = InkActor.stackMax(src.system);
    let left = qty, first = null;
    const matches = this.items.filter(i => i.type === "gear" && i.name === src.name && !!i.system.halfStrength === !!src.system.halfStrength);
    for (const st of matches) {
      if (!left) break;
      const room = Math.max(0, InkActor.stackMax(st.system) - st.system.quantity);
      const add = Math.min(room, left);
      if (!add) continue;
      await st.update({ "system.quantity": st.system.quantity + add });
      left -= add; first ??= st;
    }
    if (!left) return { first, stacked: true };
    const sizes = [];
    while (left > 0) { const n = Math.min(max, left); sizes.push(n); left -= n; }
    const created = await this.#createPacked(src, sizes);
    return { first: first ?? created[0], stacked: false };
  }

  /** Create copies of `src` with the given quantities, unplaced (the grid packs them into free spots). */
  async #createPacked(src, quantities) {
    const docs = quantities.map(q => {
      const d = foundry.utils.deepClone(src);
      d.system.inv = { x: -1, y: -1, rot: false };
      d.system.quick = false;
      if (d.type === "gear") d.system.quantity = q;
      return d;
    });
    return this.createEmbeddedDocuments("Item", docs);
  }

  /** Split a gear item that's over its Stack size into separate items (each takes its own Slot). */
  async splitStack(item) {
    const s = item.system;
    const max = InkActor.stackMax(s);
    if (item.type !== "gear" || s.quantity <= max) return;
    const src = item.toObject();
    delete src._id; delete src.folder; delete src.sort;
    const rest = s.quantity - max;
    await item.update({ "system.quantity": max });
    const sizes = [];
    for (let left = rest; left > 0; left -= max) sizes.push(Math.min(max, left));
    await this.#createPacked(src, sizes);
  }
}
