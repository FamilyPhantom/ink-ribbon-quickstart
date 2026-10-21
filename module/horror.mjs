/**
 * Horror tracker: a small panel everyone can see (top of the screen).
 * GM controls: change Horror, roll who acts first, start/end an action scene.
 */

import { isSafeRoomOpen, toggleSafeRoom, makeItSafe } from "./safeRoom.mjs";
import { findSupplies } from "./supplies.mjs";
import { horrorCheck } from "./scenario.mjs";

const SYS = "ink-ribbon";

export class HorrorTracker {
  static instance = null;

  render() {
    let el = document.getElementById("ir-horror");
    if (!el) {
      el = document.createElement("div");
      el.id = "ir-horror";
      document.body.appendChild(el);
      el.addEventListener("click", ev => this.#onClick(ev));
    }
    const horror = game.settings.get(SYS, "horror");
    const pips = [1, 2, 3, 4, 5].map(n => `<span class="hpip ${n <= horror ? "on" : ""}"></span>`).join("");
    const gm = game.user.isGM;
    const safe = isSafeRoomOpen();
    el.classList.toggle("safe", safe);
    el.innerHTML = `
      ${gm ? `<a data-ir="down" title="Lower Horror">&minus;</a>` : ""}
      <span class="hlabel">HORROR</span>${pips}<span class="hnum">${horror}</span>
      ${gm ? `<a data-ir="up" title="Raise Horror">+</a>
        <span class="hsep"></span>
        <a data-ir="first" title="Roll 1d6 vs Horror: who acts first">Who's first?</a>
        <a data-ir="start" title="All survivors gain Adrenaline to max">Action!</a>
        <a data-ir="end" title="Danger passed: unspent Adrenaline is lost">End scene</a>
        <a data-ir="check" title="Horror Check: roll 1d6, it happens on a result of Horror or lower (whispered to you)">Horror check</a>
        <a data-ir="search" title="Finding Supplies: roll 3d6 on the Horror column (whispered to you)">Search</a>
        <span class="hsep"></span>
        <a data-ir="safe" class="${safe ? "on" : ""}" title="Open or close a Safe Room (rest, health packs and crafting without a Test). Making an area safe takes an hour: do a Horror check, and if it doesn't happen, open the Safe Room.">Safe Room</a>`
      : safe ? `<span class="hsep"></span><span class="hsafe">Safe Room</span>` : ""}`;
    // Add-on modules can add their own controls here.
    Hooks.callAll("inkRibbon.renderHorrorBar", el);
  }

  async #onClick(ev) {
    const action = ev.target.closest("[data-ir]")?.dataset.ir;
    if (!action || !game.user.isGM) return;
    const horror = game.settings.get(SYS, "horror");
    const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);

    switch (action) {
      case "safe": return toggleSafeRoom();
      case "search": return findSupplies();
      case "check": return horrorCheck();
      case "makeSafe": return makeItSafe();
      case "up": return game.settings.set(SYS, "horror", Math.min(5, horror + 1));
      case "down": return game.settings.set(SYS, "horror", Math.max(1, horror - 1));
      case "first": {
        const r = await new Roll("1d6").evaluate();
        const players = r.total > horror;
        return r.toMessage({
          flavor: `<div class="ir-card"><h3>Who acts first?</h3><p>1d6 vs Horror ${horror}:
            <b>${players ? "The survivors act first." : "The GM and monsters act first."}</b></p></div>`
        });
      }
      case "start":
        for (const a of pcs) await a.update({ "system.adrenaline.value": a.system.adrenaline.max });
        return ChatMessage.create({ content: `<div class="ir-card"><h3>Action scene!</h3><p>Survivors gain Adrenaline up to their maximum.</p></div>` });
      case "end":
        for (const a of pcs) await a.update({ "system.adrenaline.value": 0 });
        return ChatMessage.create({ content: `<div class="ir-card"><h3>The danger has passed</h3><p>Unspent Adrenaline is lost.</p></div>` });
    }
  }
}
