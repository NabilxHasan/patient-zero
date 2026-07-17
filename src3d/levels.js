// Level definitions, news ticker, and archetypes — tuned for 3D world units
// (~1 unit ≈ 1 metre; characters ~1.7 tall).

export const HEADLINES = [
  { pct: 0.00, text: "SPORTS: Stadium crews prepare for tonight's season KICKOFF" },
  { pct: 0.04, text: "LOCAL: Clinics report a spike in unusual bite injuries" },
  { pct: 0.12, text: "BREAKING: Health dept. investigating cluster of violent attacks" },
  { pct: 0.25, text: "ALERT: Police establishing perimeter — residents told to avoid area" },
  { pct: 0.40, text: "URGENT: Patrol units dispatched citywide. Do not approach the infected" },
  { pct: 0.52, text: "EMERGENCY: National Guard deployed. Citywide curfew in effect" },
  { pct: 0.68, text: "CRISIS: Armour rolling in. Hospitals overrun. Evacuation routes jammed" },
  { pct: 0.85, text: "…broadcast interrupted… if you can hear this, stay indo—" },
  { pct: 0.99, text: "[ NO SIGNAL ]" },
];

export const LEVELS = [
  {
    name: 'DISTRICT 1 — MAPLEWOOD SUBURBS',
    intro: 'A quiet neighborhood. Nobody is watching. Yet.',
    theme: 'city',
    cols: 4, rows: 4,
    civs: 40,
    playerHp: 6,
    parkChance: 0.34,
    buildingH: [3, 6],          // low suburban houses
    palette: { ground: 0x14171d, fog: 0x090d15, roofs: [0x3a3630, 0x35302c, 0x3c3a34, 0x322c28] },
    props: 14, barrels: 8, healthKits: 4, powers: 7, trees: true,
    initial: [],
    healers: [],
    responders: [
      { pct: 0.25, type: 'police', count: 3 },
      { pct: 0.55, type: 'police', count: 4 },
      { pct: 0.80, type: 'military', count: 3 },
    ],
    // vehicles only once tension has built
    vehicles: [
      { pct: 0.45, type: 'car', count: 1 },
      { pct: 0.75, type: 'car', count: 2 },
    ],
  },
  {
    name: 'DISTRICT 2 — HOLLOWBROOK COUNTY',
    intro: 'Open fields. They have tools, and they know how to use them.',
    theme: 'rural',
    cols: 5, rows: 5,
    civs: 60,
    playerHp: 6,
    parkChance: 0.42,           // fields everywhere
    buildingH: [3, 5],          // barns and farmhouses
    palette: { ground: 0x1d2418, fog: 0x0c1410, roofs: [0x7a3228, 0x6b2a22, 0x8a4a34, 0x5c4432] },
    props: 22, barrels: 10, healthKits: 5, powers: 10, trees: true,
    animals: 16,                // livestock, infectable
    civsFightBack: true,        // farmers swing back with pitchforks
    oldSchool: true,            // vintage responders
    healers: [{ pct: 0.35, count: 1 }],
    // Every district opens quiet — the response is always something you kick off.
    initial: [],
    responders: [
      { pct: 0.06, type: 'police', count: 3 },
      { pct: 0.20, type: 'police', count: 4 },
      { pct: 0.42, type: 'police', count: 4 },
      { pct: 0.60, type: 'military', count: 4 },
      { pct: 0.80, type: 'military', count: 5 },
    ],
    vehicles: [
      { pct: 0.30, type: 'car', count: 2 },
      { pct: 0.55, type: 'car', count: 2 },
      { pct: 0.70, type: 'tank', count: 1 },
      { pct: 0.88, type: 'heli', count: 1 },
    ],
  },
  {
    name: 'DISTRICT 3 — NEO HALCYON',
    intro: "Chrome and neon. They won't fight — they'll blink away.",
    theme: 'neon',
    cols: 5, rows: 5,
    civs: 56,
    playerHp: 7,
    parkChance: 0.08,
    buildingH: [6, 11],         // neon towers
    palette: { ground: 0x0d0f1a, fog: 0x0a0618, roofs: [0x1b1f3a, 0x231a3a, 0x14202e, 0x2a1630] },
    props: 20, barrels: 16, healthKits: 6, powers: 12, trees: false,
    neon: true,                 // billboards, strips, hover traffic
    civsBlink: true,            // hover-shoe / short-range teleport escapes
    healers: [{ pct: 0.22, count: 1 }, { pct: 0.55, count: 2 }],
    // The garrison is here, but it still has to notice you first.
    initial: [],
    responders: [
      { pct: 0.04, type: 'military', count: 4 },
      { pct: 0.18, type: 'military', count: 4 },
      { pct: 0.42, type: 'military', count: 5 },
      { pct: 0.68, type: 'military', count: 6 },
    ],
    vehicles: [
      { pct: 0.12, type: 'tank', count: 1 },
      { pct: 0.28, type: 'heli', count: 1 },
      { pct: 0.50, type: 'tank', count: 1 },
      { pct: 0.70, type: 'tank', count: 2 },
      { pct: 0.85, type: 'heli', count: 2 },
    ],
  },
];

export const COP_TYPES = {
  police: {
    speed: 3.6, hp: 3, sight: 13, fireRange: 10.5,
    fireDelay: 0.72, bulletSpeed: 20, dmg: 1, label: 'POLICE RESPONDING',
  },
  military: {
    speed: 4.3, hp: 5, sight: 16, fireRange: 12,
    fireDelay: 0.38, bulletSpeed: 24, dmg: 1, label: 'MILITARY DEPLOYED',
  },
};

// Field medic: walks the district curing the infected back into civilians,
// which drags the outbreak percentage back down. Must be put down.
export const HEALER = {
  speed: 3.2, hp: 4, seek: 26, healRange: 3.2, healTime: 2.2, fleeRange: 7,
  label: 'FIELD MEDIC DISPATCHED',
};

export const VEHICLES = {
  car:  { hp: 6,  speed: 9,  label: 'PATROL UNITS INBOUND' },
  tank: { hp: 14, speed: 2.2, sight: 24, fireRange: 20, fireDelay: 2.6, shellSpeed: 26, label: 'ARMOUR DEPLOYED' },
  heli: { hp: 8,  speed: 7,  sight: 26, fireRange: 16, fireDelay: 0.28, bulletSpeed: 30, life: 26, label: 'GUNSHIP OVERHEAD' },
};

// World geometry constants (units).
export const BLOCK = 11;
export const STREET = 7;
export const CELL = BLOCK + STREET;
