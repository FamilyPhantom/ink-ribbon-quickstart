/**
 * Starter content for Dead on Arrival: monsters, weapons, armour and gear.
 * Installed with game.inkRibbon.importStarter().
 * Ability text is a short GM reminder; see the booklets for full wording.
 */

const sk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { training: v }]));
const atk = (name, kind, pool, damage, description = "", extra = {}) =>
  ({ name, type: "attack", img: "icons/svg/blood.svg",
     system: { kind, pool, damage, range: kind === "ranged" ? "Medium" : "Adjacent", description, ...extra } });
const ZOMBIE = { aimForHead: true, backFromDead: true };

const ZOMBIE_TRAITS = `Aim For the Head: headshots deal double damage. A headshot that drops Toughness to 0 kills instantly (no Back From the Dead). Targeting the head: +1 Defence vs melee, +2 vs ranged.
Back From the Dead: the first time Toughness hits 0, roll 1d6. If <= Horror it isn't dead and regains 1d3 Toughness at the start of its next turn.`;

const DOG_TRAITS = `Fast: moves one extra Zone when it moves or runs.
Pounce: if it moves Zones and then Bites successfully, the target is knocked Prone.`;

export const MONSTERS = [
  {
    name: "Zombie Shambler", type: "monster", img: "icons/svg/skull.svg",
    system: { enemyType: "horde", attributes: { strength: 2, agility: 2, wits: 1, heart: 1 },
      toughness: { value: 3, max: 3 }, defence: { base: 3 }, armour: { value: 0 },
      skills: sk({ endurance: 3, fighting: 1 }), traits: { ...ZOMBIE, vsRanged: 1, actsLast: true },
      abilities: `${ZOMBIE_TRAITS}\nShambler: +1 Defence vs ranged attacks. Always acts last, ignoring turn order.` },
    items: [atk("Grab", "melee", 3, 0, "Instead of damage, the target is Caught.", { conditions: "caught" }), atk("Bite", "melee", 3, 2)]
  },
  {
    name: "Zombie Walker", type: "monster", img: "icons/svg/skull.svg",
    system: { enemyType: "horde", attributes: { strength: 3, agility: 2, wits: 2, heart: 1 },
      toughness: { value: 4, max: 4 }, defence: { base: 4 }, armour: { value: 0 },
      skills: sk({ athletics: 1, endurance: 3, fighting: 1 }), traits: { ...ZOMBIE }, abilities: ZOMBIE_TRAITS },
    items: [atk("Scratch", "melee", 4, 1, "Can grab instead of dealing damage: target is Caught.", { conditions: "caught" }), atk("Bite", "melee", 4, 2)]
  },
  {
    name: "Zombie Runner", type: "monster", img: "icons/svg/skull.svg",
    system: { enemyType: "horde", attributes: { strength: 4, agility: 4, wits: 3, heart: 2 },
      toughness: { value: 6, max: 6 }, adrenaline: { value: 1, max: 1 }, defence: { base: 5 }, armour: { value: 0 },
      skills: sk({ athletics: 2, endurance: 3, fighting: 2, reflexes: 2 }), traits: { ...ZOMBIE, adrenalineRegen: 1 },
      abilities: `${ZOMBIE_TRAITS}\nRunner: moves one extra Zone when it moves or runs.\nRegains 1 Adrenaline at the start of its turn.` },
    items: [atk("Scratch", "melee", 6, 1, "Can grab instead of dealing damage: target is Caught.", { conditions: "caught" }), atk("Bite", "melee", 6, 2)]
  },
  {
    name: "Infected Dog", type: "monster", img: "icons/svg/terror.svg",
    system: { enemyType: "horde", attributes: { strength: 3, agility: 4, wits: 2, heart: 2 },
      toughness: { value: 5, max: 5 }, defence: { base: 5 }, armour: { value: 0 },
      skills: sk({ athletics: 1, fighting: 1, reflexes: 2 }), traits: { mutatesInto: "Mutated Dog" },
      abilities: `${DOG_TRAITS}\nViolent Mutation: the first time it takes damage but isn't killed, roll 1d6. If <= Horror it becomes a Mutated Dog (Toughness 6).` },
    items: [atk("Bite", "melee", 4, 3, "If it deals damage, it latches on (target Caught). Pounce: Prone if it moved Zones first.", { conditions: "caught, prone" }),
      atk("Latched Bite", "melee", 0, 2, "While latched on: an action deals 2 damage, no Test.", { noTest: true })]
  },
  {
    name: "Mutated Dog", type: "monster", img: "icons/svg/terror.svg",
    system: { enemyType: "horde", attributes: { strength: 4, agility: 4, wits: 2, heart: 3 },
      toughness: { value: 7, max: 7 }, adrenaline: { value: 2, max: 2 }, defence: { base: 5 }, armour: { value: 1 },
      skills: sk({ athletics: 1, fighting: 2, reflexes: 2 }), traits: { grotesque: true, adrenalineRegen: 1 },
      abilities: `${DOG_TRAITS}\nGrotesque: first sighting = 1 Stress + Panic Test. Later sightings: TN 4 Heart (Willpower) or 1 Stress.\nRegains 1 Adrenaline at the start of its turn.` },
    items: [atk("Bite", "melee", 6, 4, "If it deals damage, it latches on (target Caught). Can still bite with its other mouth. Pounce: Prone if it moved Zones first.", { conditions: "caught, prone" }),
      atk("Latched Bite", "melee", 0, 2, "While latched on: an action deals 2 damage, no Test.", { noTest: true })]
  },
  {
    name: "The Scourge (First Form)", type: "monster", img: "icons/svg/mystery-man-black.svg",
    system: { enemyType: "nemesis", attributes: { strength: 6, agility: 3, wits: 5, heart: 4 },
      toughness: { value: 10, max: 10 }, health: { value: 10, max: 10 }, adrenaline: { value: 2, max: 2 },
      defence: { base: 3 }, armour: { value: 1 }, skills: sk({ endurance: 2, fighting: 1 }),
      traits: { selfHeal: 3, adrenalineRegen: 1, horrorOnAppear: true },
      weak: { label: "Unstable Chemicals", count: 3, max: 3, tn: 6, threshold: 3, selfDamage: 5, selfCondition: "incapacitated", selfRounds: "1d6", splashDamage: 3, splashCondition: "burning" },
      abilities: `Self Healing: regains 3 Toughness at the start of each round.
Smell Infected: smells infected creatures up to a mile away. Targets other infected before survivors.
Unstable Chemicals: 3 canisters (TN 6 to target). 3+ damage from one source explodes one: adjacent creatures take 3 damage + Burning 3 rounds; the Scourge takes 5 and is Incapacitated 1d6 rounds (each round roll 1d6, <= Horror ends it).
Regains 1 Adrenaline at the start of its turn. Horror +1 each time it appears.` },
    items: [
      atk("Pummel", "melee", 7, 3, "Can grab instead of damage: target Caught.", { conditions: "caught" }),
      atk("Chains", "ranged", 4, 2, "Can grab instead of damage: target Caught.", { conditions: "caught" }),
      atk("Throw", "ranged", 6, 0, "Throw a Caught creature into an adjacent Zone: 4 damage + Prone. Or at another target (Str + Shooting vs Defence): hit = both take damage equal to successes + Prone; miss = thrown creature takes 2 + Prone. Use Take Damage for the amounts.", { conditions: "prone" })
    ]
  },
  {
    name: "The Scourge (Second Form)", type: "monster", img: "icons/svg/mystery-man-black.svg",
    system: { enemyType: "nemesis", attributes: { strength: 8, agility: 5, wits: 3, heart: 4 },
      toughness: { value: 12, max: 12 }, health: { value: 10, max: 10 }, adrenaline: { value: 2, max: 2 },
      defence: { base: 4 }, armour: { value: 2 }, skills: sk({ endurance: 3, fighting: 2 }),
      traits: { selfHeal: 4, adrenalineRegen: 1, extraTurn: true, roar: true },
      weak: { label: "Putrid Growths", count: 4, max: 4, tn: 6, threshold: 2, selfDamage: 4, selfCondition: "prone" },
      abilities: `My Turn: after its turn, roll 1d6. If <= Horror it takes an extra turn.
Putrid Growths: 4 sacks (TN 6 to target). 2+ damage from one source bursts one: Scourge takes 4 and is knocked Prone.
Self Healing: regains 4 Toughness at the start of each round.
Smell Infected. Wall-Climber.
Regains 1 Adrenaline at the start of its turn.` },
    items: [
      atk("Claws", "melee", 10, 3),
      atk("Bite", "melee", 7, 4, "If this would make the target Dying, they die instantly.", { lethal: true }),
      atk("Pounce", "melee", 10, 3, "Leaps to an adjacent Zone and makes a Claws attack.")
    ]
  }
];

