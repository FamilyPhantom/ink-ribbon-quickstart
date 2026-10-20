// Safe Room Item Box: one stash shared by the whole party.
// Players can put items in (only while the GM has a Safe Room open) but can't see what's inside.
// Only the GM's client touches the box: players send a socket request, the GM's client moves the item.
// Needs "socket": true in system.json.

const SYS = "ink-ribbon";
export const SOCKET = `system.${SYS}`;
const { DialogV2 } = foundry.applications.api;

export const getItemBox = () => game.actors.find(a => a.type === "storage");
export const isSafeRoomOpen = () => game.settings.get(SYS, "safeRoom");

/** True once Foundry has loaded the manifest that defines the "storage" Actor type. */
export function itemBoxInstalled() {
  const ok = game.documentTypes?.Actor?.includes("storage");
  if (!ok && game.user.isGM) ui.notifications.error(
    "Ink Ribbon: Foundry hasn't loaded the updated system.json yet. Fully close Foundry and start it again to enable the Item Box.",
    { permanent: true });
  return ok;
}

export async function ensureItemBox() {
  if (!itemBoxInstalled()) return null;
  return getItemBox() ?? Actor.create({ name: "Safe Room Item Box", type: "storage", img: "icons/svg/chest.svg" });
}

/** Fresh item data with its inventory position cleared. */
function cleanData(item, quantity) {
  const data = item.toObject();
  delete data._id;
  foundry.utils.mergeObject(data, { "system.quick": false, "system.inv": { x: -1, y: -1, rot: false } });
  if (data.type === "armour") data.system.equipped = false;
  if (quantity !== undefined) data.system.quantity = quantity;
  return data;
}

const qtyText = (item, n) => (item.type === "gear" && n !== 1 ? ` x${n}` : "");

/** Ask how many of a stack to move (gear with quantity > 1). Returns null if cancelled. */
async function askQuantity(item, verb) {
  const max = item.system.quantity;
  if (item.type !== "gear" || max <= 1) return item.type === "gear" ? max : undefined;
  const result = await DialogV2.prompt({
    window: { title: `${verb} ${item.name}` },
    content: `<div class="form-group"><label>How many? (max ${max})</label>
      <input type="number" name="qty" value="${max}" min="1" max="${max}" autofocus></div>`,
    ok: { label: verb, callback: (event, button) => Number(button.form.elements.qty.value) },
    rejectClose: false
  });
  return result ? Math.clamp(result, 1, max) : null;
}

/* -------------------------------------------- */
/*  Storing (player or GM)                      */
/* -------------------------------------------- */

/** Put an owned item into the Item Box. */
export async function storeItem(item) {
  if (!item?.parent) return;
  if (!isSafeRoomOpen()) return ui.notifications.warn("You can only use the Item Box in a Safe Room.");
  const quantity = await askQuantity(item, "Store");
  if (quantity === null) return;
  const request = { action: "store", actorUuid: item.parent.uuid, itemId: item.id, quantity, userId: game.user.id };
  if (game.user.isGM) return gmStore(request);
  if (!game.users.activeGM) return ui.notifications.warn("The GM needs to be online to use the Item Box.");
  game.socket.emit(SOCKET, request);
  ui.notifications.info(`You put ${item.name}${qtyText(item, quantity)} in the Item Box.`);
}

/** GM client only: does the actual move. Stacks gear with the same name. */
async function gmStore({ actorUuid, itemId, quantity, userId }) {
  const requester = game.users.get(userId);
  if (!requester?.isGM && !isSafeRoomOpen()) return;          // players can only stash inside a Safe Room
  const actor = await fromUuid(actorUuid);
  const item = actor?.items.get(itemId);
  if (!item) return;
  if (!requester?.isGM && !actor.testUserPermission(requester, "OWNER")) return;
  const box = await ensureItemBox();
  if (!box) return;
  const isGear = item.type === "gear";
  const n = isGear ? Math.clamp(quantity ?? item.system.quantity, 1, item.system.quantity) : undefined;

  const stack = isGear && box.items.find(i => i.type === "gear" && i.name === item.name);
  if (stack) await stack.update({ "system.quantity": stack.system.quantity + n });
  else await box.createEmbeddedDocuments("Item", [cleanData(item, n)]);

  if (isGear && n < item.system.quantity) await item.update({ "system.quantity": item.system.quantity - n });
  else await item.delete();

  ChatMessage.create({
    speaker: { alias: "Item Box" },
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="ir-card"><h3>Item Box</h3><p><b>${actor.name}</b> stored <b>${item.name}${qtyText(item, n ?? 1)}</b>.</p></div>`
  });
}

/* -------------------------------------------- */
/*  Taking out (GM only)                        */
/* -------------------------------------------- */

/** Give an item from the box to a character. Asks how many for stacks. */
export async function giveItem(item, actor) {
  if (!game.user.isGM || !item || !actor) return;
  const quantity = await askQuantity(item, "Give");
  if (quantity === null) return;
  await actor.createEmbeddedDocuments("Item", [cleanData(item, quantity)]);
  if (item.type === "gear" && quantity < item.system.quantity) await item.update({ "system.quantity": item.system.quantity - quantity });
  else await item.delete();
  ChatMessage.create({
    speaker: { alias: "Item Box" },
    whisper: game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id),
    content: `<div class="ir-card"><h3>Item Box</h3><p><b>${actor.name}</b> takes <b>${item.name}${qtyText(item, quantity ?? 1)}</b> out of the Item Box.</p></div>`
  });
}

/** Only the active GM answers socket requests (so two GMs don't both move the item). */
export function registerItemBoxSocket() {
  game.socket.on(SOCKET, data => {
    if (game.user !== game.users.activeGM) return;
    if (data?.action === "store") gmStore(data);
  });
}

/** Open / close the Safe Room (GM). Re-renders open survivor sheets via the setting's onChange. */
export async function toggleSafeRoom() {
  if (!game.user.isGM) return;
  const open = !isSafeRoomOpen();
  if (open && !(await ensureItemBox())) return;
  await game.settings.set(SYS, "safeRoom", open);
  ChatMessage.create({
    speaker: { alias: "Safe Room" },
    content: `<div class="ir-card"><h3>${open ? "You've reached a Safe Room" : "Leaving the Safe Room"}</h3>
      <p>${open ? "The Item Box is available. Catch your breath." : "The Item Box is out of reach."}</p></div>`
  });
}
