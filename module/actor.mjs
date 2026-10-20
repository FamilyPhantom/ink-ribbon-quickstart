import { ATTRIBUTES, SKILLS, CONDITIONS, panicEffect, deathResult } from "./config.mjs";
import { addCondition, removeCondition, damageButton, conditionButton, hitWeakPoint, mutate } from "./rules.mjs";

const { DialogV2 } = foundry.applications.api;
const SYS = "ink-ribbon";

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

function chat(actor, content, extra = {}) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, ...extra });
}

export class InkActor extends Actor {

  /* -------------------------------------------- */
  /*  Data preparation                            */
  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData();
    const s = this.system;
    if (!["character", "monster", "npc"].includes(this.type)) return;   // e.g. module-added actor types

    // Characters: Armour = best equipped armour item + bonus.
    if (this.type === "character") {
      const worn = this.items.filter(i => i.type === "armour" && i.system.equipped).map(i => i.system.rating);
      s.armour.value = s.armour.bonus + Math.max(0, ...worn);
      // Slots: carried items use their Size; Quick items and worn armour don't.
      s.slots.used = this.items
        .filter(i => ["weapon", "armour", "gear"].includes(i.type) && !i.system.quick && !(i.type === "armour" && i.system.equipped))
        .reduce((n, i) => n + i.system.size, 0);
      // Gear like a Backpack raises the maximum while carried.
      const gear = this.items.filter(i => i.type === "gear");
      s.slots.bonus = gear.reduce((n, i) => n + (i.system.slotBonus ?? 0), 0);
      s.slots.total = Math.clamp(s.slots.max + s.slots.bonus, 0, 12);
      s.slots.over = s.slots.used > s.slots.total;
      s.quickSlots.bonus = gear.reduce((n, i) => n + (i.system.quickBonus ?? 0), 0);
      s.quickSlots.total = Math.clamp(s.quickSlots.max + s.quickSlots.bonus, 0, 4);

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

  /** Attack with a weapon (PC) or a stat-block attack (monster). TN = targeted token's Defence (+ its traits). */
  async rollAttack(item) {
    const target = game.user.targets.first();
    const tActor = target?.actor;
    const ts = tActor?.system ?? {};
    const traits = ts.traits ?? {};
    const w = item.system;
    const isWeapon = item.type === "weapon";
    const tag = t => isWeapon && w.hasTag(t);
    let attribute, skill, fixedPool = null, isRanged;

    if (item.type === "attack") {
      fixedPool = w.pool; isRanged = w.kind === "ranged";
      attribute = isRanged ? "agility" : "strength";
      if (w.noTest) return this.#damageCard(item, w.damage, 0, { target, notes: ["No Test needed."] });
    } else {
      isRanged = w.category !== "melee";
      [skill, attribute] = { melee: ["fighting", "strength"], ranged: ["shooting", "agility"], thrown: ["shooting", "strength"] }[w.category];
      if (w.category === "ranged" && w.shots.max > 0 && w.shots.value < 1)
        return ui.notifications.warn(`${item.name} is out of Shots. Reload first.`);
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
    if (isGun && w.shots.max > 0) {
      const left = w.shots.value - 1 - autoShots;
      await item.update({ "system.shots.value": left });
      if (autoShots) notes.push(`Full-auto: ${autoShots} extra Shot(s) for +${autoShots} dice.`);
      if (left === 0) {
        const hasAmmo = w.ammo && this.items.some(i => i.type === "gear" && i.name.toLowerCase() === w.ammo.toLowerCase() && i.system.quantity > 0);
        if (w.ammo && !hasAmmo) { notes.push(`${item.name} is empty and there's no ${w.ammo} left: <b>+1 Stress</b>.`); await this.gainStress(1); }
        else if (!w.ammo) notes.push(`${item.name} is empty! If there's no ammo for it in the Inventory, gain 1 Stress.`);
        else notes.push(`${item.name} is empty. Reload (action).`);
      }
    }
    if (tag("Loud")) notes.push("Loud: everyone (and everything) within Long Range hears it.");
    if (f.throw) notes.push(`${item.name} is thrown: it's no longer in hand.`);
    let breaks = false;
    if (tag("Brittle")) {
      const b = await new Roll("1d6").evaluate();
      breaks = b.total <= getHorror();
      if (breaks) notes.push(`Brittle: rolled ${b.total} &le; Horror. <b>${item.name} breaks!</b> +1 Stress.`);
    }
    if (isWeapon && w.singleUse) notes.push(`${item.name} is used up.`);

    if (successes) await this.#damageCard(item, w.damage + extras, extras, { target, notes, headshot, weak, explosive });
    else if (notes.length) await chat(this, `<div class="ir-card"><h3>${item.name}: miss</h3>${notes.map(n => `<p>${n}</p>`).join("")}</div>`);
    if (breaks) await this.gainStress(1);
    if (breaks || (isWeapon && w.singleUse)) await item.delete();
  }

  /** Chat card for a hit: damage button plus any on-hit conditions and splash damage. */
  async #damageCard(item, base, extras, { target, notes = [], headshot = false, weak = false, explosive = false }) {
    const w = item.system;
    const isWeapon = item.type === "weapon";
    const inferior = isWeapon && w.hasTag("Inferior");
    const dmg = headshot ? base * 2 : base;
    const mode = inferior ? "inferior" : "normal";
    const flags = {};
    if (headshot) flags.headshot = 1;
    if (weak) flags.weak = 1;
    if (item.type === "attack" && w.lethal) flags.lethal = 1;

    let buttons = damageButton(`Apply ${dmg} damage`, dmg, mode, flags);
    if (explosive) buttons += damageButton(`${Math.floor(w.damage / 2)} to rest of Zone`, Math.floor(w.damage / 2), mode, { label: "Explosive" });
    if (isWeapon && w.hasTag("Spray")) buttons += damageButton(`Spray: ${Math.floor(dmg / 2)} to Adjacent`, Math.floor(dmg / 2), mode, { label: "Spray" });
    const conds = item.type === "attack" ? w.conditions.split(",").map(c => c.trim()).filter(Boolean) : [];
    if (isWeapon && w.hasTag("Blaze")) conds.push("burning");
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

  /** Reload: takes Shots from matching ammo in the inventory (weapon's Ammo field). No Ammo field = free reload. */
  async reload(item) {
    const w = item.system;
    const need = w.shots.max - w.shots.value;
    if (need <= 0) return ui.notifications.info(`${item.name} is already full.`);
    if (!w.ammo) {
      await item.update({ "system.shots.value": w.shots.max });
      return chat(this, `${this.name} reloads the ${item.name}.`);
    }
    const stacks = this.items.filter(i => i.type === "gear" && i.name.toLowerCase() === w.ammo.toLowerCase() && i.system.quantity > 0);
    const have = stacks.reduce((n, i) => n + i.system.quantity, 0);
    if (!have) return ui.notifications.warn(`No ${w.ammo} left for the ${item.name}.`);
    let take = Math.min(need, have), left = take;
    const updates = [], deletes = [];
    for (const st of stacks) {
      if (!left) break;
      const use = Math.min(left, st.system.quantity);
      left -= use;
      if (use === st.system.quantity) deletes.push(st.id); else updates.push({ _id: st.id, "system.quantity": st.system.quantity - use });
    }
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    if (deletes.length) await this.deleteEmbeddedDocuments("Item", deletes);
    await item.update({ "system.shots.value": w.shots.value + take });
    return chat(this, `<div class="ir-card"><h3>${this.name} reloads the ${item.name}</h3><p>+${take} Shots (${w.shots.value + take}/${w.shots.max}). ${w.ammo} left: ${have - take}.</p></div>`);
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

      if (rest > 0 && ecg >= 5 && lethal) {
        notes.push(`<b class="failure">KILLED.</b> This attack would have left them Dying: they die instantly.`);
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
    const roll = await new Roll("1d6").evaluate();
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
        <div class="ir-math">TN ${tn} (Stress ${stress}, Horror ${horror}, min 2)</div>${text}</div>`
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
    const wasBleeding = this.statuses.has("bleeding");
    const r = await new Roll("1d3").evaluate();
    await this.update({
      "system.toughness.value": s.toughness.max,
      "system.stress.value": Math.max(0, s.stress.value - r.total),
      "system.ecg.value": s.ecg.value >= 5 ? 4 : s.ecg.value,
      "system.panicEffect": ""
    });
    await removeCondition(this, "bleeding");
    await r.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<div class="ir-card"><h3>Safe Room Rest</h3>${wasBleeding ? "<p>Bleeding stops.</p>" : ""}<p>Toughness restored. Stress reduced by ${r.total}.${s.ecg.value >= 5 ? " Danger &rarr; Caution." : ""} Panic effects end.</p></div>`
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
    if (g.quantity < 1) return ui.notifications.warn(`No ${item.name} left.`);
    let msg = "";

    if (g.use === "heal") {
      const ecg = Math.max(0, s.ecg.value - g.healEcg);
      await this.update({ "system.ecg.value": ecg, "system.toughness.value": s.toughness.max });
      msg = `Toughness restored${g.healEcg ? `, ECG cleared ${s.ecg.value - ecg}` : ""}.`;
    } else if (g.use === "healthpack") {
      const tn = Math.max(2, 1 + s.ecg.value);
      const inSafeRoom = await DialogV2.confirm({
        window: { title: item.name },
        content: `<p>Are you in a Safe Room? (No Test needed if you're at least Trained in Medicine.)</p>`,
        rejectClose: false
      });
      let success = inSafeRoom && s.skills.medicine.training >= 1;
      if (!success) {
        const res = await this.promptTest({ label: `${item.name} (Wits/Medicine, self)`, attribute: "wits", skill: "medicine", tn,
          complication: 1, complicationReason: "Treating yourself -1" });
        if (!res) return;
        success = res.result.successes > 0;
      }
      if (success) {
        await this.update({ "system.ecg.value": 0, "system.toughness.value": s.toughness.max });
        msg = "Fully healed: ECG cleared and Toughness restored.";
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

    if (g.use === "heal" || g.use === "healthpack") {
      if (this.statuses.has("bleeding")) msg += " Bleeding stops.";
      await removeCondition(this, "bleeding");             // any healing ends Bleeding
    }
    if (g.quantity <= 1) await item.delete();
    else await item.update({ "system.quantity": g.quantity - 1 });
    await chat(this, `<div class="ir-card"><h3>${this.name} uses ${item.name}</h3><p>${msg}</p></div>`);
  }
}
