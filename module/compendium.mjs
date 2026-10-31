// Builds world compendiums from the starter content (starter.mjs).
// Players can browse Equipment and Talents and drag them onto their sheets; Monsters are GM-only.
// Runs once automatically for the GM; rebuild any time with game.inkRibbon.buildCompendiums().
import { MONSTERS, ITEMS } from "./starter.mjs";

const CompendiumCollection = foundry.documents.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;

const PLAYERS_VIEW = { PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER" };
const GM_ONLY = { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" };

const PACKS = [
  { name: "ink-ribbon-equipment", label: "Ink Ribbon: Equipment", type: "Item", ownership: PLAYERS_VIEW,
    docs: () => ITEMS.filter(i => i.type !== "talent"),
    folders: { weapon: "Weapons", armour: "Armour", gear: "Gear" } },
  { name: "ink-ribbon-talents", label: "Ink Ribbon: Talents", type: "Item", ownership: PLAYERS_VIEW,
    docs: () => ITEMS.filter(i => i.type === "talent") },
  { name: "ink-ribbon-monsters", label: "Dead on Arrival: Monsters", type: "Actor", ownership: GM_ONLY,
    docs: () => MONSTERS }
];

async function getOrCreatePack(def, sidebarFolder) {
  let pack = game.packs.get(`world.${def.name}`);
  if (!pack) pack = await CompendiumCollection.createCompendium({ name: def.name, label: def.label, type: def.type });
  await pack.configure({ ownership: def.ownership, folder: sidebarFolder.id, locked: false });
  return pack;
}

/** Create (or refresh) all packs. Refreshing replaces the pack contents with the starter data. */
export async function buildCompendiums({ quiet = false } = {}) {
  if (!game.user.isGM) return;
  const sidebarFolder = game.folders.find(f => f.type === "Compendium" && f.name === "Ink Ribbon")
    ?? await Folder.create({ name: "Ink Ribbon", type: "Compendium", color: "#5a1410" });

  for (const def of PACKS) {
    const pack = await getOrCreatePack(def, sidebarFolder);
    const cls = pack.documentClass;
    const index = await pack.getIndex();
    if (index.size) await cls.deleteDocuments([...index.keys()], { pack: pack.collection });

    // Sub-folders inside the pack (e.g. Weapons / Armour / Gear).
    const folderIds = {};
    for (const [type, name] of Object.entries(def.folders ?? {})) {
      const existing = pack.folders.find(f => f.name === name);
      folderIds[type] = (existing ?? await Folder.create({ name, type: def.type }, { pack: pack.collection })).id;
    }
    const docs = def.docs().map(d => ({ ...d, folder: folderIds[d.type] ?? null }));
    await cls.createDocuments(docs, { pack: pack.collection });
    await pack.configure({ locked: true });
  }
  if (!quiet) ui.notifications.info("Ink Ribbon: compendiums built (Equipment, Talents, Monsters).");
}

/**
 * Item data to give a survivor (crafting, Finding Supplies), keeping your art.
 * Looks in: world Items sidebar -> Equipment compendium -> starter data.
 */
export async function itemSource(name, types = ["weapon", "gear", "armour"]) {
  let doc = game.items.find(i => i.name === name && types.includes(i.type));
  if (!doc) {
    const pack = game.packs.get("world.ink-ribbon-equipment");
    if (pack) {
      const entry = (await pack.getIndex()).find(e => e.name === name);
      if (entry) doc = await pack.getDocument(entry._id);
    }
  }
  const src = doc ? doc.toObject() : foundry.utils.deepClone(ITEMS.find(i => i.name === name) ?? { name, type: "gear", img: "icons/svg/item-bag.svg", system: {} });
  delete src._id; delete src.folder; delete src.sort; delete src.ownership; delete src._stats;
  src.system ??= {};
  return src;
}

/** First launch: build automatically if the packs don't exist yet. */
export async function ensureCompendiums() {
  if (game.user !== game.users.activeGM) return;
  if (PACKS.every(p => game.packs.has(`world.${p.name}`))) return;
  await buildCompendiums({ quiet: true });
  ui.notifications.info("Ink Ribbon: created the Equipment, Talents and Monsters compendiums.");
}