const wpn = (name, category, damage, size, tags, range, shots = 0, description = "", extra = {}) => ({
  name, type: "weapon", img: category === "melee" ? "icons/svg/sword.svg" : "icons/svg/target.svg",
  system: { category, damage, size, tags, range, shots: { value: shots, max: shots }, description, ...extra }
});

export const ITEMS = [
  wpn("Unarmed", "melee", 1, 0, "Inferior", "Adjacent"),
  wpn("Improvised Weapon", "melee", 2, 1, "Brittle", "Adjacent", 0, "1-3 damage, 1-2 Slots, GM decides."),
  wpn("One-handed Weapon", "melee", 2, 1, "", "Adjacent", 0, "Kitchen knife, hatchet, hammer..."),
  wpn("Two-handed Weapon", "melee", 3, 2, "Two-handed", "Adjacent", 0, "Sledgehammer, fire axe..."),
  wpn("Chainsaw", "melee", 8, 2, "Heavy, Loud, Two-handed", "Adjacent", 10, "Uses fuel (max 10). Each attack costs 1 fuel (Shots). No fuel item in the gear table: the GM decides when it can be refuelled."),
  wpn("Handgun", "ranged", 3, 1, "Loud, Up Close", "Medium", 12, "", { ammo: "Handgun Ammo" }),
  wpn("Magnum", "ranged", 8, 1, "Loud, Up Close", "Medium", 6, "", { ammo: "Magnum Ammo" }),
  wpn("Shotgun", "ranged", 6, 2, "Loud, Spray, Two-handed, Up Close", "Short", 4, "", { ammo: "Shotgun Shells" }),
  wpn("Rifle", "ranged", 5, 3, "Loud, Two-handed", "Long", 5, "", { ammo: "Rifle Ammo" }),
  wpn("Submachine Gun", "ranged", 4, 2, "Full-auto, Loud, Two-handed", "Medium", 6, "", { ammo: "Submachine Gun Ammo" }),
  wpn("Crossbow", "ranged", 4, 2, "Two-handed", "Long", 1, "", { ammo: "Crossbow Bolts" }),
  wpn("Flamethrower", "ranged", 6, 3, "Blaze, Spray, Two-handed", "Short", 6, "Shots are bursts of fuel.", { ammo: "Flamethrower Fuel" }),
  wpn("Grenade Launcher", "ranged", 8, 2, "Two-handed", "Medium", 1, "Damage and Tags depend on the round loaded: Explosive Round 8 (Explosive, Loud), Flame Round 6 (Blaze, Loud, Spray). Reload picks the round.",
    { ammo: "Explosive Rounds, Flame Rounds", loaded: "Explosive Rounds", loadedDamage: 8, loadedTags: "Explosive, Loud" }),
  wpn("Minigun", "ranged", 5, 4, "Full-auto, Heavy, Loud, Spray, Two-handed", "Long", 20, "", { ammo: "Minigun Ammo" }),
  wpn("Rocket Launcher", "ranged", 20, 4, "Explosive, Heavy, Loud, Two-handed", "Long", 1, "", { ammo: "Rocket" }),
  wpn("Grenade", "thrown", 10, 1, "Explosive, Loud", "Medium", 0, "Single use. Target a Zone at TN 3. Everyone else in the Zone takes half.", { singleUse: true }),
  wpn("Molotov Cocktail", "thrown", 6, 1, "Blaze, Loud, Spray", "Medium", 0, "Single use. Target gains Burning.", { singleUse: true }),
  wpn("Pipe Bomb", "thrown", 5, 1, "Explosive, Loud", "Medium", 0, "Single use.", { singleUse: true }),
  wpn("Smoke Bomb", "thrown", 2, 1, "Explosive, Loud", "Medium", 0, "Single use. Adds a Complication to the target Zone.", { singleUse: true }),

  { name: "Light Armour", type: "armour", img: "icons/svg/shield.svg", system: { rating: 1, size: 1, equipped: true, description: "Heavy layers, leather coat, football pads." } },
  { name: "Medium Armour", type: "armour", img: "icons/svg/shield.svg", system: { rating: 2, size: 2, equipped: true, description: "Stab vest, Kevlar vest, biker leathers." } },
  { name: "Heavy Armour", type: "armour", img: "icons/svg/shield.svg", system: { rating: 3, size: 3, equipped: true, description: "Full tactical gear. Requires Strength 4 or Armour Training." } },

  { name: "Healing Herb (Lesser)", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 0, size: 1, description: "1 green flower. Fully restores Toughness." } },
  { name: "Healing Herb (Basic)", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 1, size: 1, description: "2 green. Clear 1 ECG space, restore Toughness." } },
  { name: "Healing Herb (Improved)", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 2, size: 1, description: "3 green. Clear 2 ECG spaces, restore Toughness." } },
  { name: "Healing Herb (Advanced)", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 3, size: 1, description: "Green + red. Clear 3 ECG spaces, restore Toughness." } },
  { name: "First-Aid Spray", type: "gear", img: "icons/svg/heal.svg", system: { stack: 1, use: "heal", healEcg: 2, size: 1, description: "Action. Clear 2 ECG spaces, restore all Toughness." } },
  { name: "Health Pack", type: "gear", img: "icons/svg/regen.svg", system: { stack: 1, use: "healthpack", size: 1, description: "Action + Wits (Medicine) Test, TN 1 + filled ECG spaces (self: +1 Complication). No Test in a Safe Room if Trained." } },
  { name: "Adrenaline Shot", type: "gear", img: "icons/svg/upgrade.svg", system: { use: "adrenaline", stack: 3, size: 1, description: "Free action. Regain all Adrenaline, +1 each round for 1 minute. Stack (3)." } },
  { name: "Handgun Ammo", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 12, stack: 50, size: 1, description: "Stack (50). Quantity = Shots." } },
  { name: "Shotgun Shells", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 4, stack: 20, size: 1, description: "Stack (20). Quantity = Shots." } },
  { name: "Rifle Ammo", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 5, stack: 20, size: 1, description: "Stack (20). Quantity = Shots." } },
  { name: "Magnum Ammo", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 6, stack: 50, size: 1, description: "Stack (50). Quantity = Shots." } },
  { name: "Submachine Gun Ammo", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 6, stack: 30, size: 1, description: "Stack (30). Quantity = Shots." } },
  { name: "Explosive Rounds", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 2, stack: 6, size: 1, round: { damage: 8, tags: "Explosive, Loud" }, description: "Grenade Launcher round: 8 damage, Explosive, Loud. Stack (6)." } },
  { name: "Flame Rounds", type: "gear", img: "icons/svg/fire.svg", system: { quantity: 2, stack: 6, size: 1, round: { damage: 6, tags: "Blaze, Loud, Spray" }, description: "Grenade Launcher round: 6 damage, Blaze, Loud, Spray. Stack (6)." } },
  { name: "Bolstering Herb", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 1, toughnessGain: 1, size: 1, description: "Green + yellow. Clear 1 ECG space, fully restore Toughness, permanently +1 Toughness." } },
  { name: "Bolstering Herb (Advanced)", type: "gear", img: "icons/svg/oak.svg", system: { stack: 1, use: "heal", healEcg: 5, toughnessGain: 2, size: 1, description: "Green + red + yellow. Clear all ECG spaces, fully restore Toughness, permanently +2 Toughness." } },
  { name: "Makeshift Silencer", type: "gear", img: "icons/svg/silenced.svg", system: { attachment: "makeshiftSilencer", stack: 1, size: 1, description: "Removes the Loud Trait from a gun for a single Shot, then breaks." } },

  // Crafting supplies (rules p.46): Quantity = how many you have. The Supply field is what recipes look for.
  { name: "Green Flower", type: "gear", img: "icons/svg/oak.svg", system: { supply: "green", stack: 1, size: 1, description: "Medicinal plant found only in Sparrow's Rest." } },
  { name: "Red Flower", type: "gear", img: "icons/svg/oak.svg", system: { supply: "red", stack: 1, size: 1, description: "Medicinal plant found only in Sparrow's Rest." } },
  { name: "Yellow Flower", type: "gear", img: "icons/svg/oak.svg", system: { supply: "yellow", stack: 1, size: 1, description: "Medicinal plant found only in Sparrow's Rest." } },
  { name: "Resources", type: "gear", img: "icons/svg/item-bag.svg", system: { supply: "resources", stack: 4, size: 1, description: "Scrap bits, canisters, containers, rags, tape..." } },
  { name: "Alcohol", type: "gear", img: "icons/svg/tankard.svg", system: { supply: "alcohol", stack: 1, size: 1, description: "High-proof alcohol, chemicals, cleaning supplies." } },
  { name: "Gunpowder", type: "gear", img: "icons/svg/item-bag.svg", system: { supply: "gunpowder", stack: 4, size: 1, description: "Gunpowder, or sulfur, charcoal and saltpetre." } },
  { name: "Explosives", type: "gear", img: "icons/svg/hazard.svg", system: { supply: "explosives", stack: 2, size: 1, description: "Chemicals or improvised ingredients like sugar and fertiliser." } },
  // Crafting tools: help, but aren't required.
  { name: "Crafting Kit", type: "gear", img: "icons/svg/clockwork.svg", system: { tool: "craftingKit", stack: 1, size: 1, description: "Crafting tool. An Advantage when crafting bullets and improvised explosives (applied automatically)." } },
  { name: "Pestle & Mortar", type: "gear", img: "icons/svg/acid.svg", system: { tool: "pestle", stack: 1, size: 1, description: "Crafting tool. An Advantage when crafting healing items (applied automatically)." } },

  { name: "Flamethrower Fuel", type: "gear", img: "icons/svg/fire.svg", system: { quantity: 6, stack: 12, size: 1, description: "Stack (12). Quantity = Shots." } },
  { name: "Minigun Ammo", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 20, stack: 20, size: 1, description: "Stack (20). Quantity = Shots." } },
  { name: "Rocket", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 1, stack: 1, size: 1, description: "Rocket Launcher ammo. Each Rocket takes its own Slot." } },
  { name: "Crossbow Bolts", type: "gear", img: "icons/svg/item-bag.svg", system: { quantity: 5, stack: 10, size: 1, description: "Stack (10). Quantity = Shots." } },
  { name: "Sedative", type: "gear", img: "icons/svg/sleep.svg", system: { use: "sedative", stack: 3, size: 1, description: "Free action: Stress -1d3. For the next hour, whenever you'd gain Stress roll 1d6: if it's at most your Heart, you don't." } },
  { name: "Tactical Webbing", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, slotBonus: 4, description: "+4 Inventory Slots while carried (applied automatically)." } },
  { name: "Quick Loader", type: "gear", img: "icons/svg/item-bag.svg", system: { stack: 1, size: 1, description: "Preloaded: reload as a free action, once per action scene. Must match the gun." } },
  { name: "Silencer", type: "gear", img: "icons/svg/silenced.svg", system: { attachment: "silencer", stack: 1, size: 1, description: "Removes the Loud Tag from a gun. Must match the gun. No Slot while fitted." } },
  { name: "Scope", type: "gear", img: "icons/svg/eye.svg", system: { attachment: "scope", stack: 1, size: 1, description: "Gun's Range Band +1 (max Long); on a Long Range gun, an Advantage on attacks instead. No Slot while fitted." } },
  { name: "Infrared Scope", type: "gear", img: "icons/svg/eye.svg", system: { attachment: "infrared", stack: 1, size: 1, description: "As a Scope, and you see heat signatures: can remove Complications caused by smoke or darkness. No Slot while fitted." } },
  { name: "Expanded Mag", type: "gear", img: "icons/svg/item-bag.svg", system: { attachment: "mag", stack: 1, size: 1, description: "Gun's Shots +50% (rounded down). Must match the gun. No Slot while fitted." } },
  { name: "Stock", type: "gear", img: "icons/svg/item-bag.svg", system: { attachment: "stock", stack: 1, size: 1, description: "An Advantage on all ranged attacks with this gun. 1 Slot when not fitted; the gun's Size +1 when fitted." } },
  { name: "Flashlight", type: "gear", img: "icons/svg/light.svg", system: { use: "light", size: 1, description: "Lights creatures and objects within Medium Range (seen from Long Range). Held or taped to your gun: removes Complications from darkness on attacks. About 12 hours. Use = Losing Light check." } },
  { name: "Camping Lantern", type: "gear", img: "icons/svg/light.svg", system: { use: "light", size: 1, description: "Lights a whole Zone (not adjacent Zones); carry it or set it down. Removes Complications caused by darkness. 12 hours to a few days. Use = Losing Light check." } },
  { name: "Lockpicks", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 1, description: "Agility (Engineering) Test, TN set by the GM." } },
  { name: "Bolt Cutters", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 2, description: "Cut fences, chains, deadbolts." } },
  { name: "Riot Shield", type: "gear", img: "icons/svg/shield.svg", system: { size: 3, defenceBonus: 1, reflexesBonus: 2, description: "Ready it (Examine > Ready) for +1 Defence and +2 dice on Agility (Reflexes) to avoid danger. Both are applied automatically while ready." } },
  { name: "Backpack", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, slotBonus: 3, description: "+3 Inventory Slots while carried (applied automatically)." } },
  { name: "Hip Pouch (Small)", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, slotBonus: 1, description: "+1 Inventory Slot while carried (applied automatically)." } },
  { name: "Hip Pouch (Large)", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, slotBonus: 2, description: "+2 Inventory Slots while carried (applied automatically)." } },
  { name: "Handgun Holster", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, holster: "handgun", description: "+1 Quick Item Slot that holds one 1-Slot weapon (automatic). Up to 2 holsters, any combination." } },
  { name: "Long Gun Holster", type: "gear", img: "icons/svg/item-bag.svg", system: { size: 0, holster: "longgun", description: "+1 Quick Item Slot that holds one 2- or 3-Slot weapon (automatic). Up to 2 holsters, any combination." } },

  { name: "Brawler", type: "talent", img: "icons/svg/book.svg", system: { ignoreStress: 2, ignoreSkills: "fighting", description: "Ignore up to 2 Stress on Fighting Tests (pre-filled)." } },
  { name: "Firearms Training", type: "talent", img: "icons/svg/book.svg", system: { ignoreStress: 2, ignoreSkills: "shooting", description: "Ignore up to 2 Stress on Shooting Tests (pre-filled)." } },
  { name: "Medical Training", type: "talent", img: "icons/svg/book.svg", system: { ignoreStress: 2, ignoreSkills: "medicine", description: "Ignore up to 2 Stress on Medicine Tests (pre-filled)." } },
  { name: "Immune", type: "talent", img: "icons/svg/book.svg", system: { description: "Immune to the common strain of the IR-Virus (the infection Test is skipped automatically)." } },
  { name: "Hard to Kill", type: "talent", img: "icons/svg/book.svg", system: { toughness: 2, description: "+2 Toughness (applied automatically)." } },
  { name: "Nimble", type: "talent", img: "icons/svg/book.svg", system: { defence: 1, advantage: 1, advSkill: "reflexes", advNote: "to dodge", description: "+1 Defence (automatic) and an Advantage on Reflexes Tests to dodge (pre-filled)." } }
];

