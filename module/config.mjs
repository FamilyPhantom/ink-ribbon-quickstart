// Static game data (Ink Ribbon Quick Start rules).

export const ATTRIBUTES = { strength: "Strength", agility: "Agility", wits: "Wits", heart: "Heart" };

// skill key: [label, default attribute]
export const SKILLS = {
  academics:   ["Academics", "wits"],
  athletics:   ["Athletics", "strength"],
  endurance:   ["Endurance", "strength"],
  engineering: ["Engineering", "wits"],
  fighting:    ["Fighting", "strength"],
  intuition:   ["Intuition", "heart"],
  medicine:    ["Medicine", "wits"],
  perception:  ["Perception", "wits"],
  rapport:     ["Rapport", "heart"],
  reasoning:   ["Reasoning", "wits"],
  reflexes:    ["Reflexes", "agility"],
  science:     ["Science", "wits"],
  shooting:    ["Shooting", "agility"],
  stealth:     ["Stealth", "agility"],
  willpower:   ["Willpower", "heart"]
};

// Rules p.15: Agility + Reflexes -> Defence
export function defenceFromTable(n) {
  if (n <= 1) return 2;
  if (n <= 3) return 3;
  if (n <= 5) return 4;
  if (n <= 7) return 5;
  return 6;
}

// ECG tracker: 5 boxes. 0 Unharmed, 1-2 Fine, 3-4 Caution, 5 Danger.
export function healthState(ecg) {
  if (ecg >= 5) return "Danger";
  if (ecg >= 3) return "Caution";
  if (ecg >= 1) return "Fine";
  return "Unharmed";
}

// Conditions (rules p.50-51), used as token status effects.
// defence: modifier, setDefence: forced value, pool: dice removed from all Tests, attackPool: dice removed from attacks,
// skillPool: { skill: dice } removed from Tests with that skill, hint: situational reminder shown in the roll dialog,
// noAdrenaline: can't use Adrenaline, tip: short summary shown on sheets.
export const CONDITIONS = [
  { id: "bleeding",      name: "Bleeding",      img: "icons/svg/blood.svg",
    tip: "1 damage (ignores Armour) at the start of your turn. Any healing ends it." },
  { id: "blinded",       name: "Blinded",       img: "icons/svg/blind.svg",       defence: -2, attackPool: 2, skillPool: { perception: 2 },
    hint: "Blinded: -2 dice on any Test that relies on sight (attacks and Perception are pre-filled).",
    tip: "Can't see. -2 dice on Tests that rely on sight. -2 Defence." },
  { id: "burning",       name: "Burning",       img: "icons/svg/fire.svg",
    tip: "3 damage (ignores Armour) at the start of your turn; Adjacent creatures take 1. An action douses it." },
  { id: "caught",        name: "Caught",        img: "icons/svg/net.svg",         defence: -1, attackPool: 2,
    tip: "Can't move. -1 Defence. -2 dice on attacks. Action: Strength (Athletics) or Agility (Reflexes) to escape." },
  { id: "dazed",         name: "Dazed",         img: "icons/svg/daze.svg",        defence: -1, pool: 1,
    tip: "-1 die on all Tests. -1 Defence." },
  { id: "deafened",      name: "Deafened",      img: "icons/svg/deaf.svg",
    hint: "Deafened: -2 dice if this Test relies on hearing.",
    tip: "Can't hear. -2 dice on Tests that rely on hearing." },
  { id: "frightened",    name: "Frightened",    img: "icons/svg/terror.svg",      pool: 1,
    hint: "Frightened: the -1 die only applies while the source of fear is in sight.",
    tip: "+1 Stress and +1 Adrenaline when gained. -1 die while the source is in sight. TN 5 Willpower to move closer." },
  { id: "incapacitated", name: "Incapacitated", img: "icons/svg/paralysis.svg",   setDefence: 2, noAdrenaline: true,
    tip: "Can't move, act or use Adrenaline. Defence 2." },
  { id: "prone",         name: "Prone",         img: "icons/svg/falling.svg",     attackPool: 1,
    tip: "Crawl or act, not both. -1 die on attacks. Adjacent attackers +2 dice; ranged attackers -1/-2/-3 by range. Action: stand up." },
  { id: "stunned",       name: "Stunned",       img: "icons/svg/lightning.svg",   defence: -2,
    hint: "Stunned: move or act, not both; no Adrenaline for extra actions.",
    tip: "Move or act, not both. No Adrenaline for extra actions. -2 Defence." },
  { id: "unconscious",   name: "Unconscious",   img: "icons/svg/unconscious.svg", setDefence: 2, noAdrenaline: true,
    tip: "Drops what you hold, falls Prone, Incapacitated. Unaware of surroundings." },
  { id: "dodging",       name: "Ready to Dodge",img: "icons/svg/upgrade.svg",     defence: 1,
    tip: "+1 Defence." },
  { id: "dying",         name: "Dying",         img: "icons/svg/degen.svg",       setDefence: 2, noAdrenaline: true,
    tip: "Unconscious. The GM rolls the Death Die." },
  { id: "dead",          name: "Dead",          img: "icons/svg/skull.svg" }
];
export const conditionById = id => CONDITIONS.find(c => c.id === id);

