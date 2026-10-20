import { SKILLS, defenceFromTable, healthState } from "./config.mjs";

const { fields } = foundry.data;

const int = (initial = 0, min = 0, max) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, min, max });
const str = (initial = "") => new fields.StringField({ required: true, blank: true, initial });
const bool = (initial = false) => new fields.BooleanField({ initial });

function attributeFields(initial) {
  return new fields.SchemaField({
    strength: int(initial), agility: int(initial), wits: int(initial), heart: int(initial)
  });
}

function skillFields() {
  const s = {};
  for (const key of Object.keys(SKILLS)) s[key] = new fields.SchemaField({ training: int(0, 0, 10) });
  return new fields.SchemaField(s);
}

/* -------------------------------------------- */
/*  Survivor (player character)                 */
/* -------------------------------------------- */

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      details: new fields.SchemaField({
        player: str(), occupation: str(), height: str(), weight: str(),
        eyes: str(), hair: str(), description: str()
      }),
      attributes: attributeFields(3),
      skills: skillFields(),
      stress: new fields.SchemaField({ value: int(0, 0, 6) }),
      panicEffect: str(),
      reliefs: new fields.SchemaField({
        moment: bool(),                                  // Take a Moment (everyone has it)
        minorText: str(), minor: bool(),
        majorText: str(), major: bool()
      }),
      toughness: new fields.SchemaField({ value: int(6), bonus: int(0, -20) }),
      adrenaline: new fields.SchemaField({ value: int(0) }),
      defence: new fields.SchemaField({ bonus: int(0, -20) }),
      armour: new fields.SchemaField({ bonus: int(0, -20) }),
      ecg: new fields.SchemaField({ value: int(0, 0, 5) }),   // filled boxes on the ECG Health Tracker
      bankedDie: bool(),
      slots: new fields.SchemaField({ max: int(4, 0, 12) }),
      quickSlots: new fields.SchemaField({ max: int(2, 0, 4) }),  // Quick Item Slots (base 2, up to 4)
      notes: str()
    };
  }

  /** Everything here is recalculated every time the actor changes. */
  prepareDerivedData() {
    const a = this.attributes;
    this.toughness.max = a.strength + a.heart + this.toughness.bonus;
    this.adrenaline.max = Math.floor(a.heart / 2);
    this.stress.max = 6;

    this.ecg.max = 5;
    this.ecg.state = healthState(this.ecg.value);
    this.injured = this.ecg.value >= 5;                     // Danger => Injured condition

    // Caution: -1 Defence. Danger keeps Caution's -1 and adds Injured's -1.
    const healthPenalty = this.ecg.value >= 5 ? -2 : this.ecg.value >= 3 ? -1 : 0;
    this.defence.base = defenceFromTable(a.agility + this.skills.reflexes.training);
    this.defence.value = this.defence.base + this.defence.bonus + healthPenalty;

    this.armour.value = this.armour.bonus;                 // + equipped armour, added in InkActor
  }
}

/* -------------------------------------------- */
/*  Monsters and NPCs (typed-in stat blocks)     */
/* -------------------------------------------- */