/** Create everything in folders. Existing starter documents (same name) can be refreshed to the latest data. */
export async function importStarter() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can import starter content.");
  const folder = async (name, type) =>
    game.folders.find(f => f.name === name && f.type === type) ?? Folder.create({ name, type, color: "#5a1410" });

  const mFolder = await folder("Dead on Arrival: Monsters", "Actor");
  const iFolder = await folder("Ink Ribbon: Equipment", "Item");

  const newActors = MONSTERS.filter(m => !game.actors.getName(m.name)).map(m => ({ ...m, folder: mFolder.id }));
  const newItems = ITEMS.filter(i => !game.items.getName(i.name)).map(i => ({ ...i, folder: iFolder.id }));
  await Actor.createDocuments(newActors);
  await Item.createDocuments(newItems);

  // Refresh what was imported before (only documents in the starter folders, so your own copies are left alone).
  const oldActors = MONSTERS.map(m => [m, game.actors.find(a => a.name === m.name && a.folder?.id === mFolder.id)]).filter(([m, a]) => a && !newActors.some(n => n.name === m.name));
  const oldItems = ITEMS.map(i => [i, game.items.find(x => x.name === i.name && x.folder?.id === iFolder.id)]).filter(([i, x]) => x && !newItems.some(n => n.name === i.name));
  let refreshed = 0;
  if ((oldActors.length || oldItems.length) && await foundry.applications.api.DialogV2.confirm({
    window: { title: "Refresh starter content?" },
    content: `<p>${oldActors.length} monster(s) and ${oldItems.length} item(s) were imported earlier. Update them to the latest rules data (traits, attacks, ammo...)?</p>
      <p class="hint">Edits you made to those copies will be overwritten. Monsters already placed on scenes as unlinked tokens keep their old data.</p>`,
    rejectClose: false
  })) {
    for (const [m, actor] of oldActors) {
      await actor.update({ system: m.system });
      const ids = actor.items.map(i => i.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
      if (m.items?.length) await actor.createEmbeddedDocuments("Item", m.items);
    }
    for (const [i, item] of oldItems) await item.update({ system: i.system });
    refreshed = oldActors.length + oldItems.length;
  }
  ui.notifications.info(`Ink Ribbon: imported ${newActors.length} monsters and ${newItems.length} items${refreshed ? `, refreshed ${refreshed}` : ""}.`);
}