// Panic table (rules p.24), d66 ranges -> short effect.
export const PANIC_TABLE = [
  [11, 11, "Flee: run away from your allies (GM decides where). Stress -1d6. Allies who see it gain 1d3 Stress."],
  [12, 12, "Hopeless: -1 die on all Tests until you rest in a Safe Room."],
  [13, 14, "Light-Headed: -1 die on Agility Tests until you rest in a Safe Room."],
  [15, 16, "Freeze Up: Incapacitated for 1d6 rounds (or until damaged / snapped out of it)."],
  [21, 22, "Spiralling: -1 die on Heart Tests until you rest in a Safe Room."],
  [23, 24, "Adrenaline Dump: lose all Adrenaline; can't use it until you rest in a Safe Room."],
  [25, 26, "Overwhelmed: -1 die on Wits Tests until you rest in a Safe Room."],
  [31, 32, "Spray and Pray: guns use twice as many Shots until you rest in a Safe Room."],
  [33, 34, "Shaken: -1 die on Physique (Strength) Tests until you rest in a Safe Room."],
  [35, 36, "Clumsy: drop something you're holding or lose a 1-Slot item (GM chooses)."],
  [41, 42, "Terrified: Frightened (GM chooses source) until you rest in a Safe Room."],
  [43, 44, "Disoriented: Stunned for 1d3 rounds."],
  [45, 46, "Rage: +2 dice on melee attacks, -2 Defence until you rest. Allies who see it gain 1 Stress."],
  [51, 52, "Jumpy: gain 1 Stress. Allies in your Zone gain 1 Stress."],
  [53, 54, "Scream: everything within Long Range hears you. Stress -1d3. Allies who hear gain 1 Stress."],
  [55, 56, "Rattled: max Toughness halved until you rest in a Safe Room."],
  [61, 62, "Unnerved: gain 1 Stress."],
  [63, 64, "Adrenaline Rush: regain all Adrenaline and Stress -1d3."],
  [65, 66, "Hold it Together: you keep it together. Barely."]
];

export function panicEffect(d66) {
  return PANIC_TABLE.find(([lo, hi]) => d66 >= lo && d66 <= hi)?.[2] ?? "";
}

// Death Die (rules p.33)
export function deathResult(d) {
  if (d <= 3) return "Dead.";
  if (d <= 5) return "On the brink: dies in 1d6 rounds without immediate medical care.";
  return "Bleeding out: dies in 1d6 minutes without help.";
}

/* -------------------------------------------- */
/*  Crafting (rules p.46-47)                     */
/* -------------------------------------------- */

