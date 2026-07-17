// Core gameplay for the 3D build. Entities live on the XZ plane; each holds a
// three.js group synced every frame.
import * as THREE from 'three';
import { buildCity } from './city.js';
import {
  makeCharacter, animateWalk, box, groundGlow, CIV_PALETTES,
  makeBarrel, makeHealthKit, makePoliceCar, makeTank, makeHelicopter,
  makePowerPickup, makeGasCloud, makeShockRing, makeHealer, makeHealBeam, POWERS,
  makeAnimal, makeFarmTool,
} from './models.js';
import { LEVELS, HEADLINES, COP_TYPES, VEHICLES, HEALER } from './levels.js';

const R = 0.45;
const INFECT_DIST = 1.1;
const BITE_DIST = 1.2;
const TURN_TIME = 1.4;
const BLAST_R = 6.5;

export class Game {
  constructor(scene, levelIndex) {
    this.scene = scene;
    this.levelIndex = levelIndex;
    this.cfg = LEVELS[levelIndex];
    this.msgs = [];
    this.over = false;
    this.won = false;
  }

  start() {
    const cfg = this.cfg;
    this.city = buildCity(this.scene, cfg);
    this.civs = []; this.zombies = []; this.cops = []; this.bullets = [];
    this.barrels = []; this.kits = []; this.vehicles = []; this.shells = [];
    this.debris = []; this.healers = []; this.beams = [];
    this.powerPickups = []; this.gasClouds = []; this.rings = [];
    this.powers = { gas: 0, stun: 0, horde: 0, rage: 0, hulk: 0 };
    this.rageUntil = 0;
    this.healed = 0;
    this.parts = new ParticlePool(this.scene);
    this.elapsed = 0; this.time = 0;
    this.infectedCount = 0; this.kills = 0;
    this.initialCivs = cfg.civs;
    this.aliveCivs = cfg.civs;
    this.outbreak = 0;
    this.headlineIdx = 0;
    this.schedule = cfg.responders.map(r => ({ ...r, done: false }));
    this.vSchedule = (cfg.vehicles || []).map(v => ({ ...v, done: false }));
    this.hSchedule = (cfg.healers || []).map(h => ({ ...h, done: false }));

    const ps = this.city.streetPointNear(this.city.W / 2, this.city.H / 2, 2, 6);
    this.player = this.makeEntity('player', ps.x, ps.z);
    this.player.hp = cfg.playerHp;
    this.player.maxHp = cfg.playerHp;
    this.lungeReadyAt = 0; this.lungeUntil = 0; this.invulnUntil = 0;
    this.nextRegenAt = 9;
    this.player.y = 0; this.player.vy = 0; this.player.airborne = false;
    this.hulkUntil = 0;
    this.dir = new THREE.Vector2(0, 1);

    // soft ground glow (replaces the hard-edged disc that read as an artifact)
    this.aura = groundGlow(0x35d072, 7, 0.55);
    this.aura.position.y = 0.05;
    this.scene.add(this.aura);

    for (let i = 0; i < cfg.civs; i++) { const p = this.city.randomStreetPoint(); this.spawnCiv(p.x, p.z); }
    for (let i = 0; i < (cfg.barrels || 0); i++) { const p = this.city.randomStreetPoint(); this.spawnBarrel(p.x, p.z); }
    for (let i = 0; i < (cfg.healthKits || 0); i++) { const p = this.city.randomStreetPoint(); this.spawnKit(p.x, p.z); }
    for (let i = 0; i < (cfg.animals || 0); i++) { const p = this.city.randomStreetPoint(); this.spawnAnimal(p.x, p.z); }
    const ptypes = Object.keys(POWERS);
    for (let i = 0; i < (cfg.powers || 0); i++) {
      const p = this.city.randomStreetPoint();
      this.spawnPowerPickup(ptypes[i % ptypes.length], p.x, p.z);
    }

    for (const grp of cfg.initial) {
      for (let i = 0; i < grp.count; i++) {
        const p = this.city.streetPointNear(this.player.x, this.player.z, 14, 26);
        if (grp.type === 'tankUnit') this.spawnVehicle(p.x, p.z, 'tank');
        else this.spawnCop(p.x, p.z, grp.type);
      }
    }

    this.msgs.push({ type: 'level', name: cfg.name, intro: cfg.intro });
    this.msgs.push({ type: 'headline', text: HEADLINES[0].text });
    this.headlineIdx = 1;
  }

  // ---- factories ----
  makeEntity(kind, x, z, palette, variant) {
    const mesh = makeCharacter(kind, palette, variant);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    return { mesh, x, z, vx: 0, vz: 0, kind, speed: 0, nextThink: Math.random() * 0.3, wander: null, stunUntil: 0 };
  }

  spawnCiv(x, z) {
    const e = this.makeEntity('civ', x, z, CIV_PALETTES[(Math.random() * CIV_PALETTES.length) | 0]);
    e.state = 'calm'; e.turning = false; e.stamina = 100; e.calmAt = 0;
    // Hollowbrook farmers don't all run — some pick up a tool and swing back.
    if (this.cfg.civsFightBack && Math.random() < 0.45) {
      e.armed = true; e.nextSwing = 0;
      const tool = makeFarmTool(Math.random() < 0.5 ? 'pitchfork' : 'scythe');
      tool.position.set(0.34, 1.05, 0);
      tool.rotation.x = -0.5;
      e.mesh.add(tool);
    }
    if (this.cfg.civsBlink) { e.blink = true; e.nextBlink = 0; }   // Neo Halcyon hover-shoes
    this.civs.push(e); return e;
  }
  spawnZombie(x, z) {
    const e = this.makeEntity('zombie', x, z);
    e.hp = 3; e.speed = 3.0 + Math.random() * 0.9;
    this.zombies.push(e); this.parts.burst(x, 1, z, 0x53ff7a, 14); return e;
  }
  spawnCop(x, z, type) {
    const e = this.makeEntity(type, x, z, null, this.cfg.oldSchool ? 'oldSchool' : null);
    const t = COP_TYPES[type];
    e.copType = type; e.hp = t.hp; e.nextShot = 0; e.lastBite = -999;
    this.cops.push(e); return e;
  }
  // Livestock: counts as a civilian for the outbreak, but slower and dumber.
  spawnAnimal(x, z) {
    const mesh = makeAnimal(false);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const e = { mesh, x, z, vx: 0, vz: 0, kind: 'civ', animal: true, state: 'calm', turning: false,
      stamina: 100, calmAt: 0, nextThink: Math.random() * 0.3, wander: null, stunUntil: 0 };
    this.civs.push(e);
    this.aliveCivs++; this.initialCivs++;      // livestock counts toward the district
    return e;
  }

  spawnBarrel(x, z) {
    const mesh = makeBarrel(); mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.barrels.push({ mesh, x, z, dead: false });
  }
  spawnKit(x, z) {
    const mesh = makeHealthKit(); mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.kits.push({ mesh, x, z });
  }
  spawnPowerPickup(type, x, z) {
    const mesh = makePowerPickup(type); mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.powerPickups.push({ mesh, x, z, type });
  }
  spawnHealer(x, z) {
    const mesh = makeHealer(); mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const h = { mesh, x, z, vx: 0, vz: 0, kind: 'healer', hp: HEALER.hp, nextThink: 0, target: null, channel: 0, wander: null, stunUntil: 0, lastBite: -999 };
    this.healers.push(h);
    return h;
  }

