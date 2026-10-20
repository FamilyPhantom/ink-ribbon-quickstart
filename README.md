# Ink Ribbon (Quick Start) for Foundry VTT

An **unofficial, free, fan-made** game system for [Foundry VTT](https://foundryvtt.com) v14,
built to run the Ink Ribbon Quick Start demo, *Dead on Arrival*.

> **You need the official game.** This system is a table helper, not a replacement for the
> rulebook. It contains only short GM reminders, not the rules text. Please buy and read the
> official Ink Ribbon books.

## Features

- Survivor, monster/NPC and Item Box (storage) actor sheets
- Equipment and talent items with attack, weapon, armour and gear types
- A shared **Horror** tracker (1-5) at the top of the screen, with GM controls for
  "Who's first?", starting an action scene, and ending a scene
- **Safe Room** toggle so players can use the shared Item Box
- Conditions and start/end-of-turn automation (for example Bleeding, Burning, Adrenaline)
- Starter compendiums (Equipment, Talents, Monsters) created automatically the first time
  a GM loads a world

## Install

1. In Foundry (or Forge), open **Game Systems → Install System**.
2. Paste this manifest URL and click **Install**:

   ```
   https://github.com/YOURUSER/ink-ribbon/releases/latest/download/system.json
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
attaches `system.json` and `ink-ribbon.zip`.

## Legal

- The **code** in this repository is released under the MIT License (see `LICENSE`).
- Ink Ribbon and all of its content, names and rules belong to their respective owners and are
  not covered by that license.
- This is an unofficial, non-commercial fan project and is not affiliated with or endorsed by
  the publisher of Ink Ribbon.
- Rights holders: if you want anything changed or removed, please open an issue.

## Issues

Bug reports and suggestions: <https://github.com/YOURUSER/ink-ribbon/issues>