// Crafting supplies: gear items with system.supply set to one of these keys. Quantity = how many.
export const SUPPLIES = {
  green: "Green Flower", red: "Red Flower", yellow: "Yellow Flower",
  resources: "Resources", alcohol: "Alcohol", gunpowder: "Gunpowder", explosives: "Explosives"
};
// Crafting tools: gear items with system.tool set to one of these keys. They help but aren't required.
export const TOOLS = { craftingKit: "Crafting Kit", pestle: "Pestle & Mortar" };
// Advantages a tool gives on crafting Tests, by recipe kind (rules p.40-42):
// Crafting Kit: bullets and improvised explosives. Pestle and Mortar: healing items.
export const TOOL_ADVANTAGE = {
  craftingKit: { kinds: ["ammo", "throwable"], advantage: 1 },
  pestle: { kinds: ["heal"], advantage: 1 }
};

// What a failed crafting Test does, by kind:
// ammo = half the amount, heal = half as effective, throwable = half damage, silencer = +1 Complication when fitted.
export const CRAFT_FAILURE = {
  ammo: "Failed Test: you craft half the amount.",
  heal: "Failed Test: it's half as effective (half the Toughness, half the ECG spaces...).",
  throwable: "Failed Test: it deals half the damage.",
  silencer: "Failed Test: it adds a Complication when equipped to a gun.",
  "": "Failed Test: no extra effect listed (GM decides)."
};

// name, item created (matched by name), ingredients, tools, TN, Wits + one of these skills, amount, failure kind.
const recipe = (name, output, inputs, tools, tn, skills, amount, kind) =>
  ({ id: name, name, output, inputs, tools, tn, attribute: "wits", skills, amount, kind });
const KIT = ["craftingKit"], PESTLE = ["pestle"];
const SCI_ENG = ["science", "engineering"];

export const RECIPES = [
  recipe("Bolstering Herbs", "Bolstering Herb", { green: 1, yellow: 1 }, PESTLE, 5, ["medicine"], 1, "heal"),
  recipe("Bolstering Herbs (Advanced)", "Bolstering Herb (Advanced)", { green: 1, red: 1, yellow: 1 }, PESTLE, 6, ["medicine"], 1, "heal"),
  recipe("Explosive Rounds", "Explosive Rounds", { resources: 1, explosives: 2 }, KIT, 5, SCI_ENG, 2, "ammo"),
  recipe("Flame Rounds", "Flame Rounds", { resources: 1, explosives: 1, alcohol: 1 }, KIT, 5, SCI_ENG, 2, "ammo"),
  recipe("Handgun Ammo", "Handgun Ammo", { gunpowder: 1, resources: 1 }, KIT, 3, SCI_ENG, 12, "ammo"),
  recipe("Healing Herbs (Lesser)", "Healing Herb (Lesser)", { green: 1 }, PESTLE, 2, ["medicine"], 1, "heal"),
  recipe("Healing Herbs (Basic)", "Healing Herb (Basic)", { green: 2 }, PESTLE, 3, ["medicine"], 1, "heal"),
  recipe("Healing Herbs (Improved)", "Healing Herb (Improved)", { green: 3 }, PESTLE, 4, ["medicine"], 1, "heal"),
  recipe("Healing Herbs (Advanced)", "Healing Herb (Advanced)", { green: 1, red: 1 }, PESTLE, 5, ["medicine"], 1, "heal"),
  recipe("Health Kit", "Health Pack", { alcohol: 1, resources: 1, green: 1 }, ["craftingKit", "pestle"], 5, ["science", "medicine"], 1, "heal"),
  recipe("Magnum Ammo", "Magnum Ammo", { gunpowder: 3, resources: 1 }, KIT, 6, SCI_ENG, 6, "ammo"),
  recipe("Makeshift Silencer", "Makeshift Silencer", { resources: 2 }, KIT, 3, ["engineering"], 1, "silencer"),
  recipe("Molotov Cocktail", "Molotov Cocktail", { alcohol: 1, resources: 1 }, KIT, 4, SCI_ENG, 1, "throwable"),
  recipe("Pipe Bomb", "Pipe Bomb", { alcohol: 1, explosives: 1, resources: 1 }, KIT, 5, SCI_ENG, 1, "throwable"),
  recipe("Rifle Ammo", "Rifle Ammo", { gunpowder: 2, resources: 2 }, KIT, 5, SCI_ENG, 5, "ammo"),
  recipe("Shotgun Shells", "Shotgun Shells", { gunpowder: 2, resources: 1 }, KIT, 4, SCI_ENG, 4, "ammo"),
  recipe("Smoke Bomb", "Smoke Bomb", { explosives: 1, resources: 1 }, KIT, 4, SCI_ENG, 1, "throwable"),
  recipe("Submachine Gun Ammo", "Submachine Gun Ammo", { gunpowder: 1, resources: 2 }, KIT, 4, SCI_ENG, 6, "ammo")
];