  // ---- powers ----
  usePower(type) {
    if (this.over || !this.powers[type]) return false;
    this.powers[type]--;
    const p = this.player;

    if (type === 'gas') {
      const radius = 7;
      const mesh = makeGasCloud(radius);
      mesh.position.set(p.x, 0, p.z);
      this.scene.add(mesh);
      this.gasClouds.push({ mesh, x: p.x, z: p.z, r: radius, life: 12, t: 0 });
      this.parts.burst(p.x, 1, p.z, 0x7CFF4A, 26);
      AudioFX.infect();
      this.msgs.push({ type: 'stinger', text: 'BIO-CANISTER RELEASED' });

    } else if (type === 'stun') {
      const radius = 14, dur = 5;
      const ring = makeShockRing();
      ring.position.set(p.x, 0.2, p.z);
      this.scene.add(ring);
      this.rings.push({ mesh: ring, r: 0, max: radius, life: 0.6 });
      let n = 0;
      const zap = (e) => { if (Math.hypot(e.x - p.x, e.z - p.z) < radius) { e.stunUntil = this.time + dur; e.vx = e.vz = 0; n++; } };
      this.cops.forEach(zap); this.civs.forEach(zap); this.healers.forEach(zap);
      this.vehicles.forEach(v => { if (v.vtype !== 'heli') zap(v); });
      AudioFX.stinger();
      this.msgs.push({ type: 'shake', amt: 0.5 });
      this.msgs.push({ type: 'stinger', text: `SHOCK CHARGE — ${n} STUNNED` });

    } else if (type === 'horde') {
      const radius = 26, dur = 14;
      let n = 0;
      for (const z of this.zombies) {
        if (Math.hypot(z.x - p.x, z.z - p.z) < radius) { z.rallyUntil = this.time + dur; n++; this.parts.burst(z.x, 1.6, z.z, 0xC46AFF, 4); }
      }
      AudioFX.turn();
      this.msgs.push({ type: 'stinger', text: `HIVE CALL — ${n} ANSWER` });

    } else if (type === 'rage') {
      this.rageUntil = this.time + 9;
      this.lungeReadyAt = 0;
      this.parts.burst(p.x, 1, p.z, 0xFF6A4A, 20);
      AudioFX.lunge();
      this.msgs.push({ type: 'stinger', text: 'ADRENAL SURGE' });

    } else if (type === 'hulk') {
      this.hulkUntil = this.time + 18;
      this.parts.burst(p.x, 1, p.z, 0x6ad24a, 40);
      AudioFX.stinger();
      this.msgs.push({ type: 'shake', amt: 0.9 });
      this.msgs.push({ type: 'stinger', text: 'BIOMASS BLOOM' });
    }
    return true;
  }

