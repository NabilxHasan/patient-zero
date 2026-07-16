# PATIENT ZERO

*Every outbreak has a kickoff.*

An entry for the **IUT 12th ICT Fest 2026 GameJam** — theme: **Kickoff**.

## Theme interpretation

"Kickoff" as *the spark that sets an entire chain of events into motion*. You are
the first infected — patient zero — and every civilian you touch rises and spreads
the plague further. One touch kicks off an unstoppable chain reaction. The news
ticker even opens on the city's *other* kickoff that night: the football season
opener nobody will get to watch.

## How to play

- **WASD / Arrow keys** — move
- **SPACE** — lunge (short dash, 1.6s cooldown)
- **M** — mute · **R** — restart district

Touch civilians to infect them. They turn and hunt for you. As the outbreak grows,
police — then the military — deploy to contain it. They shoot at the horde *and*
at you. Bitten responders rise too.

**Win** by overrunning all three districts. **If you fall, the outbreak dies with you.**

1. District 1 — Maplewood Suburbs: quiet streets, slow response.
2. District 2 — Crestfall Downtown: dense crowds, police on patrol.
3. District 3 — Fort Halcyon Quarantine: the army is already waiting.

## Running the game

It's a static web game — serve the folder and open it:

```
node scripts/serve.js        # then open http://localhost:8321
```

or any static server (`npx http-server`, `python -m http.server`, …).
For itch.io: upload `patient-zero-web.zip` and set it to "playable in browser"
with `index.html` as the entry point.

## Tech & assets

- [Phaser 3.90](https://phaser.io) (MIT license), single bundled `lib/phaser.min.js`
- **All graphics are generated procedurally** at boot (no image assets)
- **All sound is synthesized live** with WebAudio (no audio assets)
- No other dependencies, no copyright concerns

Made for the GameJam, July 2026.