export class MonsterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      enemyType: str("horde"),                             // horde | boss | nemesis | ally
      tags: str("Infected"),
      attributes: attributeFields(2),
      skills: skillFields(),                               // stat block "Fighting [+1d6]" = 1
      toughness: new fields.SchemaField({ value: int(4), max: int(4) }),
      health: new fields.SchemaField({ value: int(0), max: int(0) }),   // 0 max = no Health (Horde)
      adrenaline: new fields.SchemaField({ value: int(0), max: int(0) }),
      defence: new fields.SchemaField({ base: int(4) }),
      armour: new fields.SchemaField({ value: int(0) }),
      stress: new fields.SchemaField({ value: int(0, 0, 6) }), // used only if an NPC ally needs it
      // Automated stat-block traits (see module/rules.mjs).
      traits: new fields.SchemaField({
        vsRanged: int(0, -6, 6),          // extra Defence vs ranged attacks (Shambler +1)
        vsMelee: int(0, -6, 6),           // extra Defence vs melee attacks
        aimForHead: bool(),               // headshots: +1 TN melee / +2 ranged, double damage, killing headshot = no Back From the Dead
        backFromDead: bool(),             // first time Toughness hits 0: 1d6 <= Horror, not dead, +1d3 Toughness next turn
        bftdUsed: bool(), reviving: bool(),
        actsLast: bool(),                 // always acts last (combat tracker)
        adrenalineRegen: int(0, 0, 6),    // Adrenaline regained at the start of its turn
        selfHeal: int(0, 0, 20),          // Toughness regained at the start of each round
        extraTurn: bool(),                // My Turn: after its turn, 1d6 <= Horror = extra turn
        horrorOnAppear: bool(),           // Horror +1 each time its token appears
        mutatesInto: str(),               // Violent Mutation: name of the monster it becomes
        mutationChecked: bool(),
        grotesque: bool(),                // sighting buttons: first = 1 Stress + Panic; later = TN 4 Willpower or 1 Stress
        roar: bool()                      // Terrifying Roar button: TN 5 Willpower or 1 Stress (+ Frightened if close)
      }),
      // A weak point that can be targeted (Unstable Chemicals, Putrid Growths).
      weak: new fields.SchemaField({
        label: str(), count: int(0, 0, 10), max: int(0, 0, 10), tn: int(6, 2, 6),
        threshold: int(3, 1, 20),         // damage from one hit needed to burst one
        selfDamage: int(0, 0, 20),        // damage the monster takes (ignores Armour)
        selfCondition: str(),             // condition it gains, e.g. incapacitated / prone
        selfRounds: str(),                // e.g. "1d6": rounds the condition lasts (rolled each round to end early)
        splashDamage: int(0, 0, 20),      // damage to Adjacent creatures (ignores Armour)
        splashCondition: str()            // condition for Adjacent creatures, e.g. burning
      }),
      recover: new fields.SchemaField({ condition: str(), rounds: int(0, 0, 20) }),  // timed condition from a weak point
      abilities: str(),
      notes: str()
    };
  }

  prepareDerivedData() {
    this.defence.value = this.defence.base;
    this.hasHealth = this.health.max > 0;
  }
}

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

const itemCommon = () => ({
  size: int(1, 0, 12),
  quick: bool(),                                           // in a Quick Item Slot (doesn't use inventory)
  inv: new fields.SchemaField({                            // position in the inventory grid (see inventory.mjs)
    x: int(-1, -1, 3), y: int(-1, -1, 2), rot: bool()
  }),
  description: str()
});

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...itemCommon(),
      category: str("melee"),                              // melee | ranged | thrown
      damage: int(2),
      range: str("Adjacent"),
      shots: new fields.SchemaField({ value: int(0), max: int(0) }),
      ammo: str(),                                         // name of the gear item Reload takes Shots from ("" = free reload)
      singleUse: bool(),                                   // thrown weapons: used up when thrown
      tags: str()                                          // comma list: Loud, Up Close, Brittle, Inferior, Explosive, Blaze...
    };
  }
  /** Tag check that also matches "Thrown (Medium)" for "Thrown". */
  hasTag(tag) {
    const t = tag.toLowerCase();
    return this.tags.toLowerCase().split(",").map(x => x.trim()).some(x => x === t || x.startsWith(`${t} (`));
  }
}

export class ArmourData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...itemCommon(), rating: int(1), equipped: bool(true) };
  }
}

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...itemCommon(),
      quantity: int(1),
      slotBonus: int(0, 0, 12),                            // +Inventory Slots while carried (Backpack = 3)
      quickBonus: int(0, 0, 4),                            // +Quick Item Slots while carried
      ready: bool(),                                       // held / readied (e.g. a Riot Shield in hand)
      defenceBonus: int(0, -6, 6),                         // +Defence while ready
      reflexesBonus: int(0, 0, 6),                         // +dice on Reflexes Tests while ready (pre-filled)
      use: str("none"),                                    // none | heal | healthpack | adrenaline
      healEcg: int(0)                                      // boxes cleared by a "heal" item
    };
  }
}

export class TalentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: str(),
      ignoreStress: int(0, 0, 6),                          // Stress ignored on Tests with these skills...
      ignoreSkills: str(),                                 // ...comma list of skill keys, e.g. "fighting"
      toughness: int(0, -10, 10),                          // +Toughness
      defence: int(0, -6, 6),                              // +Defence
      advantage: int(0, 0, 6),                             // +dice pre-filled on Tests with...
      advSkill: str(),                                     // ...this skill key, e.g. "reflexes"
      advNote: str()                                       // when it applies, e.g. "to dodge"
    };
  }
}

/** Monster attack line from a stat block, e.g. "Bite: Melee Attack [4d6], 2 damage." */
export class AttackData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: str("melee"),                                  // melee | ranged
      pool: int(4),
      damage: int(1),
      range: str("Adjacent"),
      conditions: str(),                                   // conditions offered on a hit, e.g. "caught, prone"
      lethal: bool(),                                      // if this would make the target Dying, they die
      noTest: bool(),                                      // deals its damage without a Test (e.g. latched bite)
      description: str()
    };
  }
}
