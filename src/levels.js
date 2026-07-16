// Level definitions and the escalating news ticker.
// Theme tie-in: the opening headline is literally about a kickoff —
// and then YOU kick off something very different.

const HEADLINES = [
  { pct: 0.00, text: "SPORTS: Stadium crews prepare for tonight's season KICKOFF" },
  { pct: 0.04, text: "LOCAL: Clinics report a spike in unusual bite injuries" },
  { pct: 0.12, text: "BREAKING: Health dept. investigating cluster of violent attacks" },
  { pct: 0.25, text: "ALERT: Police establishing perimeter — residents told to avoid area" },
  { pct: 0.45, text: "EMERGENCY: National Guard deployed. Citywide curfew in effect" },
  { pct: 0.65, text: "CRISIS: Hospitals overrun. Evacuation routes jammed" },
  { pct: 0.85, text: "…broadcast interrupted… if you can hear this, stay indo—" },
  { pct: 0.99, text: "[ NO SIGNAL ]" },
];

const LEVELS = [
  {
    name: 'DISTRICT 1 — MAPLEWOOD SUBURBS',
    intro: 'A quiet neighborhood. Nobody is watching. Yet.',
    worldW: 1900, worldH: 1500,
    civs: 42,
    playerHp: 6,
    parkChance: 0.30,
    initial: [],
    responders: [
      { pct: 0.25, type: 'police', count: 3 },
      { pct: 0.55, type: 'police', count: 4 },
      { pct: 0.80, type: 'military', count: 3 },
    ],
  },
  {
    name: 'DISTRICT 2 — CRESTFALL DOWNTOWN',
    intro: 'Dense streets. Fast prey. Faster response.',
    worldW: 2400, worldH: 1800,
    civs: 75,
    playerHp: 6,
    parkChance: 0.15,
    initial: [{ type: 'police', count: 3 }],
    responders: [
      { pct: 0.12, type: 'police', count: 4 },
      { pct: 0.35, type: 'police', count: 4 },
      { pct: 0.55, type: 'military', count: 4 },
      { pct: 0.75, type: 'military', count: 5 },
    ],
  },
  {
    name: 'DISTRICT 3 — FORT HALCYON QUARANTINE',
    intro: "They know you're coming. Make it count.",
    worldW: 2300, worldH: 1700,
    civs: 55,
    playerHp: 7,
    parkChance: 0.10,
    initial: [{ type: 'military', count: 7 }],
    responders: [
      { pct: 0.15, type: 'military', count: 4 },
      { pct: 0.40, type: 'military', count: 5 },
      { pct: 0.65, type: 'military', count: 6 },
    ],
  },
];

// Responder archetypes
const COP_TYPES = {
  police: {
    tint: 0x5b8dff, speed: 88, hp: 3, sight: 320, fireRange: 240,
    fireDelay: 720, bulletSpeed: 480, dmg: 1, label: 'POLICE RESPONDING',
  },
  military: {
    tint: 0x9aa65b, speed: 104, hp: 5, sight: 380, fireRange: 270,
    fireDelay: 380, bulletSpeed: 560, dmg: 1, label: 'MILITARY DEPLOYED',
  },
};