  // Left-click swipe: infects whoever is in front of you, or mauls a responder.
  strike() {
    if (this.over || this.time < (this.nextStrike || 0)) return;
    const hulk = this.time < this.hulkUntil;
    this.nextStrike = this.time + (hulk ? 0.25 : 0.4);
    const p = this.player;
    const reach = hulk ? 3.2 : 1.9;
    const fx = this.dir.x, fz = this.dir.y;
    const inArc = (e) => {
      const dx = e.x - p.x, dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) return false;
      return (dx / d) * fx + (dz / d) * fz > 0.25;   // roughly in front
    };
    this.parts.burst(p.x + fx * 1.2, 1.1, p.z + fz * 1.2, hulk ? 0x6ad24a : 0x53ff7a, hulk ? 12 : 6);
    AudioFX.lunge();
    let hit = false;
    for (const c of this.civs) if (!c.turning && inArc(c)) { this.infect(c, true); hit = true; if (!hulk) break; }
    for (const cop of this.cops.slice()) if (inArc(cop)) { this.bite(cop, hulk ? 99 : 2); hit = true; if (!hulk) break; }
    for (const h of this.healers.slice()) if (inArc(h)) { this.hitHealer(h, hulk ? 99 : 2); hit = true; }
    if (hulk) for (const v of this.vehicles.slice()) {
      if (v.vtype !== 'heli' && Math.hypot(v.x - p.x, v.z - p.z) < reach + 1.4) { this.damageVehicle(v, 5); hit = true; }
    }
    for (const b of this.barrels) if (!b.dead && Math.hypot(b.x - p.x, b.z - p.z) < reach + 0.4) this.popBarrel(b);
    if (hulk) this.smashAround(p.x + fx * 1.5, p.z + fz * 1.5, reach);
    if (hit) this.msgs.push({ type: 'shake', amt: hulk ? 0.35 : 0.15 });
  }

  // Landing shockwave while transformed.
  groundPound() {
    const p = this.player, radius = 7;
    this.parts.burst(p.x, 0.3, p.z, 0x6ad24a, 26);
    this.msgs.push({ type: 'blast', x: p.x, z: p.z });
    for (const cop of this.cops.slice()) {
      if (Math.hypot(cop.x - p.x, cop.z - p.z) < radius) this.bite(cop, 99);
    }
    for (const pr of this.city.props) {
      const d = Math.hypot(pr.x - p.x, pr.z - p.z);
      if (d < radius) { const a = Math.atan2(pr.z - p.z, pr.x - p.x); const f = (1 - d / radius) * 18; pr.vx += Math.cos(a) * f; pr.vz += Math.sin(a) * f; pr.spin = 8; }
    }
    this.smashAround(p.x, p.z, radius);
    for (const v of this.vehicles.slice()) {
      if (v.vtype !== 'heli' && Math.hypot(v.x - p.x, v.z - p.z) < radius) this.damageVehicle(v, 6);
    }
  }

  damageVehicle(v, dmg) {
    v.hp -= dmg;
    this.parts.burst(v.x, 1, v.z, 0xffa53a, 8);
    if (v.hp <= 0) this.destroyVehicle(v);
  }

  spawnVehicle(x, z, vtype) {
    const spec = VEHICLES[vtype];
    let mesh;
    if (vtype === 'car') mesh = makePoliceCar();
    else if (vtype === 'tank') mesh = makeTank();
    else mesh = makeHelicopter();
    const y = vtype === 'heli' ? 9 : 0;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const v = { mesh, x, z, y, vx: 0, vz: 0, vtype, hp: spec.hp, nextShot: 0, life: spec.life || 0, deployed: false, leaving: false, lastBite: -999, stunUntil: 0 };
    this.vehicles.push(v);
    return v;
  }

  nearest(list, x, z, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const e of list) {
      if (filter && !filter(e)) continue;
      const dx = e.x - x, dz = e.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  remove(e, list) { const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); this.scene.remove(e.mesh); }

  // ---- infection ----
  infect(civ, byPlayer) {
    if (this.over || civ.turning) return;
    civ.turning = true; civ.vx = civ.vz = 0; civ.turnAt = this.time + TURN_TIME;
    this.aliveCivs--; this.infectedCount++;
    AudioFX.infect();
    this.parts.burst(civ.x, 1, civ.z, 0x53ff7a, 10);
    if (byPlayer) this.msgs.push({ type: 'shake', amt: 0.25 });
    for (const o of this.civs) if (!o.turning && this.dist(o, civ) < 5) { o.state = 'panic'; o.calmAt = this.time + 2.6; }
  }
  finishTurn(civ) {
    const { x, z } = civ;
    const wasAnimal = civ.animal;
    this.remove(civ, this.civs);
    AudioFX.turn();
    const z2 = this.spawnZombie(x, z);
    if (wasAnimal) {
      // infected livestock: swap in the beast mesh, and it's faster than you
      this.scene.remove(z2.mesh);
      z2.mesh = makeAnimal(true);
      z2.mesh.position.set(x, 0, z);
      this.scene.add(z2.mesh);
      z2.animal = true;
      z2.speed = 4.4 + Math.random() * 0.8;
      z2.hp = 4;
    }
    return z2;
  }

  bite(cop, dmg) {
    if (this.over || this.time < cop.lastBite + 0.48) return;
    cop.lastBite = this.time;
    cop.hp -= dmg;
    this.parts.burst(cop.x, 1, cop.z, 0xb32626, 6);
    if (cop.hp <= 0) {
      const { x, z } = cop;
      this.remove(cop, this.cops);
      AudioFX.copDown(); this.infectedCount++; this.kills++;
      this.spawnZombie(x, z);
      this.msgs.push({ type: 'shake', amt: 0.3 });
    }
  }

  // ---- explosions ----
  // Kills responders and bystanders; patient zero and the infected are immune.
  explode(x, z) {
    AudioFX.stinger();
    this.parts.burst(x, 1.2, z, 0xffa53a, 40);
    this.parts.burst(x, 0.6, z, 0xff5a20, 26);
    this.msgs.push({ type: 'shake', amt: 1.1 });
    this.msgs.push({ type: 'blast', x, z });

    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      if (Math.hypot(c.x - x, c.z - z) < BLAST_R) {
        this.parts.burst(c.x, 1, c.z, 0xb32626, 8);
        this.remove(c, this.cops); this.kills++;
      }
    }
    for (let i = this.civs.length - 1; i >= 0; i--) {
      const c = this.civs[i];
      if (Math.hypot(c.x - x, c.z - z) < BLAST_R) {
        this.parts.burst(c.x, 1, c.z, 0xb32626, 8);
        this.remove(c, this.civs);
        if (!c.turning) this.aliveCivs--;   // dead, not infected — still off the board
        this.kills++;
      }
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.vtype !== 'heli' && Math.hypot(v.x - x, v.z - z) < BLAST_R) {
        v.hp -= 8;
        if (v.hp <= 0) this.destroyVehicle(v);
      }
    }
    // knock props and shatter trees
    for (const p of this.city.props) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < BLAST_R) { const a = Math.atan2(p.z - z, p.x - x); const f = (1 - d / BLAST_R) * 16; p.vx += Math.cos(a) * f; p.vz += Math.sin(a) * f; p.spin = 6; }
    }
    this.smashAround(x, z, BLAST_R);
    // chain reaction
    for (const b of this.barrels) {
      if (!b.dead && Math.hypot(b.x - x, b.z - z) < BLAST_R * 0.8) b.chainAt = this.time + 0.12 + Math.random() * 0.12;
    }
  }

  popBarrel(b) {
    if (b.dead) return;
    b.dead = true;
    this.scene.remove(b.mesh);
    this.explode(b.x, b.z);
  }

  // Smash a streetlight: the pole topples into debris and its light pool dies.
  breakLamp(l) {
    if (l.broken) return;
    l.broken = true;
    this.parts.burst(l.x, 3.2, l.z, 0xffca7a, 16);
    this.parts.burst(l.x, 1.0, l.z, 0x9aa3ae, 8);
    AudioFX.zdie();
    if (l.pool) { this.scene.remove(l.pool); l.pool = null; }
    for (const chunk of l.chunks) {
      chunk.getWorldPosition(_tmp);
      this.scene.attach(chunk);
      this.debris.push({
        mesh: chunk, x: _tmp.x, y: _tmp.y, z: _tmp.z,
        vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 6,
        rx: Math.random() * 7, rz: Math.random() * 7, life: 2.4,
      });
    }
    this.scene.remove(l.mesh);
  }

  // Anything smashable inside a radius — used by dashes, pounds and blasts.
  smashAround(x, z, radius) {
    for (const t of this.city.trees) if (!t.broken && Math.hypot(t.x - x, t.z - z) < radius) this.breakTree(t);
    for (const l of this.city.lamps) if (!l.broken && Math.hypot(l.x - x, l.z - z) < radius) this.breakLamp(l);
  }

  breakTree(t) {
    if (t.broken) return;
    t.broken = true;
    this.parts.burst(t.x, 1.6, t.z, 0x3a5e3a, 16);
    for (const chunk of t.mesh.userData.chunks) {
      chunk.getWorldPosition(_tmp);
      const d = { mesh: chunk, x: _tmp.x, y: _tmp.y, z: _tmp.z,
        vx: (Math.random() - 0.5) * 7, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 7,
        rx: Math.random() * 6, rz: Math.random() * 6, life: 2.2 };
      this.scene.attach(chunk);
      this.debris.push(d);
    }
    this.scene.remove(t.mesh);
  }

  destroyVehicle(v) {
    this.remove(v, this.vehicles);
    this.kills++;
    this.explode(v.x, v.z);
  }

  // ---- ranged ----
  fireBullet(from, target, spec, y = 1.15) {
    const a = Math.atan2(target.x - from.x, target.z - from.z) + (Math.random() - 0.5) * 0.12;
    const sx = Math.sin(a), sz = Math.cos(a);
    const mesh = box(0.16, 0.16, 0.5, 0xffd77a, { emissive: 0xffd77a, emissiveIntensity: 3, cast: false });
    mesh.position.set(from.x + sx * 0.9, y, from.z + sz * 0.9);
    mesh.rotation.y = a;
    this.scene.add(mesh);
    this.bullets.push({ mesh, x: mesh.position.x, z: mesh.position.z, y, vx: sx * spec.bulletSpeed, vz: sz * spec.bulletSpeed, dmg: spec.dmg || 1, life: 1.1 });
    this.parts.burst(from.x + sx, y, from.z + sz, 0xffe08a, 4);
    AudioFX.shot();
  }

  fireShell(tank, target) {
    const spec = VEHICLES.tank;
    const a = Math.atan2(target.x - tank.x, target.z - tank.z) + (Math.random() - 0.5) * 0.06;
    const sx = Math.sin(a), sz = Math.cos(a);
    const mesh = box(0.3, 0.3, 0.8, 0xffc06a, { emissive: 0xff9a3a, emissiveIntensity: 3, cast: false });
    mesh.position.set(tank.x + sx * 3, 1.4, tank.z + sz * 3);
    mesh.rotation.y = a;
    this.scene.add(mesh);
    this.shells.push({ mesh, x: mesh.position.x, z: mesh.position.z, vx: sx * spec.shellSpeed, vz: sz * spec.shellSpeed, life: 2 });
    this.parts.burst(tank.x + sx * 3, 1.4, tank.z + sz * 3, 0xffd08a, 10);
    AudioFX.shot(); AudioFX.hit();
    this.msgs.push({ type: 'shake', amt: 0.35 });
  }

  killBullet(b) { this.remove(b, this.bullets); }

  // ---- update ----
  update(dt, input) {
    if (this.over) { this.parts.update(dt); this.updateDebris(dt); return; }
    this.time += dt; this.elapsed += dt;
    this.city.tick(dt, this.time);

    this.updatePlayer(dt, input);

    for (const c of this.civs) {
      if ((c.nextThink -= dt) <= 0) {
        this.thinkCiv(c); c.nextThink = 0.13 + Math.random() * 0.09;
        if (c.state === 'panic') c.stamina = Math.max(0, c.stamina - 2.2); else c.stamina = Math.min(100, c.stamina + 1.4);
      }
      if (c.turning && this.time >= c.turnAt) this.finishTurn(c);
    }
    for (const z of this.zombies) if ((z.nextThink -= dt) <= 0) { this.thinkZombie(z); z.nextThink = 0.14 + Math.random() * 0.1; }
    for (const cop of this.cops) if ((cop.nextThink -= dt) <= 0) { this.thinkCop(cop); cop.nextThink = 0.1 + Math.random() * 0.07; }

    this.moveEntity(this.player, dt);
    for (const c of this.civs) if (!c.turning) this.moveEntity(c, dt);
    for (const z of this.zombies) this.moveEntity(z, dt);
    for (const cop of this.cops) this.moveEntity(cop, dt);

    this.updateHealers(dt);
    this.updateGas(dt);
    this.updateVehicles(dt);
    this.updateProps(dt);
    this.updateDebris(dt);

    // infection contacts
    for (const c of this.civs) {
      if (c.turning) continue;
      if (this.dist(this.player, c) < INFECT_DIST) { this.infect(c, true); continue; }
      for (const z of this.zombies) if (this.dist(z, c) < INFECT_DIST) { this.infect(c, false); break; }
    }
    // bites — a dash is a takedown, a walk-up mauling is not
    const dashing = this.time < this.lungeUntil;
    // Transformed, a dash wrecks vehicles outright: a car dies in one, a tank
    // needs two (7 dmg vs 14 hp).
    if (dashing && this.time < this.hulkUntil) {
      for (const v of this.vehicles.slice()) {
        if (v.vtype === 'heli') continue;
        if (this.dist(this.player, v) < 3.0 && this.time > (v.lastRam || 0) + 0.4) {
          v.lastRam = this.time;
          this.msgs.push({ type: 'shake', amt: 0.6 });
          this.damageVehicle(v, v.vtype === 'car' ? 99 : 7);
        }
      }
    }
    for (const cop of this.cops) {
      if (this.dist(this.player, cop) < BITE_DIST + (dashing ? 0.5 : 0)) this.bite(cop, dashing ? 99 : 2);
      else for (const z of this.zombies) if (this.dist(z, cop) < BITE_DIST) { this.bite(cop, 1); break; }
    }
    // Only patient zero can drop a medic � his suppression field holds the
    // horde off, so hunting him is the player's job.
    for (const h of this.healers.slice()) {
      if (this.dist(this.player, h) < BITE_DIST + (dashing ? 0.5 : 0)) this.hitHealer(h, dashing ? 99 : 2);
    }
    // zombies maul ground vehicles
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.vtype === 'heli') continue;
      if (this.time < v.lastBite + 0.5) continue;
      let mauled = this.dist(this.player, v) < 2.2;
      if (!mauled) for (const z of this.zombies) if (this.dist(z, v) < 2.2) { mauled = true; break; }
      if (mauled) { v.lastBite = this.time; v.hp -= 1; this.parts.burst(v.x, 1, v.z, 0xb32626, 4); if (v.hp <= 0) this.destroyVehicle(v); }
    }

    this.updatePickups();
    this.updateBarrels();
    this.updateBullets(dt);
    this.updateShells(dt);
    this.updateWaves();
    this.parts.update(dt);
    AudioFX.heartbeat(this.outbreak);

    // Win needs civilians cleared and every *ground* responder down. Helicopters
    // are excluded on purpose — they leave on a timer and must never softlock it.
    const tanksLeft = this.vehicles.filter(v => v.vtype === 'tank').length;
    if (this.aliveCivs <= 0 && this.cops.length === 0 && tanksLeft === 0 && this.healers.length === 0) this.endLevel(true);
  }

  updatePlayer(dt, input) {
    const p = this.player;
    const lunging = this.time < this.lungeUntil;
    if (!lunging) {
      const raging = this.time < this.rageUntil;
      const hulk = this.time < this.hulkUntil;
      const spd = (raging ? 9 : 6) * (hulk ? 1.25 : 1);
      const dx = input.mx || 0, dz = input.mz || 0;
      if (dx || dz) {
        const l = Math.hypot(dx, dz); this.dir.set(dx / l, dz / l);
        p.vx = this.dir.x * spd; p.vz = this.dir.y * spd;
      } else { p.vx = 0; p.vz = 0; }
      if (input.lunge && this.time > this.lungeReadyAt) {
        this.lungeReadyAt = this.time + (raging ? 0.35 : 1.6); this.lungeUntil = this.time + 0.2;
        const boost = (raging ? 22 : 17) * (hulk ? 1.2 : 1);
        p.vx = this.dir.x * boost; p.vz = this.dir.y * boost;
        AudioFX.lunge(); this.parts.burst(p.x, 1, p.z, 0x53ff7a, 6);
      }
    }
    // dashing shatters trees and detonates barrels
    if (lunging) {
      this.smashAround(p.x, p.z, this.time < this.hulkUntil ? 2.6 : 1.5);
      for (const b of this.barrels) if (!b.dead && Math.hypot(b.x - p.x, b.z - p.z) < 1.5) this.popBarrel(b);
    }
    // --- vertical: jump, gravity, landing (rooftops included) ---
    const hulkNow = this.time < this.hulkUntil;
    // Normal hops just clear a car (1.4); only the transformed form reaches roofs.
    const ground = this.city.groundHeightAt(p.x, p.z);
    const onGround = p.y <= ground + 0.02 && !p.airborne;
    if (input.jump && onGround) {
      p.vy = hulkNow ? 18 : 10;
      p.airborne = true;
      AudioFX.lunge();
      this.parts.burst(p.x, p.y + 0.2, p.z, 0x9fffc4, 8);
    }
    if (p.airborne || p.y > ground) {
      p.vy -= 26 * dt;
      p.y += p.vy * dt;
      if (p.y <= ground) {
        const fell = p.vy < -4;
        p.y = ground; p.vy = 0;
        if (p.airborne) {
          p.airborne = false;
          this.parts.burst(p.x, p.y + 0.2, p.z, 0xbfd4ff, hulkNow ? 18 : 6);
          if (hulkNow && fell) { this.msgs.push({ type: 'shake', amt: 0.5 }); this.groundPound(); }
        }
      }
    } else if (p.y > ground) {
      p.airborne = true;                 // walked off a ledge
    } else {
      p.y = ground;                      // stepped onto a low surface
    }
    // Hulk slams gunships out of the sky mid-jump.
    if (hulkNow && p.y > 3) {
      for (const v of this.vehicles.slice()) {
        if (v.vtype !== 'heli') continue;
        if (Math.hypot(v.x - p.x, v.z - p.z) < 4 && Math.abs(v.y - p.y) < 4.5) {
          this.parts.burst(v.x, v.y, v.z, 0xffa53a, 30);
          this.destroyVehicle(v);
          p.vy = Math.max(p.vy, 6);          // bounce off the wreck
        }
      }
    }
    if (this.time > this.nextRegenAt) { this.nextRegenAt = this.time + 9; if (p.hp < p.maxHp) p.hp++; }
    this.lungeCooldown = THREE.MathUtils.clamp((this.lungeReadyAt - this.time) / (this.time < this.rageUntil ? 0.35 : 1.6), 0, 1);

    // grow/shrink into the transformed silhouette
    const wantScale = hulkNow ? 2.2 : 1.15;
    this.playerScale = this.playerScale || 1.15;
    this.playerScale += (wantScale - this.playerScale) * (1 - Math.exp(-7 * dt));
    p.mesh.scale.setScalar(this.playerScale);

    this.aura.position.set(p.x, (p.y || 0) + 0.05, p.z);
    const s = (1 + Math.sin(this.time * 4) * 0.08) * (hulkNow ? 1.7 : 1);
    this.aura.scale.setScalar(s);
  }

  moveEntity(e, dt) {
    const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    const r = this.city.collide(nx, nz, R, e.y || 0);
    e.x = r.x; e.z = r.z;
    const moving = Math.hypot(e.vx, e.vz) > 0.4;
    e.mesh.position.x = e.x; e.mesh.position.z = e.z;
    if (moving) e.mesh.rotation.y = Math.atan2(e.vx, e.vz);
    animateWalk(e.mesh, Math.hypot(e.vx, e.vz), dt, moving && !e.airborne);
    // animateWalk writes the bob; compose it with world height (never +=, which
    // compounds against the bob's own decay)
    e.mesh.position.y = (e.mesh.userData.bob || 0) + (e.y || 0);
    // shove street props out of the way
    for (const p of this.city.props) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < 0.9 && d > 0.001) {
        const a = Math.atan2(p.z - e.z, p.x - e.x);
        const f = Math.hypot(e.vx, e.vz) * 0.5 + 1.5;
        p.vx += Math.cos(a) * f * dt * 8; p.vz += Math.sin(a) * f * dt * 8; p.spin = 3;
      }
    }
  }

  updateProps(dt) {
    for (const p of this.city.props) {
      if (Math.abs(p.vx) < 0.01 && Math.abs(p.vz) < 0.01) continue;
      const r = this.city.collide(p.x + p.vx * dt, p.z + p.vz * dt, 0.4);
      p.x = r.x; p.z = r.z;
      p.vx *= 0.88; p.vz *= 0.88;
      p.mesh.position.set(p.x, 0, p.z);
      if (p.spin > 0) { p.mesh.rotation.y += p.spin * dt; p.spin *= 0.9; }
    }
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.debris.splice(i, 1); continue; }
      d.vy -= 14 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < 0.15) { d.y = 0.15; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; }
      d.mesh.position.set(d.x, d.y, d.z);
      d.mesh.rotation.x += d.rx * dt; d.mesh.rotation.z += d.rz * dt;
    }
  }

  updatePickups() {
    for (let i = this.kits.length - 1; i >= 0; i--) {
      const k = this.kits[i];
      k.mesh.rotation.y += 0.03;
      k.mesh.position.y = 0.15 + Math.sin(this.time * 3 + k.x) * 0.12;
      if (this.dist(this.player, k) < 1.3 && this.player.hp < this.player.maxHp) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
        this.parts.burst(k.x, 1, k.z, 0x40ff70, 14);
        AudioFX.win();
        this.remove(k, this.kits);
        this.msgs.push({ type: 'headline', text: '[ BIOMASS ABSORBED — VITALS RESTORED ]' });
      }
    }
    // powers stack without limit — hoard them and fire on 1-4
    for (let i = this.powerPickups.length - 1; i >= 0; i--) {
      const k = this.powerPickups[i];
      k.mesh.rotation.y += 0.028;
      k.mesh.position.y = 0.2 + Math.sin(this.time * 2.6 + k.x) * 0.14;
      if (this.dist(this.player, k) < 1.4) {
        this.powers[k.type]++;
        this.parts.burst(k.x, 1, k.z, POWERS[k.type].color, 16);
        AudioFX.click();
        this.remove(k, this.powerPickups);
        this.msgs.push({ type: 'headline', text: `[ ${POWERS[k.type].name} ACQUIRED — PRESS ${POWERS[k.type].key} ]` });
      }
    }
  }

  updateBarrels() {
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i];
      if (b.dead) { this.barrels.splice(i, 1); continue; }
      if (b.chainAt && this.time >= b.chainAt) this.popBarrel(b);
    }
  }

  thinkCiv(c) {
    if (c.turning) return;
    if (this.time < c.stunUntil) { c.vx = c.vz = 0; return; }
    let threat = this.nearest(this.zombies, c.x, c.z, 6);
    if (!threat && this.dist(this.player, c) < 6) threat = this.player;
    const spd = (2.4 + 1.9 * (c.stamina / 100)) * (c.animal ? 0.75 : 1);

    // --- Hollowbrook: armed farmers hold ground and swing ---
    if (c.armed && threat && !c.animal) {
      const d = this.dist(threat, c);
      const a = Math.atan2(threat.x - c.x, threat.z - c.z);
      c.mesh.rotation.y = a;
      if (d < 2.0) {
        c.vx = c.vz = 0;
        if (this.time > c.nextSwing) {
          c.nextSwing = this.time + 1.1;
          this.parts.burst(c.x + Math.sin(a) * 1.2, 1.1, c.z + Math.cos(a) * 1.2, 0xb9bcc0, 5);
          AudioFX.hit();
          if (threat === this.player && this.time > this.invulnUntil && this.time >= this.hulkUntil) {
            this.hurtPlayer(1);                // the transformed form shrugs it off
          } else if (threat !== this.player) {
            threat.hp -= 1;
            if (threat.hp <= 0) { this.remove(threat, this.zombies); AudioFX.zdie(); }
          }
        }
      } else if (d < 9) {                       // charge
        c.vx = Math.sin(a) * spd * 0.9; c.vz = Math.cos(a) * spd * 0.9;
      }
      c.state = 'panic'; c.calmAt = this.time + 2.6;
      return;
    }

    // --- Neo Halcyon: hover-shoe blink out of danger ---
    if (c.blink && threat && this.time > c.nextBlink && this.dist(threat, c) < 4.5) {
      c.nextBlink = this.time + 3.5;
      const a = Math.atan2(c.x - threat.x, c.z - threat.z);
      const to = this.city.streetPointNear(c.x + Math.sin(a) * 11, c.z + Math.cos(a) * 11, 0, 4);
      this.parts.burst(c.x, 1, c.z, 0x00e5ff, 12);
      c.x = to.x; c.z = to.z;
      c.mesh.position.set(c.x, 0, c.z);
      this.parts.burst(c.x, 1, c.z, 0x7c4dff, 12);
      AudioFX.click();
      c.state = 'panic'; c.calmAt = this.time + 2.6;
      return;
    }

    if (threat) {
      c.state = 'panic'; c.calmAt = this.time + 2.6;
      const a = Math.atan2(c.x - threat.x, c.z - threat.z);
      c.vx = Math.sin(a) * spd; c.vz = Math.cos(a) * spd;
    } else if (c.state === 'panic' && this.time < c.calmAt) {
      // keep running
    } else {
      c.state = 'calm';
      if (!c.wander || Math.hypot(c.x - c.wander.x, c.z - c.wander.z) < 1) c.wander = this.city.streetPointNear(c.x, c.z, 3, 12);
      const a = Math.atan2(c.wander.x - c.x, c.wander.z - c.z);
      c.vx = Math.sin(a) * 1.6; c.vz = Math.cos(a) * 1.6;
    }
  }

  thinkZombie(z) {
    // Rallied by the Hive Call: stick with patient zero, but still snap at
    // anything that wanders close.
    const rallied = this.time < (z.rallyUntil || 0);
    let tgt = this.nearest(this.civs, z.x, z.z, rallied ? 6 : 11, e => !e.turning);
    if (!tgt) tgt = this.nearest(this.cops, z.x, z.z, rallied ? 7 : 13);
    if (!tgt) tgt = this.nearest(this.vehicles.filter(v => v.vtype !== 'heli'), z.x, z.z, 12);
    if (!tgt && rallied) {
      const d = this.dist(this.player, z);
      if (d > 3) { const a = Math.atan2(this.player.x - z.x, this.player.z - z.z);
        z.vx = Math.sin(a) * z.speed * 1.15; z.vz = Math.cos(a) * z.speed * 1.15; }
      else { z.vx = z.vz = 0; }
      return;
    }
    if (tgt) {
      const a = Math.atan2(tgt.x - z.x, tgt.z - z.z);
      z.vx = Math.sin(a) * z.speed; z.vz = Math.cos(a) * z.speed;
    } else {
      if (!z.wander || Math.hypot(z.x - z.wander.x, z.z - z.wander.z) < 1) z.wander = this.city.streetPointNear(this.player.x, this.player.z, 3, 16);
      const a = Math.atan2(z.wander.x - z.x, z.wander.z - z.z);
      z.vx = Math.sin(a) * z.speed * 0.6; z.vz = Math.cos(a) * z.speed * 0.6;
    }
  }

  thinkCop(cop) {
    if (this.time < cop.stunUntil) { cop.vx = cop.vz = 0; return; }
    const t = COP_TYPES[cop.copType];
    let tgt = this.nearest(this.zombies, cop.x, cop.z, t.sight);
    const pd = this.dist(this.player, cop);
    if (!this.over && pd < t.sight && (!tgt || pd < this.dist(tgt, cop))) tgt = this.player;
    if (tgt) {
      const d = this.dist(tgt, cop);
      const a = Math.atan2(tgt.x - cop.x, tgt.z - cop.z);
      if (d < 3.5) { cop.vx = -Math.sin(a) * t.speed; cop.vz = -Math.cos(a) * t.speed; }
      else if (d > t.fireRange * 0.85) { cop.vx = Math.sin(a) * t.speed; cop.vz = Math.cos(a) * t.speed; }
      else { cop.vx = 0; cop.vz = 0; }
      cop.mesh.rotation.y = a;
      if (d < t.fireRange && this.time > cop.nextShot) { cop.nextShot = this.time + t.fireDelay * (0.85 + Math.random() * 0.3); this.fireBullet(cop, tgt, t); }
    } else {
      if (!cop.wander || Math.hypot(cop.x - cop.wander.x, cop.z - cop.wander.z) < 1) cop.wander = this.city.streetPointNear(cop.x, cop.z, 4, 14);
      const a = Math.atan2(cop.wander.x - cop.x, cop.wander.z - cop.z);
      cop.vx = Math.sin(a) * t.speed * 0.55; cop.vz = Math.cos(a) * t.speed * 0.55;
    }
  }

  hitHealer(h, dmg) {
    if (this.over || this.time < (h.lastBite || 0) + 0.45) return;
    h.lastBite = this.time;
    h.hp -= dmg;
    this.parts.burst(h.x, 1.2, h.z, 0xb32626, 6);
    if (h.hp <= 0) {
      const { x, z } = h;
      if (h.beam) { this.scene.remove(h.beam); h.beam = null; }
      this.remove(h, this.healers);
      AudioFX.copDown(); this.kills++; this.infectedCount++;
      this.spawnZombie(x, z);              // even the medic joins the horde
      this.msgs.push({ type: 'stinger', text: 'MEDIC DOWN' });
      this.msgs.push({ type: 'shake', amt: 0.4 });
    }
  }

  // The medic hunts the infected and converts them back into civilians, which
  // pushes the outbreak percentage *down*. Ignoring him stalls the district.
  updateHealers(dt) {
    for (const h of this.healers) {
      if (this.time < h.stunUntil) { h.vx = h.vz = 0; this.moveEntity(h, dt); continue; }
      const pd = this.dist(this.player, h);

      // keep away from patient zero
      if (pd < HEALER.fleeRange) {
        const a = Math.atan2(h.x - this.player.x, h.z - this.player.z);
        h.vx = Math.sin(a) * HEALER.speed * 1.15; h.vz = Math.cos(a) * HEALER.speed * 1.15;
        h.target = null; h.channel = 0;
      } else {
        if (!h.target || !this.zombies.includes(h.target)) {
          h.target = this.nearest(this.zombies, h.x, h.z, HEALER.seek);
          h.channel = 0;
        }
        if (h.target) {
          const d = this.dist(h.target, h);
          const a = Math.atan2(h.target.x - h.x, h.target.z - h.z);
          h.mesh.rotation.y = a;
          // Close well inside heal range and keep pace: patients wander, and
          // sitting exactly on the boundary reset the channel every few frames
          // so a cure never completed.
          if (d > HEALER.healRange * 0.7) { h.vx = Math.sin(a) * HEALER.speed; h.vz = Math.cos(a) * HEALER.speed; }
          else { h.vx = h.vz = 0; }
          if (d <= HEALER.healRange) {
            h.channel += dt;
            if (h.channel >= HEALER.healTime) { h.channel = 0; this.cure(h, h.target); h.target = null; }
          } else {
            h.channel = Math.max(0, h.channel - dt * 2);   // decay, don't hard-reset
          }
        } else {
          if (!h.wander || Math.hypot(h.x - h.wander.x, h.z - h.wander.z) < 1) h.wander = this.city.streetPointNear(h.x, h.z, 5, 18);
          const a = Math.atan2(h.wander.x - h.x, h.wander.z - h.z);
          h.vx = Math.sin(a) * HEALER.speed * 0.6; h.vz = Math.cos(a) * HEALER.speed * 0.6;
        }
      }
      this.moveEntity(h, dt);

      // beam to whoever is being cured
      if (h.target && h.channel > 0) {
        if (!h.beam) { h.beam = makeHealBeam(); this.scene.add(h.beam); }
        const t = h.target;
        const mid = { x: (h.x + t.x) / 2, z: (h.z + t.z) / 2 };
        const len = Math.hypot(t.x - h.x, t.z - h.z);
        h.beam.position.set(mid.x, 1.2, mid.z);
        h.beam.scale.set(1, Math.max(0.1, len), 1);
        h.beam.rotation.z = Math.PI / 2;
        h.beam.rotation.y = -Math.atan2(t.z - h.z, t.x - h.x);
        h.beam.visible = true;
        if (Math.random() < 0.3) this.parts.burst(t.x, 1.2, t.z, 0x6ac8ff, 2);
      } else if (h.beam) { h.beam.visible = false; }
    }
  }

  cure(healer, zombie) {
    if (!this.zombies.includes(zombie)) return;
    const { x, z } = zombie;
    this.remove(zombie, this.zombies);
    this.parts.burst(x, 1.2, z, 0x6ac8ff, 18);
    const c = this.spawnCiv(x, z);
    c.state = 'panic'; c.calmAt = this.time + 3;
    this.aliveCivs++;                       // outbreak percentage drops
    this.infectedCount = Math.max(0, this.infectedCount - 1);
    this.healed++;
    AudioFX.click();
    this.msgs.push({ type: 'headline', text: '[ FIELD MEDIC IS CURING THE INFECTED — STOP HIM ]' });
  }

  updateGas(dt) {
    for (let i = this.gasClouds.length - 1; i >= 0; i--) {
      const c = this.gasClouds[i];
      c.life -= dt; c.t += dt;
      if (c.life <= 0) { this.scene.remove(c.mesh); this.gasClouds.splice(i, 1); continue; }
      const pulse = 1 + Math.sin(c.t * 2.2) * 0.06;
      c.mesh.userData.shell.scale.set(pulse, 0.45 * pulse, pulse);
      c.mesh.userData.core.rotation.y += dt * 0.5;
      const fade = Math.min(1, c.life / 3);
      c.mesh.userData.shell.material.opacity = 0.16 * fade;
      c.mesh.userData.core.material.opacity = 0.12 * fade;
      if (Math.random() < 0.25) this.parts.burst(c.x + (Math.random() - 0.5) * c.r, 0.6, c.z + (Math.random() - 0.5) * c.r, 0x7CFF4A, 1);

      // anything that breathes it turns
      for (const civ of this.civs) {
        if (civ.turning) continue;
        if (Math.hypot(civ.x - c.x, civ.z - c.z) < c.r) {
          civ.gas = (civ.gas || 0) + dt;
          if (civ.gas > 0.9) this.infect(civ, false);
        }
      }
      // responders caught in it go down too
      for (const cop of this.cops.slice()) {
        if (Math.hypot(cop.x - c.x, cop.z - c.z) < c.r) {
          cop.gas = (cop.gas || 0) + dt;
          if (cop.gas > 2.2) { cop.gas = 0; this.bite(cop, 1); }
        }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.mesh); this.rings.splice(i, 1); continue; }
      r.r += dt * (r.max / 0.6);
      r.mesh.scale.setScalar(Math.max(0.01, r.r));
      r.mesh.material.opacity = Math.max(0, r.life / 0.6) * 0.9;
    }
  }

  updateVehicles(dt) {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const spec = VEHICLES[v.vtype];
      const p = this.player;
      const d = this.dist(p, v);

      // shock charge locks ground vehicles up
      if (v.vtype !== 'heli' && this.time < v.stunUntil) { v.vx = v.vz = 0; this.moveVehicle(v, dt); continue; }

      if (v.vtype === 'car') {
        // race to the player, drop two officers, then peel away and despawn
        if (v.beaconT === undefined) v.beaconT = 0;
        v.beaconT += dt;
        const bs = v.mesh.userData.beacons;
        if (bs) { const f = Math.sin(v.beaconT * 12) > 0; bs[0].visible = f; bs[1].visible = !f; }
        if (!v.deployed) {
          const a = Math.atan2(p.x - v.x, p.z - v.z);
          if (d > 9) { v.vx = Math.sin(a) * spec.speed; v.vz = Math.cos(a) * spec.speed; }
          else { this.deployCar(v); }
          // The car steers straight at the player, so it can wedge on a building.
          // If it stops making progress, drop the officers where it stands —
          // the wave must always arrive.
          if (v.lastD === undefined) { v.lastD = d; v.stuckT = 0; }
          if (v.lastD - d < 0.3) v.stuckT += dt; else v.stuckT = 0;
          v.lastD = d;
          if (!v.deployed && v.stuckT > 2.5) this.deployCar(v);
        } else if (this.time > v.leaveAt) {
          v.leaving = true;
          const a = Math.atan2(v.x - p.x, v.z - p.z);
          v.vx = Math.sin(a) * spec.speed; v.vz = Math.cos(a) * spec.speed;
          if (d > 55) { this.remove(v, this.vehicles); continue; }
        }
        this.moveVehicle(v, dt);

      } else if (v.vtype === 'tank') {
        let tgt = this.nearest(this.zombies, v.x, v.z, spec.sight);
        if (!this.over && d < spec.sight && (!tgt || d < this.dist(tgt, v))) tgt = p;
        if (tgt) {
          const a = Math.atan2(tgt.x - v.x, tgt.z - v.z);
          const td = this.dist(tgt, v);
          if (td > spec.fireRange * 0.8) { v.vx = Math.sin(a) * spec.speed; v.vz = Math.cos(a) * spec.speed; }
          else { v.vx = v.vz = 0; }
          v.mesh.userData.turret.rotation.y = a - v.mesh.rotation.y;
          if (td < spec.fireRange && this.time > v.nextShot) { v.nextShot = this.time + spec.fireDelay; this.fireShell(v, tgt); }
        } else { v.vx = v.vz = 0; }
        this.moveVehicle(v, dt);

      } else { // heli
        v.mesh.userData.rotor.rotation.y += dt * 34;
        v.mesh.userData.tailRotor.rotation.x += dt * 40;
        v.life -= dt;
        if (v.life <= 0) {
          v.y += 4 * dt;                     // climb out and leave
          v.mesh.position.y = v.y;
          if (v.y > 30) { this.remove(v, this.vehicles); continue; }
        } else {
          const a = Math.atan2(p.x - v.x, p.z - v.z);
          const want = d > 9 ? 1 : -0.4;
          v.vx = Math.sin(a) * spec.speed * want; v.vz = Math.cos(a) * spec.speed * want;
          v.x += v.vx * dt; v.z += v.vz * dt;
          v.y += (9 - v.y) * dt;
          v.mesh.position.set(v.x, v.y, v.z);
          v.mesh.rotation.y = a;
          v.mesh.rotation.z = Math.sin(this.time * 1.4) * 0.06;
          if (!this.over && d < spec.fireRange && this.time > v.nextShot) {
            v.nextShot = this.time + spec.fireDelay;
            this.fireBullet(v, p, { bulletSpeed: spec.bulletSpeed, dmg: 1 }, 8.4);
          }
        }
      }
    }
  }

  deployCar(v) {
    if (v.deployed) return;
    v.vx = v.vz = 0; v.deployed = true;
    for (let k = 0; k < 2; k++) {
      const p = this.city.streetPointNear(v.x, v.z, 1, 3);
      this.spawnCop(p.x, p.z, 'police');
    }
    AudioFX.siren();
    v.leaveAt = this.time + 2.5;
  }

  moveVehicle(v, dt) {
    const r = this.city.collide(v.x + v.vx * dt, v.z + v.vz * dt, 1.4);
    v.x = r.x; v.z = r.z;
    v.mesh.position.set(v.x, 0, v.z);
    if (Math.hypot(v.vx, v.vz) > 0.3) v.mesh.rotation.y = Math.atan2(v.vx, v.vz);
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      b.mesh.position.set(b.x, b.y, b.z);
      if (b.life <= 0 || (b.y < 3 && this.city.blockedSegment(b.x, b.z))) { this.killBullet(b); continue; }
      // stray rounds cook off barrels
      let popped = false;
      for (const br of this.barrels) if (!br.dead && Math.hypot(b.x - br.x, b.z - br.z) < 0.8) { this.popBarrel(br); popped = true; break; }
      if (popped) { this.killBullet(b); continue; }
      let hit = false;
      for (const z of this.zombies) {
        if (Math.hypot(b.x - z.x, b.z - z.z) < 0.7) {
          z.hp -= b.dmg; this.parts.burst(b.x, 1.1, b.z, 0xb32626, 5);
          if (z.hp <= 0) { this.remove(z, this.zombies); AudioFX.zdie(); }
          hit = true; break;
        }
      }
      if (hit) { this.killBullet(b); continue; }
      if (this.dist(this.player, b) < 0.7 && this.time > this.invulnUntil) {
        this.killBullet(b); this.hurtPlayer(1);
      }
    }
  }

  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      s.mesh.position.set(s.x, 1.4, s.z);
      let boom = s.life <= 0 || this.city.blockedSegment(s.x, s.z);
      if (!boom) for (const z of this.zombies) if (Math.hypot(s.x - z.x, s.z - z.z) < 1) { boom = true; break; }
      if (!boom && Math.hypot(s.x - this.player.x, s.z - this.player.z) < 1) boom = true;
      if (boom) {
        this.remove(s, this.shells);
        this.parts.burst(s.x, 1, s.z, 0xffa53a, 22);
        this.msgs.push({ type: 'shake', amt: 0.7 });
        this.msgs.push({ type: 'blast', x: s.x, z: s.z });
        AudioFX.stinger();
        for (let k = this.zombies.length - 1; k >= 0; k--) {
          const z = this.zombies[k];
          if (Math.hypot(s.x - z.x, s.z - z.z) < 4) { this.remove(z, this.zombies); AudioFX.zdie(); }
        }
        if (Math.hypot(s.x - this.player.x, s.z - this.player.z) < 4 && this.time > this.invulnUntil) this.hurtPlayer(2);
        for (const b of this.barrels) if (!b.dead && Math.hypot(b.x - s.x, b.z - s.z) < 4) b.chainAt = this.time + 0.1;
      }
    }
  }

  hurtPlayer(dmg) {
    this.invulnUntil = this.time + 0.65;
    this.player.hp -= dmg;
    AudioFX.hit();
    this.msgs.push({ type: 'flash' });
    this.msgs.push({ type: 'shake', amt: 0.5 });
    if (this.player.hp <= 0) this.endLevel(false);
  }

  updateWaves() {
    this.outbreak = 1 - this.aliveCivs / this.initialCivs;
    while (this.headlineIdx < HEADLINES.length && this.outbreak >= HEADLINES[this.headlineIdx].pct) {
      this.msgs.push({ type: 'headline', text: HEADLINES[this.headlineIdx].text }); this.headlineIdx++;
    }
    for (const s of this.schedule) {
      if (!s.done && this.outbreak >= s.pct) {
        s.done = true;
        for (let i = 0; i < s.count; i++) { const p = this.city.streetPointNear(this.player.x, this.player.z, 16, 28); this.spawnCop(p.x, p.z, s.type); }
        this.msgs.push({ type: 'stinger', text: COP_TYPES[s.type].label });
        AudioFX.siren();
      }
    }
    for (const s of this.vSchedule) {
      if (!s.done && this.outbreak >= s.pct) {
        s.done = true;
        for (let i = 0; i < s.count; i++) {
          const p = this.city.streetPointNear(this.player.x, this.player.z, 26, 40);
          this.spawnVehicle(p.x, p.z, s.type);
        }
        this.msgs.push({ type: 'stinger', text: VEHICLES[s.type].label });
        AudioFX.siren();
      }
    }
    for (const s of this.hSchedule) {
      if (!s.done && this.outbreak >= s.pct) {
        s.done = true;
        for (let i = 0; i < s.count; i++) {
          const p = this.city.streetPointNear(this.player.x, this.player.z, 20, 34);
          this.spawnHealer(p.x, p.z);
        }
        this.msgs.push({ type: 'stinger', text: HEALER.label });
        AudioFX.siren();
      }
    }
  }

  endLevel(win) {
    if (this.over) return;
    this.over = true; this.won = win;
    this.msgs.push({ type: 'stinger', text: win ? 'DISTRICT FALLEN' : 'PATIENT ZERO CONTAINED' });
    if (win) AudioFX.win(); else AudioFX.lose();
    this.msgs.push({ type: 'end', win, level: this.levelIndex, seconds: Math.round(this.elapsed), infected: this.infectedCount, kills: this.kills });
  }
}

const _tmp = new THREE.Vector3();

class ParticlePool {
  constructor(scene) {
    this.scene = scene;
    this.free = []; this.active = [];
    this.geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  }
  burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      let p = this.free.pop();
      if (!p) { p = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 2, color: 0x000000 })); this.scene.add(p); }
      p.visible = true;
      p.material.emissive.setHex(color);
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, up = 1 + Math.random() * 3, sp = 1 + Math.random() * 4;
      p.userData.v = new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp);
      p.userData.life = 0.4 + Math.random() * 0.3;
      p.userData.max = p.userData.life;
      this.active.push(p);
    }
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) { p.visible = false; this.active.splice(i, 1); this.free.push(p); continue; }
      const v = p.userData.v; v.y -= 9 * dt;
      p.position.addScaledVector(v, dt);
      p.scale.setScalar(Math.max(0.05, p.userData.life / p.userData.max));
    }
  }
}
