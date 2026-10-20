// ECG Health Tracker artwork: one SVG heartbeat trace drawn behind the 5 health boxes.
// All positions use SVG units: 0-1000 wide, 0-100 tall. Beats are placed in the gaps
// between boxes so the trace never runs underneath a box.
import { healthState } from "./config.mjs";

const BASE = 55; // baseline height of the trace (and the boxes' vertical centre), in %

export const ECG_ZONES = [
  { key: "unharmed", label: "Unharmed", from: 0,   to: 150,  effect: "No effect" },
  { key: "fine",     label: "Fine",     from: 150, to: 420,  effect: "+1 Stress, +1 Adrenaline" },
  { key: "caution",  label: "Caution",  from: 420, to: 690,  effect: "+1 Stress, +1 Adr., -1 Defence" },
  { key: "danger",   label: "Danger",   from: 690, to: 880,  effect: "+1 Stress, Panic Test, Injured" },
  { key: "dying",    label: "Dying",    from: 880, to: 1000, effect: "Death Die" }
];

/** Horizontal centre of boxes 1-5. */
const BOX_X = [215, 355, 485, 625, 815];

/** One beat (P wave, QRS spike, T wave) centred on x. `a` scales the height. */
function beat(x, a) {
  const B = BASE;
  return [
    `L ${x - 32} ${B}`,
    `Q ${x - 26} ${B - 10 * a} ${x - 20} ${B}`,             // P
    `L ${x - 8} ${B}`, `L ${x - 5} ${B + 6 * a}`,           // Q
    `L ${x} ${B - 38 * a}`,                                 // R
    `L ${x + 5} ${B + 22 * a}`, `L ${x + 9} ${B}`,          // S
    `L ${x + 20} ${B}`,
    `Q ${x + 31} ${B - 16 * a} ${x + 42} ${B}`              // T
  ].join(" ");
}

/** Erratic squiggle after the Danger box. */
const FIBRILLATION = [[845, 55], [849, 46], [853, 62], [857, 49], [861, 64], [865, 51], [869, 59], [873, 55]]
  .map(([x, y]) => `L ${x} ${y}`).join(" ");

export const ECG_PATH = [
  `M 0 ${BASE}`,
  beat(75, 0.8),    // Unharmed: calm
  beat(285, 0.95),  // Fine
  beat(555, 1.1),   // Caution
  beat(740, 1.3),   // Danger: biggest spike
  FIBRILLATION,
  `L 1000 ${BASE}`  // Dying: flatline
].join(" ");

/** Trace colour along its length (offset = fraction of the width). */
const ECG_STOPS = [
  [0, "#4f9a33"], [0.14, "#4f9a33"],
  [0.16, "#d4b11c"], [0.41, "#d4b11c"],
  [0.43, "#d0711f"], [0.68, "#d0711f"],
  [0.70, "#c0251b"], [0.86, "#7a0f0b"],
  [0.89, "#1c1a17"], [1, "#1c1a17"]
].map(([o, c]) => ({ o, c }));

/** Tiny beat for the header badge (viewBox 0 0 100 30). Flat when Dying or Dead. */
const MINI_BEAT = "M 0 18 L 28 18 Q 32 13 36 18 L 41 18 L 43 21 L 47 3 L 51 28 L 54 18 L 62 18 Q 68 11 74 18 L 100 18";
const MINI_FLAT = "M 0 18 L 100 18";

/** Everything the template needs to draw the tracker. */
export function ecgContext(actor) {
  const s = actor.system;
  const dead = actor.statuses?.has("dead");
  const dying = !dead && actor.statuses?.has("dying");
  const state = dead ? "Dead" : dying ? "Dying" : s.ecg.state;
  const current = dead || dying ? "dying" : s.ecg.state.toLowerCase();
  return {
    state,
    gradId: `ir-ecg-${actor.id}`,
    path: ECG_PATH,
    miniPath: dead || dying ? MINI_FLAT : MINI_BEAT,
    stops: ECG_STOPS,
    zones: ECG_ZONES.map(z => ({ ...z, width: z.to - z.from, active: z.key === current })),
    boxes: BOX_X.map((x, i) => {
      const n = i + 1;
      const zone = healthState(n);
      return { n, left: x / 10, top: BASE, zone: zone.toLowerCase(), filled: n <= s.ecg.value, tip: `${zone} (box ${n})` };
    })
  };
}