/* -------------------------------------------- */
/*  Gun attachments (rules p.40-43)              */
/* -------------------------------------------- */

// Gear with system.attachment set can be fitted to a gun (Examine > Fit to gun). One per slot.
// Fitted attachments don't fill an Inventory Slot, except a Stock, which adds 1 to the gun's Size.
export const ATTACHMENTS = {
  silencer:          { label: "Silencer", slot: "muzzle", tip: "Removes the Loud Tag." },
  makeshiftSilencer: { label: "Makeshift Silencer", slot: "muzzle", tip: "Removes the Loud Tag for one Shot, then breaks." },
  scope:             { label: "Scope", slot: "scope", tip: "Range Band +1 (max Long). Long Range gun: an Advantage instead." },
  infrared:          { label: "Infrared Scope", slot: "scope", tip: "As a Scope; can remove Complications from smoke or darkness." },
  stock:             { label: "Stock", slot: "stock", tip: "An Advantage on ranged attacks. Gun Size +1 while fitted." },
  mag:               { label: "Expanded Mag", slot: "mag", tip: "Shots +50%." }
};
export const RANGE_BANDS = ["Adjacent", "Short", "Medium", "Long", "Extreme"];

/* -------------------------------------------- */
/*  Holsters (rules p.41)                        */
/* -------------------------------------------- */

// Each holster (gear with system.holster set) adds one Quick Item Slot that holds one weapon of the right Size.
// Up to two holsters count, in any combination.
export const HOLSTERS = {
  handgun: { label: "Handgun Holster", short: "Handgun", fits: size => size === 1, needs: "a 1-Slot weapon" },
  longgun: { label: "Long Gun Holster", short: "Long gun", fits: size => size >= 2 && size <= 3, needs: "a 2- or 3-Slot weapon" }
};
export const MAX_HOLSTERS = 2;

/* -------------------------------------------- */
/*  Finding Supplies (rules p.47-49)             */
/* -------------------------------------------- */

