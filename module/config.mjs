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
