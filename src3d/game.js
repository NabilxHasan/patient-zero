// Core gameplay for the 3D build. Entities live on the XZ plane; each holds a
// three.js group synced every frame. Ports the 2D design and tuning.
import * as THREE from 'three';
import { buildCity } from './city.js';
import { makeCharacter, animateWalk, box, CIV_PALETTES } from './models.js';
import { LEVELS, HEADLINES, COP_TYPES } from './levels.js';

const R = 0.45;              // character collision radius
const INFECT_DIST = 1.1;
const BITE_DIST = 1.2;
const TURN_TIME = 1.4;

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
    this.parts = new ParticlePool(this.scene);
    this.elapsed = 0;
    this.time = 0;
    this.infectedCount = 0;
    this.initialCivs = cfg.civs;
    this.aliveCivs = cfg.civs;
    this.outbreak = 0;
    this.headlineIdx = 0;
    this.schedule = cfg.responders.map(r => ({ ...r, done: false }));

    // player
    const ps = this.city.streetPointNear(this.city.W / 2, this.city.H / 2, 2, 6);
    this.player = this.makeEntity('player', ps.x, ps.z);
    this.player.hp = cfg.playerHp;
    this.player.maxHp = cfg.playerHp;
    this.lungeReadyAt = 0; this.lungeUntil = 0; this.invulnUntil = 0;
    this.nextRegenAt = 9;
    this.dir = new THREE.Vector2(0, 1);

    // player aura (ground glow)
    this.aura = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x35d072, transparent: true, opacity: 0.16 })
    );
    this.aura.rotation.x = -Math.PI / 2;
    this.scene.add(this.aura);

    for (let i = 0; i < cfg.civs; i++) {
      const p = this.city.randomStreetPoint();
      this.spawnCiv(p.x, p.z);
    }
    for (const grp of cfg.initial) {
      for (let i = 0; i < grp.count; i++) {
        const p = this.city.streetPointNear(this.player.x, this.player.z, 14, 26);
        this.spawnCop(p.x, p.z, grp.type);
      }
    }

    this.msgs.push({ type: 'level', name: cfg.name, intro: cfg.intro });
    this.msgs.push({ type: 'headline', text: HEADLINES[0].text });
    this.headlineIdx = 1;
  }

  // ---- entity factory ----
  makeEntity(kind, x, z, palette) {
    const mesh = makeCharacter(kind, palette);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    return { mesh, x, z, vx: 0, vz: 0, kind, speed: 0, nextThink: Math.random() * 0.3, wander: null };
  }

  spawnCiv(x, z) {
    const e = this.makeEntity('civ', x, z, CIV_PALETTES[(Math.random() * CIV_PALETTES.length) | 0]);
    e.state = 'calm'; e.turning = false; e.stamina = 100; e.calmAt = 0;
    this.civs.push(e);
    return e;
  }

  spawnZombie(x, z) {
    const e = this.makeEntity('zombie', x, z);
    e.hp = 3; e.speed = 3.0 + Math.random() * 0.9;
    this.zombies.push(e);
    this.parts.burst(x, 1, z, 0x53ff7a, 14);
    return e;
  }

  spawnCop(x, z, type) {
    const e = this.makeEntity(type, x, z);
    const t = COP_TYPES[type];
    e.copType = type; e.hp = t.hp; e.nextShot = 0; e.lastBite = 0;
    this.cops.push(e);
    return e;
  }

  // ---- helpers ----
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

  remove(e, list) {
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    this.scene.remove(e.mesh);
  }

  // ---- infection & combat ----
  infect(civ, byPlayer) {
    if (this.over || civ.turning) return;
    civ.turning = true; civ.vx = civ.vz = 0; civ.turnAt = this.time + TURN_TIME;
    this.aliveCivs--; this.infectedCount++;
    AudioFX.infect();
    this.parts.burst(civ.x, 1, civ.z, 0x53ff7a, 10);
    if (byPlayer) this.msgs.push({ type: 'shake', amt: 0.25 });
    // nearby civilians panic
    for (const o of this.civs) {
      if (!o.turning && this.dist(o, civ) < 5) { o.state = 'panic'; o.calmAt = this.time + 2.6; }
    }
    // tint the doomed civ greenish
    civ.mesh.traverse(m => { if (m.material && m.material.color) m.material = m.material.clone(); });
  }

  finishTurn(civ) {
    const { x, z } = civ;
    this.remove(civ, this.civs);
    AudioFX.turn();
    this.spawnZombie(x, z);
  }

  bite(cop, dmg) {
    if (this.over || this.time < cop.lastBite + 0.48) return;
    cop.lastBite = this.time;
    cop.hp -= dmg;
    this.parts.burst(cop.x, 1, cop.z, 0xb32626, 6);
    if (cop.hp <= 0) {
      const { x, z } = cop;
      this.remove(cop, this.cops);
      AudioFX.copDown();
      this.infectedCount++;
      this.spawnZombie(x, z);
      this.msgs.push({ type: 'shake', amt: 0.3 });
    }
  }

  fireBullet(cop, target) {
    const t = COP_TYPES[cop.copType];
    const a = Math.atan2(target.x - cop.x, target.z - cop.z) + (Math.random() - 0.5) * 0.12;
    const sx = Math.sin(a), sz = Math.cos(a);
    const mesh = box(0.16, 0.16, 0.5, 0xffd77a, { emissive: 0xffd77a, emissiveIntensity: 3, cast: false });
    mesh.position.set(cop.x + sx * 0.9, 1.15, cop.z + sz * 0.9);
    mesh.rotation.y = a;
    this.scene.add(mesh);
    this.bullets.push({ mesh, x: mesh.position.x, z: mesh.position.z, vx: sx * t.bulletSpeed, vz: sz * t.bulletSpeed, dmg: t.dmg, life: 1.1 });
    this.parts.burst(cop.x + sx, 1.15, cop.z + sz, 0xffe08a, 4);
    AudioFX.shot();
  }

  killBullet(b) { this.remove(b, this.bullets); }

  // ---- main update ----
  update(dt, input) {
    if (this.over) { this.parts.update(dt); return; }
    this.time += dt; this.elapsed += dt;

    this.updatePlayer(dt, input);

    // staggered AI
    for (const c of this.civs) {
      if ((c.nextThink -= dt) <= 0) { this.thinkCiv(c); c.nextThink = 0.13 + Math.random() * 0.09;
        if (c.state === 'panic') c.stamina = Math.max(0, c.stamina - 2.2); else c.stamina = Math.min(100, c.stamina + 1.4); }
      if (c.turning && this.time >= c.turnAt) { this.finishTurn(c); }
    }
    for (const z of this.zombies) { if ((z.nextThink -= dt) <= 0) { this.thinkZombie(z); z.nextThink = 0.14 + Math.random() * 0.1; } }
    for (const cop of this.cops) { if ((cop.nextThink -= dt) <= 0) { this.thinkCop(cop); cop.nextThink = 0.1 + Math.random() * 0.07; } }

    // integrate movement + collide
    this.moveEntity(this.player, dt);
    for (const c of this.civs) if (!c.turning) this.moveEntity(c, dt);
    for (const z of this.zombies) this.moveEntity(z, dt);
    for (const cop of this.cops) this.moveEntity(cop, dt);

    // infection contacts
    for (const c of this.civs) {
      if (c.turning) continue;
      if (this.dist(this.player, c) < INFECT_DIST) { this.infect(c, true); continue; }
      for (const z of this.zombies) { if (this.dist(z, c) < INFECT_DIST) { this.infect(c, false); break; } }
    }
    // bite contacts (player & zombies vs cops)
    for (const cop of this.cops) {
      if (this.dist(this.player, cop) < BITE_DIST) this.bite(cop, 2);
      else for (const z of this.zombies) { if (this.dist(z, cop) < BITE_DIST) { this.bite(cop, 1); break; } }
    }

    this.updateBullets(dt);
    this.updateWaves();
    this.parts.update(dt);
    AudioFX.heartbeat(this.outbreak);

    if (this.aliveCivs <= 0 && this.cops.length === 0) this.endLevel(true);
  }

  updatePlayer(dt, input) {
    const p = this.player;
    if (this.time < this.lungeUntil) {
      // keep lunge velocity
    } else {
      const dx = (input.D ? 1 : 0) - (input.A ? 1 : 0);
      const dz = (input.S ? 1 : 0) - (input.W ? 1 : 0);
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
    if (this.time > this.nextRegenAt) { this.nextRegenAt = this.time + 9; if (p.hp < p.maxHp) p.hp++; }
    this.lungeCooldown = THREE.MathUtils.clamp((this.lungeReadyAt - this.time) / 1.6, 0, 1);
    this.aura.position.set(p.x, 0.05, p.z);
    const s = 1 + Math.sin(this.time * 4) * 0.12; this.aura.scale.setScalar(s);
  }

  moveEntity(e, dt) {
    let nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    const r = this.city.collide(nx, nz, R);
    e.x = r.x; e.z = r.z;
    const moving = Math.hypot(e.vx, e.vz) > 0.4;
    e.mesh.position.x = e.x; e.mesh.position.z = e.z;
    if (moving) e.mesh.rotation.y = Math.atan2(e.vx, e.vz);
    animateWalk(e.mesh, Math.hypot(e.vx, e.vz), dt, moving);
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
      // keep fleeing direction
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
      if (d < t.fireRange && this.time > cop.nextShot) { cop.nextShot = this.time + t.fireDelay * (0.85 + Math.random() * 0.3); this.fireBullet(cop, tgt); }
    } else {
      if (!cop.wander || Math.hypot(cop.x - cop.wander.x, cop.z - cop.wander.z) < 1) cop.wander = this.city.streetPointNear(cop.x, cop.z, 4, 14);
      const a = Math.atan2(cop.wander.x - cop.x, cop.wander.z - cop.z);
      cop.vx = Math.sin(a) * t.speed * 0.55; cop.vz = Math.cos(a) * t.speed * 0.55;
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      b.mesh.position.set(b.x, 1.15, b.z);
      if (b.life <= 0 || this.city.blockedSegment(b.x, b.z)) { this.killBullet(b); continue; }
      let hit = false;
      for (const z of this.zombies) { if (Math.hypot(b.x - z.x, b.z - z.z) < 0.7) { z.hp -= b.dmg; this.parts.burst(b.x, 1.1, b.z, 0xb32626, 5);
        if (z.hp <= 0) { this.remove(z, this.zombies); AudioFX.zdie(); } hit = true; break; } }
      if (hit) { this.killBullet(b); continue; }
      if (this.dist(this.player, b) < 0.7 && this.time > this.invulnUntil) {
        this.killBullet(b); this.invulnUntil = this.time + 0.65; this.player.hp--; AudioFX.hit();
        this.msgs.push({ type: 'flash' }); this.msgs.push({ type: 'shake', amt: 0.5 });
        if (this.player.hp <= 0) this.endLevel(false);
      }
    }
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
  }

  endLevel(win) {
    if (this.over) return;
    this.over = true; this.won = win;
    this.msgs.push({ type: 'stinger', text: win ? 'DISTRICT FALLEN' : 'PATIENT ZERO CONTAINED' });
    if (win) AudioFX.win(); else AudioFX.lose();
    this.msgs.push({ type: 'end', win, level: this.levelIndex, seconds: Math.round(this.elapsed), infected: this.infectedCount });
  }
}

// Lightweight pooled particle burst system (small emissive cubes).
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
      const s = Math.max(0.05, p.userData.life / p.userData.max);
      p.scale.setScalar(s);
    }
  }
}
