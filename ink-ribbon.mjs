/**
 * Ink Ribbon (Quick Start) - minimal Foundry VTT v14 system.
 * Entry point: registers data models, document class, sheets, settings, conditions and the Horror tracker.
 */
import { CONDITIONS, RECIPES, SUPPLIES, TOOLS } from "./module/config.mjs";
import { CharacterData, MonsterData, WeaponData, ArmourData, GearData, TalentData, AttackData } from "./module/data.mjs";
import { InkActor, getHorror } from "./module/actor.mjs";
import { InkCharacterSheet, InkMonsterSheet, InkItemSheet, invDrag } from "./module/sheets.mjs";
import { HorrorTracker } from "./module/horror.mjs";
import { importStarter } from "./module/starter.mjs";
import { buildCompendiums, ensureCompendiums } from "./module/compendium.mjs";
import { InkCombat, InkCombatant, onConditionGained, onAppear, addCondition, manualTurn } from "./module/rules.mjs";
import { PACKABLE, shapeOf, resolveInventory, placementUpdate, itemTiles } from "./module/inventory.mjs";
import { registerSafeRoom, isSafeRoomOpen, toggleSafeRoom, makeItSafe } from "./module/safeRoom.mjs";
import { findSupplies, bindSupplyButtons } from "./module/supplies.mjs";
import * as infection from "./module/infection.mjs";
import { horrorCheck, rollZombieTrait } from "./module/scenario.mjs";

const SYS = "ink-ribbon";

Hooks.once("init", () => {
  console.log("Ink Ribbon | Initialising");

  // Data models: the schema for each Actor/Item type (replaces template.json).
  // Assigned key by key so modules can add their own sub-types (e.g. the Item Box module).
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, monster: MonsterData, npc: MonsterData });
  Object.assign(CONFIG.Item.dataModels, { weapon: WeaponData, armour: ArmourData, gear: GearData, talent: TalentData, attack: AttackData });
  CONFIG.Actor.documentClass = InkActor;

  // Conditions replace Foundry's default token status effects.
  CONFIG.statusEffects = CONDITIONS.map(({ id, name, img }) => ({ id, name, img }));
  CONFIG.specialStatusEffects.DEFEATED = "dead";

  // Free-flowing turn order: initiative isn't used, but keep the tracker working.
  CONFIG.Combat.initiative = { formula: "1d6", decimals: 0 };
  // Start/end of turn automation (Bleeding, Burning, Adrenaline, Self Healing, My Turn) and "acts last".
  CONFIG.Combat.documentClass = InkCombat;
  CONFIG.Combatant.documentClass = InkCombatant;

  // Sheets.
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, SYS, InkCharacterSheet, { types: ["character"], makeDefault: true, label: "Ink Ribbon Survivor" });
  DocumentSheetConfig.registerSheet(Actor, SYS, InkMonsterSheet, { types: ["monster", "npc"], makeDefault: true, label: "Ink Ribbon Monster / NPC" });
  DocumentSheetConfig.registerSheet(Item, SYS, InkItemSheet, { makeDefault: true, label: "Ink Ribbon Item" });

  // Horror (1-5) is shared world state, editable by the GM.
  game.settings.register(SYS, "horror", {
    name: "Horror", hint: "Current Horror level (1-5).",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 1, max: 5, step: 1 },
    onChange: () => HorrorTracker.instance?.render()
  });
  // IR-Virus infection (Dead on Arrival p.50). The booklet allows ignoring it in the Quick Start.
  game.settings.register(SYS, "infection", {
    name: "Infection rules", hint: "Use the IR-Virus infection rules (Dead on Arrival p.50): bite Test, hourly spread, stages. The booklet says you can ignore them.",
    scope: "world", config: true, type: Boolean, default: true
  });
  // Safe Room (rules p.34): the GM opens it from the Horror bar; rest, health packs and crafting read it.
  registerSafeRoom();
});

Hooks.once("ready", () => {
  HorrorTracker.instance = new HorrorTracker();
  HorrorTracker.instance.render({ force: true });
  ensureCompendiums();
});