// Entries: an item name, or { t: table, x: multiplier, plus: upgrade }.
// t: healing | healingTwice | useful | crafting | commonAmmo | rareAmmo | commonGun | rareGun | uniqueGun | uniqueAmmo | gun (name)
const H = (t, extra = {}) => ({ t, ...extra });
// 3d6 -> [Horror 1-2, Horror 3, Horror 4, Horror 5]
export const FINDING_SUPPLIES = {
  3:  ["Health Pack", "Handgun Holster", "Yellow Flower", "Tactical Webbing"],
  4:  ["First-Aid Spray", "Backpack", "Long Gun Holster", "Yellow Flower"],
  5:  ["Red Flower", "Health Pack", "Handgun Holster", "Long Gun Holster"],
  6:  ["Green Flower", "Hip Pouch (Small)", "Health Pack", "Backpack"],
  7:  [H("healing"), "Red Flower", "First-Aid Spray", "Health Pack"],
  8:  ["One-handed Weapon", H("healing"), "Hip Pouch (Large)", "First-Aid Spray"],
  9:  [H("useful"), H("commonAmmo"), H("healing"), H("healingTwice")],
  10: [H("useful"), H("commonAmmo"), H("commonAmmo", { x: 2 }), H("commonAmmo", { x: 4 })],
  11: [H("crafting"), H("crafting", { x: 2 }), H("crafting", { x: 3 }), H("crafting", { x: 4 })],
  12: [H("crafting"), H("crafting", { x: 2 }), H("useful"), H("rareAmmo")],
  13: ["Two-handed Weapon", H("useful"), H("rareAmmo"), H("rareAmmo", { x: 2 })],
  14: [H("commonAmmo"), H("rareAmmo"), H("rareAmmo"), H("commonGun", { plus: true })],
  15: [H("commonAmmo"), H("rareAmmo"), H("rareGun"), H("rareGun", { plus: true })],
  16: [H("commonGun"), H("commonGun", { plus: true }), H("rareGun", { plus: true }), H("uniqueGun", { weapon: true })],
  17: [H("commonGun"), H("rareGun"), H("uniqueGun"), H("gun", { name: "Minigun" })],
  18: [H("rareGun"), H("uniqueGun"), H("uniqueAmmo"), H("gun", { name: "Rocket Launcher" })]
};
export const horrorColumn = horror => horror <= 2 ? 0 : horror === 3 ? 1 : horror === 4 ? 2 : 3;

// [low, high, result] tables
export const USEFUL_ITEM = [[3, 3, "Long Gun Holster"], [4, 4, "Handgun Holster"], [5, 5, "Sedative"], [6, 6, "Adrenaline Shot"],
  [7, 8, "Flashlight"], [9, 10, "One-handed Weapon"], [11, 12, "Two-handed Weapon"], [13, 14, "Camping Lantern"],
  [15, 15, "Hip Pouch (Small)"], [16, 16, "Hip Pouch (Large)"], [17, 17, "Backpack"], [18, 18, "Tactical Webbing"]];
export const HEALING_ITEM = [[1, 3, "Green Flower"], [4, 4, "Red Flower"], [5, 5, "First-Aid Spray"], [6, 6, "Health Pack"]];
export const CRAFTING_FIND = [[1, 3, "Resources"], [4, 4, "Alcohol"], [5, 5, "Gunpowder"], [6, 6, "Explosives"]];
// Guns: weapon, Shots (left in the gun, or ammo found), the ammo item ("" = fuel with no item; several = GM picks).
export const GUN_TABLES = {
  common: [[1, 3, { weapon: "Handgun", shots: "2d6", ammo: ["Handgun Ammo"] }], [4, 5, { weapon: "Shotgun", shots: "1d3", ammo: ["Shotgun Shells"] }],
           [6, 6, { weapon: "Submachine Gun", shots: "1d6", ammo: ["Submachine Gun Ammo"] }]],
  rare:   [[1, 3, { weapon: "Rifle", shots: "1d6", ammo: ["Rifle Ammo"] }], [4, 4, { weapon: "Crossbow", shots: "1d6", ammo: ["Crossbow Bolts"] }],
           [5, 5, { weapon: "Grenade Launcher", shots: "1d3", ammo: ["Explosive Rounds", "Flame Rounds"] }], [6, 6, { weapon: "Magnum", shots: "1d6", ammo: ["Magnum Ammo"] }]],
  unique: [[1, 2, { weapon: "Chainsaw", shots: "2d6", ammo: [], fuel: true }], [3, 4, { weapon: "Flamethrower", shots: "1d6", ammo: ["Flamethrower Fuel"], fuel: true }],
           [5, 5, { weapon: "Minigun", shots: "4d6", ammo: ["Minigun Ammo"] }], [6, 6, { weapon: "Rocket Launcher", shots: "1", ammo: ["Rocket"] }]]
};
export const lookup = (table, n) => table.find(([lo, hi]) => n >= lo && n <= hi)?.[2];
