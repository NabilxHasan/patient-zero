// Core gameplay for the 3D build. Entities live on the XZ plane; each holds a
// three.js group synced every frame.
import * as THREE from 'three';
import { buildCity } from './city.js';
import {
  makeCharacter, animateWalk, box, groundGlow, CIV_PALETTES,
  makeBarrel, makeHealthKit, makePoliceCar, makeTank, makeHelicopter,
} from './models.js';
import { LEVELS, HEADLINES, COP_TYPES, VEHICLES } from './levels.js';

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
    this.debris = [];
    this.parts = new ParticlePool(this.scene);
    this.elapsed = 0; this.time = 0;
    this.infectedCount = 0; this.kills = 0;
    this.initialCivs = cfg.civs;
    this.aliveCivs = cfg.civs;
    this.outbreak = 0;
    this.headlineIdx = 0;
    this.schedule = cfg.responders.map(r => ({ ...r, done: false }));
    this.vSchedule = (cfg.vehicles || []).map(v => ({ ...v, done: false }));

    const ps = this.city.streetPointNear(this.city.W / 2, this.city.H / 2, 2, 6);
    this.player = this.makeEntity('player', ps.x, ps.z);
    this.player.hp = cfg.playerHp;
    this.player.maxHp = cfg.playerHp;
    this.lungeReadyAt = 0; this.lungeUntil = 0; this.invulnUntil = 0;
    this.nextRegenAt = 9;
    this.dir = new THREE.Vector2(0, 1);

    // soft ground glow (replaces the hard-edged disc that read as an artifact)
    this.aura = groundGlow(0x35d072, 7, 0.55);
    this.aura.position.y = 0.05;
    this.scene.add(this.aura);

    for (let i = 0; i < cfg.civs; i++) { const p = this.city.randomStreetPoint(); this.spawnCiv(p.x, p.z); }
    for (let i = 0; i < (cfg.barrels || 0); i++) { const p = this.city.randomStreetPoint(); this.spawnBarrel(p.x, p.z); }
    for (let i = 0; i < (cfg.healthKits || 0); i++) { const p = this.city.randomStreetPoint(); this.spawnKit(p.x, p.z); }

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
  makeEntity(kind, x, z, palette) {
    const mesh = makeCharacter(kind, palette);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    return { mesh, x, z, vx: 0, vz: 0, kind, speed: 0, nextThink: Math.random() * 0.3, wander: null };
  }

  spawnCiv(x, z) {
    const e = this.makeEntity('civ', x, z, CIV_PALETTES[(Math.random() * CIV_PALETTES.length) | 0]);
    e.state = 'calm'; e.turning = false; e.stamina = 100; e.calmAt = 0;
    this.civs.push(e); return e;
  }
  spawnZombie(x, z) {
    const e = this.makeEntity('zombie', x, z);
    e.hp = 3; e.speed = 3.0 + Math.random() * 0.9;
    this.zombies.push(e); this.parts.burst(x, 1, z, 0x53ff7a, 14); return e;
  }
  spawnCop(x, z, type) {
    const e = this.makeEntity(type, x, z);
    const t = COP_TYPES[type];
    e.copType = type; e.hp = t.hp; e.nextShot = 0; e.lastBite = 0;
    this.cops.push(e); return e;
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

  spawnVehicle(x, z, vtype) {
    const spec = VEHICLES[vtype];
    let mesh;
    if (vtype === 'car') mesh = makePoliceCar();
    else if (vtype === 'tank') mesh = makeTank();
    else mesh = makeHelicopter();
    const y = vtype === 'heli' ? 9 : 0;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const v = { mesh, x, z, y, vx: 0, vz: 0, vtype, hp: spec.hp, nextShot: 0, life: spec.life || 0, deployed: false, leaving: false, lastBite: 0 };
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
  finishTurn(civ) { const { x, z } = civ; this.remove(civ, this.civs); AudioFX.turn(); this.spawnZombie(x, z); }

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
    for (const t of this.city.trees) if (!t.broken && Math.hypot(t.x - x, t.z - z) < BLAST_R) this.breakTree(t);
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

    this.updateVehicles(dt);
    this.updateProps(dt);
    this.updateDebris(dt);

    // infection contacts
    for (const c of this.civs) {
      if (c.turning) continue;
      if (this.dist(this.player, c) < INFECT_DIST) { this.infect(c, true); continue; }
      for (const z of this.zombies) if (this.dist(z, c) < INFECT_DIST) { this.infect(c, false); break; }
    }
    // bites
    for (const cop of this.cops) {
      if (this.dist(this.player, cop) < BITE_DIST) this.bite(cop, 2);
      else for (const z of this.zombies) if (this.dist(z, cop) < BITE_DIST) { this.bite(cop, 1); break; }
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
    if (this.aliveCivs <= 0 && this.cops.length === 0 && tanksLeft === 0) this.endLevel(true);
  }

  updatePlayer(dt, input) {
    const p = this.player;
    const lunging = this.time < this.lungeUntil;
    if (!lunging) {
      const dx = input.mx || 0, dz = input.mz || 0;
      if (dx || dz) {
        const l = Math.hypot(dx, dz); this.dir.set(dx / l, dz / l);
        p.vx = this.dir.x * 6; p.vz = this.dir.y * 6;
      } else { p.vx = 0; p.vz = 0; }
      if (input.lunge && this.time > this.lungeReadyAt) {
        this.lungeReadyAt = this.time + 1.6; this.lungeUntil = this.time + 0.2;
        p.vx = this.dir.x * 17; p.vz = this.dir.y * 17;
        AudioFX.lunge(); this.parts.burst(p.x, 1, p.z, 0x53ff7a, 6);
      }
    }
    // dashing shatters trees and detonates barrels
    if (lunging) {
      for (const t of this.city.trees) if (!t.broken && Math.hypot(t.x - p.x, t.z - p.z) < 1.5) this.breakTree(t);
      for (const b of this.barrels) if (!b.dead && Math.hypot(b.x - p.x, b.z - p.z) < 1.5) this.popBarrel(b);
    }
    if (this.time > this.nextRegenAt) { this.nextRegenAt = this.time + 9; if (p.hp < p.maxHp) p.hp++; }
    this.lungeCooldown = THREE.MathUtils.clamp((this.lungeReadyAt - this.time) / 1.6, 0, 1);
    this.aura.position.set(p.x, 0.05, p.z);
    const s = 1 + Math.sin(this.time * 4) * 0.08; this.aura.scale.setScalar(s);
  }

  moveEntity(e, dt) {
    const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    const r = this.city.collide(nx, nz, R);
    e.x = r.x; e.z = r.z;
    const moving = Math.hypot(e.vx, e.vz) > 0.4;
    e.mesh.position.x = e.x; e.mesh.position.z = e.z;
    if (moving) e.mesh.rotation.y = Math.atan2(e.vx, e.vz);
    animateWalk(e.mesh, Math.hypot(e.vx, e.vz), dt, moving);
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
    let threat = this.nearest(this.zombies, c.x, c.z, 6);
    if (!threat && this.dist(this.player, c) < 6) threat = this.player;
    const spd = 2.4 + 1.9 * (c.stamina / 100);
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
    let tgt = this.nearest(this.civs, z.x, z.z, 11, e => !e.turning);
    if (!tgt) tgt = this.nearest(this.cops, z.x, z.z, 13);
    if (!tgt) tgt = this.nearest(this.vehicles.filter(v => v.vtype !== 'heli'), z.x, z.z, 12);
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

  updateVehicles(dt) {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const spec = VEHICLES[v.vtype];
      const p = this.player;
      const d = this.dist(p, v);

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
