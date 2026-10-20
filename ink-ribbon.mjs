/**
 * Ink Ribbon (Quick Start) - minimal Foundry VTT v14 system.
 * Entry point: registers data models, document class, sheets, settings, conditions and the Horror tracker.
 */
import { CONDITIONS } from "./module/config.mjs";
import { CharacterData, MonsterData, WeaponData, ArmourData, GearData, TalentData, AttackData, StorageData } from "./module/data.mjs";
import { InkActor, getHorror } from "./module/actor.mjs";
import { InkCharacterSheet, InkMonsterSheet, InkItemSheet, InkStorageSheet } from "./module/sheets.mjs";
import { HorrorTracker } from "./module/horror.mjs";
import { importStarter } from "./module/starter.mjs";
import { registerItemBoxSocket, toggleSafeRoom, getItemBox, itemBoxInstalled } from "./module/itembox.mjs";
import { buildCompendiums, ensureCompendiums } from "./module/compendium.mjs";
import { InkCombat, InkCombatant, onConditionGained, onAppear, addCondition, manualTurn } from "./module/rules.mjs";

/** Re-render open Ink Ribbon actor sheets (e.g. when the Safe Room opens or closes). */
function rerenderSheets() {
  for (const app of foundry.applications.instances?.values() ?? []) {
    if ((app instanceof InkCharacterSheet || app instanceof InkStorageSheet) && app.rendered) app.render();
  }
}

const SYS = "ink-ribbon";

Hooks.once("init", () => {
  console.log("Ink Ribbon | Initialising");

  // Data models: the schema for each Actor/Item type (replaces template.json).
  CONFIG.Actor.dataModels = { character: CharacterData, monster: MonsterData, npc: MonsterData, storage: StorageData };
  CONFIG.Item.dataModels = { weapon: WeaponData, armour: ArmourData, gear: GearData, talent: TalentData, attack: AttackData };
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
  DocumentSheetConfig.registerSheet(Actor, SYS, InkStorageSheet, { types: ["storage"], makeDefault: true, label: "Ink Ribbon Item Box" });
  DocumentSheetConfig.registerSheet(Item, SYS, InkItemSheet, { makeDefault: true, label: "Ink Ribbon Item" });

  // Horror (1-5) is shared world state, editable by the GM.
  game.settings.register(SYS, "horror", {
    name: "Horror", hint: "Current Horror level (1-5).",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 1, max: 5, step: 1 },
    onChange: () => HorrorTracker.instance?.render()
  });

  // Safe Room: while open, players can stash items in the shared Item Box.
  game.settings.register(SYS, "safeRoom", {
    name: "Safe Room open", scope: "world", config: false, type: Boolean, default: false,
    onChange: () => { HorrorTracker.instance?.render(); rerenderSheets(); }
  });
});

Hooks.once("ready", () => {
  HorrorTracker.instance = new HorrorTracker();
  HorrorTracker.instance.render({ force: true });
  registerItemBoxSocket();
  ensureCompendiums();
  if (game.user.isGM) itemBoxInstalled();      // warns if Foundry needs a full restart after a manifest change
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
  for (const id of effect.statuses ?? []) onConditionGained(effect.parent, id);
});

/** Horror +1 when a monster with "Horror on appear" shows up (placed visible, or revealed). */
Hooks.on("createToken", (tokenDoc, options, userId) => { if (userId === game.user.id && !tokenDoc.hidden) onAppear(tokenDoc); });
Hooks.on("updateToken", (tokenDoc, changes, options, userId) => { if (userId === game.user.id && changes.hidden === false) onAppear(tokenDoc); });

// Handy for macros: game.inkRibbon.horror()
Hooks.once("setup", () => {
  game.inkRibbon = { horror: getHorror, importStarter, buildCompendiums, toggleSafeRoom, itemBox: getItemBox, startTurn: manualTurn };
});
