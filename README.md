# Ink Ribbon (Quick Start) for Foundry VTT

An **unofficial, free, fan-made** game system for [Foundry VTT](https://foundryvtt.com) v14,
built to run the Ink Ribbon Quick Start demo, *Dead on Arrival*.

> **You need the official game.** This system is a table helper, not a replacement for the
> rulebook. It contains only short GM reminders, not the rules text. Please buy and read the
> official Ink Ribbon books.

## Features

- Survivor and monster/NPC sheets with automated Tests, attacks, damage and the ECG Health Tracker
- Resident Evil style inventory grid with Quick Item Slots, stacks and worn armour
- Equipment and talent items: weapons (including loaded rounds and fuel), armour and survival gear
- Gun attachments: Silencer, Makeshift Silencer, Scope, Infrared Scope, Stock and Expanded Mag
- **Crafting** from the Inventory tab: the crafting table's recipes, supplies and tools (with their
  Advantages), the Wits Test, and the reduced results of a failed Test
- A shared **Horror** tracker (1-5) at the top of the screen, with GM controls for
  "Who's first?", starting and ending an action scene, and **Safe Rooms**
- **Finding Supplies:** the GM's Search button rolls the Finding Supplies tables for the current Horror,
  with Give buttons that put the finds straight into a survivor's inventory
- Holsters: up to two, each a Quick Item Slot for one weapon of the right Size
- **Safe Rooms:** the GM opens one (or "Make it safe" with a secret roll). Rest, health packs and
  crafting follow the Safe Room rules (no Test if you're Trained)
- Conditions and start/end-of-turn automation (for example Bleeding, Burning, Adrenaline)
- Starter compendiums (Equipment, Talents, Monsters) created automatically the first time
  a GM loads a world
- Optional add-on module: *Ink Ribbon: Item Box*, a shared Resident Evil style Item Box in Safe Rooms

## Install

1. In Foundry (or Forge), open **Game Systems → Install System**.
2. Paste this manifest URL and click **Install**:

   ```
   https://github.com/conrad251125/ink-ribbon/releases/latest/download/system.json
   ```

3. Create a world and choose **Ink Ribbon (Quick Start)** as its system.
4. Launch the world as Gamemaster. The **Ink Ribbon** compendium folder appears on first load.
   Fully restart the game once after the first install.

Requires Foundry VTT **v14**.

### If the compendiums don't appear

Open the browser console (F12) as GM and run:

```js
game.inkRibbon.buildCompendiums()
```

This deletes and rebuilds the three Ink Ribbon compendiums from the starter data.
To create world copies of the starter monsters and gear instead, run
`game.inkRibbon.importStarter()`.

## Art and images

No official or third-party artwork is included. Default icons are Foundry's built-in icons.
Add your own art in your world (Assets Library on Forge, or your local Data folder), and set it
on world Actors and Items rather than on the compendium entries, since rebuilding the
compendiums resets them.

## Updating

Releases are built automatically. Publishing a GitHub release (for example tag `v0.4.1`)
runs the workflow in `.github/workflows/release.yml`, which fills in the manifest URLs and
attaches `system.json` and `ink-ribbon-quickstart.zip`.

## Legal

- The **code** in this repository is released under the MIT License (see `LICENSE`).
- Ink Ribbon and all of its content, names and rules belong to their respective owners and are
  not covered by that license.
- This is an unofficial, non-commercial fan project and is not affiliated with or endorsed by
  the publisher of Ink Ribbon.
- Rights holders: if you want anything changed or removed, please open an issue.

## Issues

Bug reports and suggestions: <https://github.com/conrad251125/ink-ribbon/issues>
