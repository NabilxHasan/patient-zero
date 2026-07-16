// Level definitions, news ticker, and responder archetypes — tuned for 3D world
// units (~1 unit ≈ 1 metre; characters ~1.7 tall).

export const HEADLINES = [
  { pct: 0.00, text: "SPORTS: Stadium crews prepare for tonight's season KICKOFF" },
  { pct: 0.04, text: "LOCAL: Clinics report a spike in unusual bite injuries" },
  { pct: 0.12, text: "BREAKING: Health dept. investigating cluster of violent attacks" },
  { pct: 0.25, text: "ALERT: Police establishing perimeter — residents told to avoid area" },
  { pct: 0.45, text: "EMERGENCY: National Guard deployed. Citywide curfew in effect" },
  { pct: 0.65, text: "CRISIS: Hospitals overrun. Evacuation routes jammed" },
  { pct: 0.85, text: "…broadcast interrupted… if you can hear this, stay indo—" },
  { pct: 0.99, text: "[ NO SIGNAL ]" },
];

export const LEVELS = [
  {
    name: 'DISTRICT 1 — MAPLEWOOD SUBURBS',
    intro: 'A quiet neighborhood. Nobody is watching. Yet.',
    cols: 4, rows: 4,
    civs: 40,
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
    cols: 5, rows: 5,
    civs: 68,
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
    cols: 5, rows: 5,
    civs: 52,
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

// World geometry constants (units).
export const BLOCK = 11;   // building block footprint
export const STREET = 7;   // street width between blocks
export const CELL = BLOCK + STREET;