/** Default icons for new items so the sheets don't look empty. */
Hooks.on("preCreateItem", (item, data) => {
  if (data.img) return;
  const icons = {
    weapon: "icons/svg/sword.svg", armour: "icons/svg/shield.svg", gear: "icons/svg/item-bag.svg",
    talent: "icons/svg/book.svg", attack: "icons/svg/blood.svg"
  };
  if (icons[item.type]) item.updateSource({ img: icons[item.type] });
});

/** Characters' tokens link to the actor and show bars by default. */
Hooks.on("preCreateActor", (actor, data) => {
  if (actor.type === "character") {
    actor.updateSource({ "prototypeToken.actorLink": true, "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY });
  } else if (actor.type === "monster") {
    actor.updateSource({ "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE });
  }
});

/** Chat card buttons: damage and conditions, applied to the selected tokens. */
Hooks.on("renderChatMessageHTML", (message, html) => {
  bindSupplyButtons(message, html);                       // Finding Supplies: Give buttons
  const selected = () => {
    const tokens = canvas.tokens.controlled;
    if (!tokens.length) ui.notifications.warn("Select the token(s) first.");
    return tokens.filter(t => {
      if (t.actor?.isOwner) return true;
      ui.notifications.warn(`You don't own ${t.name}.`);
      return false;
    });
  };
  for (const btn of html.querySelectorAll("[data-ir-damage]")) {
    btn.addEventListener("click", async ev => {
      ev.preventDefault();
      const d = btn.dataset;
      for (const t of selected()) {
        await t.actor.applyDamage(Number(d.irDamage), d.irMode, {
          headshot: !!d.irHeadshot, lethal: !!d.irLethal, weak: !!d.irWeak, label: d.irLabel ?? ""
        });
      }
    });
  }
  for (const btn of html.querySelectorAll("[data-ir-condition]")) {
    btn.addEventListener("click", async ev => {
      ev.preventDefault();
      for (const t of selected()) await addCondition(t.actor, btn.dataset.irCondition);
    });
  }
});

/** Condition side effects (Frightened: +1 Stress & Adrenaline; Dying -> Unconscious -> Prone + Incapacitated). */
Hooks.on("createActiveEffect", (effect, options, userId) => {
  if (userId !== game.user.id || !(effect.parent instanceof Actor)) return;
  for (const id of effect.statuses ?? []) {
    onConditionGained(effect.parent, id);
    if (id === "dead") infection.onDeath(effect.parent);   // infected survivors come back
  }
});

/** Horror +1 when a monster with "Horror on appear" shows up (placed visible, or revealed). */
Hooks.on("createToken", (tokenDoc, options, userId) => { if (userId === game.user.id && !tokenDoc.hidden) onAppear(tokenDoc); });
Hooks.on("updateToken", (tokenDoc, changes, options, userId) => { if (userId === game.user.id && changes.hidden === false) onAppear(tokenDoc); });

// Handy for macros (game.inkRibbon.horror()) and for add-on modules (game.inkRibbon.inventory).
// Add-on hooks: "inkRibbon.renderHorrorBar" (element) after the Horror bar draws;
// survivor sheets fire Foundry's usual "renderInkCharacterSheet" (app, element, context).
Hooks.once("setup", () => {
  game.inkRibbon = {
    horror: getHorror, importStarter, buildCompendiums, startTurn: manualTurn,
    renderHorrorBar: () => HorrorTracker.instance?.render(),
    crafting: { RECIPES, SUPPLIES, TOOLS },
    safeRoom: { isOpen: isSafeRoomOpen, toggle: toggleSafeRoom, makeItSafe },
    infection, horrorCheck, rollZombieTrait,
    findSupplies,  // hook: "inkRibbon.safeRoom" (open)               // actor.promptCraft() / actor.craft(recipeId, { safeRoom })
    inventory: { drag: invDrag, PACKABLE, shapeOf, resolveInventory, placementUpdate, itemTiles }
  };
});
