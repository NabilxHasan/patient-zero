// Core gameplay: you are patient zero. Spread the infection, dodge containment.
class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  init(data) {
    this.levelIndex = data.level || 0;
    this.cfg = LEVELS[this.levelIndex];
  }

  create() {
    const cfg = this.cfg;
    this.over = false;
    this.uiQueue = [];               // messages the UI scene polls each frame
    this.startTime = this.time.now;
    this.infectedCount = 0;
    this.aliveCivs = cfg.civs;
    this.initialCivs = cfg.civs;
    this.outbreak = 0;
    this.headlineIdx = 0;
    this.spawnSchedule = cfg.responders.map(r => ({ ...r, done: false }));

    this.city = buildCity(this, cfg);
    this.physics.world.setBounds(0, 0, cfg.worldW, cfg.worldH);

    // ground decal layer for splats/corpse stains
    this.decalRT = this.add.renderTexture(0, 0, cfg.worldW, cfg.worldH).setOrigin(0).setDepth(-8);
    this.decalStamp = this.make.image({ key: 'splat', add: false });

    // --- groups ---
    this.civs = this.physics.add.group();
    this.zombies = this.physics.add.group();
    this.cops = this.physics.add.group();
    this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 90 });

    // --- particles ---
    this.infectFx = this.add.particles(0, 0, 'px', {
      speed: { min: 40, max: 170 }, lifespan: 450, scale: { start: 1.6, end: 0 },
      tint: 0x53ff7a, emitting: false,
    }).setDepth(8);
    this.bloodFx = this.add.particles(0, 0, 'px', {
      speed: { min: 30, max: 150 }, lifespan: 380, scale: { start: 1.4, end: 0 },
      tint: 0xb32626, emitting: false,
    }).setDepth(8);
    this.muzzleFx = this.add.particles(0, 0, 'px', {
      speed: { min: 20, max: 90 }, lifespan: 120, scale: { start: 1.2, end: 0 },
      tint: 0xffe08a, emitting: false,
    }).setDepth(8);

    // --- player ---
    const pSpawn = this.city.randomStreetPoint(cfg.worldW * 0.3, cfg.worldH * 0.3, cfg.worldW * 0.7, cfg.worldH * 0.7);
    this.player = this.physics.add.image(pSpawn.x, pSpawn.y, 'player_0').setScale(0.5).setDepth(3);
    this.player.baseKey = 'player';
    this.player.stepFrame = 0;
    this.player.nextStepAt = 0;
    this.player.body.setCircle(22, 8, 8);
    this.player.setCollideWorldBounds(true);
    this.player.hp = cfg.playerHp;
    this.player.maxHp = cfg.playerHp;
    this.playerDir = new Phaser.Math.Vector2(1, 0);
    this.lungeReadyAt = 0;
    this.lungeUntil = 0;
    this.invulnUntil = 0;
    this.nextRegenAt = this.time.now + 9000;

    this.aura = this.add.image(pSpawn.x, pSpawn.y, 'blob').setTint(0x35d072).setAlpha(0.5).setScale(1.5).setDepth(2);
    this.tweens.add({ targets: this.aura, scale: 1.9, alpha: 0.3, duration: 900, yoyo: true, repeat: -1 });

    // infection motes drifting off patient zero
    this.add.particles(0, 0, 'px', {
      follow: this.player, frequency: 110, speed: { min: 8, max: 32 },
      lifespan: 700, alpha: { start: 0.55, end: 0 }, scale: { start: 1, end: 0 },
      tint: 0x53ff7a,
    }).setDepth(2);

    // --- civilians ---
    for (let i = 0; i < cfg.civs; i++) {
      const pt = this.city.randomStreetPoint();
      this.spawnCiv(pt.x, pt.y);
    }

    // --- initial responders ---
    for (const grp of cfg.initial) {
      for (let i = 0; i < grp.count; i++) {
        const pt = this.city.streetPointNear(this.player.x, this.player.y, 450, 900);
        this.spawnCop(pt.x, pt.y, grp.type);
      }
    }

    // --- physics wiring ---
    const walls = this.city.wallBodies;
    this.physics.add.collider(this.player, walls);
    this.physics.add.collider(this.civs, walls);
    this.physics.add.collider(this.zombies, walls);
    this.physics.add.collider(this.cops, walls);
    this.physics.add.collider(this.zombies, this.zombies);
    this.physics.add.collider(this.bullets, walls, (b) => this.killBullet(b));

    this.physics.add.overlap(this.player, this.civs, (p, c) => this.infect(c, true));
    this.physics.add.overlap(this.zombies, this.civs, (z, c) => this.infect(c, false));
    this.physics.add.overlap(this.bullets, this.zombies, (b, z) => this.bulletHitZombie(b, z));
    this.physics.add.overlap(this.bullets, this.player, (p, b) => this.bulletHitPlayer(b));
    this.physics.add.overlap(this.zombies, this.cops, (z, c) => this.bite(z, c, 1));
    this.physics.add.overlap(this.player, this.cops, (p, c) => this.bite(p, c, 2));

    // --- camera ---
    // Zoom is a pure render transform (it never affects the game loop). Press Z
    // to cycle it live; 1.0 = fully zoomed out.
    this.zoomSteps = [1.0, 1.15, 1.3, 1.5];
    this.zoomIdx = 2; // default 1.3
    const cam = this.cameras.main;
    cam.setBounds(0, 0, cfg.worldW, cfg.worldH);
    cam.setZoom(this.zoomSteps[this.zoomIdx]);
    cam.startFollow(this.player, true, 0.09, 0.09);
    cam.fadeIn(500, 0, 0, 0);

    // --- input ---
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,R,M,Z');

    // --- UI scene ---
    if (this.scene.isActive('ui')) this.scene.stop('ui');
    this.scene.launch('ui');
    this.uiQueue.push({ type: 'level', name: cfg.name, intro: cfg.intro });
    this.uiQueue.push({ type: 'headline', text: HEADLINES[0].text });
    this.headlineIdx = 1;
  }

  // ---------------------------------------------------------------- spawning

  spawnCiv(x, y) {
    const key = Phaser.Utils.Array.GetRandom(CIV_KEYS);
    const c = this.civs.create(x, y, `${key}_0`);
    c.baseKey = key;
    c.stepFrame = 0;
    c.nextStepAt = 0;
    c.setScale(0.5).setDepth(2);
    c.body.setCircle(18, 8, 8);
    c.setCollideWorldBounds(true);
    c.kind = 'civ';
    c.state = 'calm';
    c.turning = false;
    c.stamina = 100;
    c.calmAt = 0;
    c.nextThink = Math.random() * 300;
    c.wanderTo = null;
    return c;
  }

  spawnZombie(x, y) {
    const z = this.zombies.create(x, y, 'zombie_0');
    z.baseKey = 'zombie';
    z.stepFrame = 0;
    z.nextStepAt = 0;
    z.setScale(0.5).setDepth(2);
    z.body.setCircle(18, 8, 8);
    z.setCollideWorldBounds(true);
    z.kind = 'zombie';
    z.hp = 3;
    z.speed = Phaser.Math.Between(60, 78);
    z.nextThink = 0;
    z.wanderTo = null;
    this.infectFx.explode(14, x, y);
    return z;
  }

  spawnCop(x, y, type) {
    const t = COP_TYPES[type];
    const c = this.cops.create(x, y, `${type}_0`);
    c.baseKey = type;
    c.stepFrame = 0;
    c.nextStepAt = 0;
    c.setScale(0.5).setDepth(2);
    c.body.setCircle(18, 8, 8);
    c.setCollideWorldBounds(true);
    c.kind = 'cop';
    c.copType = type;
    c.hp = t.hp;
    c.nextShot = 0;
    c.nextThink = Math.random() * 200;
    c.lastBitAt = 0;
    c.wanderTo = null;
    return c;
  }

  // ---------------------------------------------------------------- combat & infection

  infect(civ, byPlayer) {
    if (this.over || !civ.active || civ.turning) return;
    civ.turning = true;
    civ.setVelocity(0, 0);
    civ.state = 'turning';
    this.aliveCivs--;
    this.infectedCount++;
    AudioFX.infect();
    this.infectFx.explode(10, civ.x, civ.y);
    if (byPlayer) this.cameras.main.shake(90, 0.003);

    // nearby civilians witness it and panic
    for (const other of this.civs.getChildren()) {
      if (other.active && !other.turning && Phaser.Math.Distance.Between(civ.x, civ.y, other.x, other.y) < 170) {
        other.state = 'panic';
        other.calmAt = this.time.now + 2600;
      }
    }

    this.tweens.add({ targets: civ, alpha: 0.4, duration: 110, yoyo: true, repeat: 4 });
    civ.setTint(0xa8d47a);
    this.time.delayedCall(1400, () => {
      if (!civ.active) return;
      const { x, y } = civ;
      civ.destroy();
      AudioFX.turn();
      this.spawnZombie(x, y);
    });
  }

  bite(attacker, cop, dmg) {
    if (this.over || !cop.active || !attacker.active) return;
    const now = this.time.now;
    if (now < cop.lastBitAt + 480) return;
    cop.lastBitAt = now;
    cop.hp -= dmg;
    this.bloodFx.explode(6, cop.x, cop.y);
    this.tweens.add({ targets: cop, alpha: 0.4, duration: 70, yoyo: true });
    if (cop.hp <= 0) {
      const { x, y } = cop;
      this.stampDecal(x, y, 0x5a1a1a, 1.1);
      cop.destroy();
      AudioFX.copDown();
      this.infectedCount++;
      this.spawnZombie(x, y);      // responders rise too — the chain grows
      this.cameras.main.shake(110, 0.004);
    }
  }

  fireBullet(cop, target) {
    const b = this.bullets.get(cop.x, cop.y, 'bullet');
    if (!b) return;
    const t = COP_TYPES[cop.copType];
    const ang = Phaser.Math.Angle.Between(cop.x, cop.y, target.x, target.y) + (Math.random() - 0.5) * 0.14;
    const mx = cop.x + Math.cos(ang) * 13, my = cop.y + Math.sin(ang) * 13;
    b.enableBody(true, mx, my, true, true);
    b.setDepth(4).setTint(0xffd77a);
    b.body.setSize(10, 4);
    b.setRotation(ang);
    this.physics.velocityFromRotation(ang, t.bulletSpeed, b.body.velocity);
    b.dmg = t.dmg;
    b.expireAt = this.time.now + 950;
    this.muzzleFx.explode(4, cop.x + Math.cos(ang) * 14, cop.y + Math.sin(ang) * 14);
    AudioFX.shot();
  }

  killBullet(b) {
    if (b.active) b.disableBody(true, true);
  }

  bulletHitZombie(b, z) {
    if (!b.active || !z.active) return;
    this.killBullet(b);
    z.hp -= b.dmg;
    this.bloodFx.explode(5, z.x, z.y);
    this.tweens.add({ targets: z, alpha: 0.35, duration: 60, yoyo: true });
    if (z.hp <= 0) {
      this.stampDecal(z.x, z.y, 0x2e4d2a, 1.0);
      z.destroy();
      AudioFX.zdie();
    }
  }

  bulletHitPlayer(b) {
    if (!b.active || this.over) return;
    this.killBullet(b);
    if (this.time.now < this.invulnUntil) return;
    this.invulnUntil = this.time.now + 650;
    this.player.hp--;
    AudioFX.hit();
    this.cameras.main.shake(140, 0.006);
    this.uiQueue.push({ type: 'flash' });
    this.tweens.add({ targets: this.player, alpha: 0.3, duration: 90, yoyo: true, repeat: 3 });
    if (this.player.hp <= 0) this.endLevel(false);
  }

  stampDecal(x, y, tint, scale) {
    this.decalStamp.setTint(tint).setAlpha(0.75).setScale(scale + Math.random() * 0.4);
    this.decalStamp.setRotation(Math.random() * Math.PI * 2);
    this.decalRT.draw(this.decalStamp, x, y);
  }

  // ---------------------------------------------------------------- AI

  // two-frame walk cycle: swap textures while moving, rest on frame 0
  stepAnim(agent, time) {
    if (!agent.baseKey || !agent.active) return;
    const moving = agent.body.velocity.length() > 8;
    if (!moving) {
      if (agent.stepFrame !== 0) { agent.stepFrame = 0; agent.setTexture(`${agent.baseKey}_0`); }
      return;
    }
    if (time > agent.nextStepAt) {
      agent.stepFrame = 1 - agent.stepFrame;
      agent.setTexture(`${agent.baseKey}_${agent.stepFrame}`);
      agent.nextStepAt = time + (agent.body.velocity.length() > 70 ? 150 : 240);
    }
  }

  nearestOf(group, x, y, maxDist, filter) {
    let best = null, bestD = maxDist * maxDist;
    for (const m of group.getChildren()) {
      if (!m.active || (filter && !filter(m))) continue;
      const dx = m.x - x, dy = m.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  thinkCiv(c, now) {
    if (c.turning) return;
    // spot threats: zombies or the player
    let threat = this.nearestOf(this.zombies, c.x, c.y, 175);
    if (!threat && Phaser.Math.Distance.Between(c.x, c.y, this.player.x, this.player.y) < 175) threat = this.player;

    if (threat) {
      c.state = 'panic';
      c.calmAt = now + 2600;
      const ang = Phaser.Math.Angle.Between(threat.x, threat.y, c.x, c.y);
      const speed = 58 + 46 * (c.stamina / 100);
      c.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
    } else if (c.state === 'panic') {
      if (now > c.calmAt) { c.state = 'calm'; c.wanderTo = null; }
      else {
        // keep running the way they were going
        const speed = 58 + 46 * (c.stamina / 100);
        const v = c.body.velocity;
        if (v.length() < 10) c.wanderTo = null;
        else { v.normalize(); c.setVelocity(v.x * speed, v.y * speed); }
      }
    }

    if (c.state === 'calm') {
      if (!c.wanderTo || Phaser.Math.Distance.Between(c.x, c.y, c.wanderTo.x, c.wanderTo.y) < 24) {
        c.wanderTo = this.city.streetPointNear(c.x, c.y, 80, 320);
      }
      this.physics.moveTo(c, c.wanderTo.x, c.wanderTo.y, 38);
    }
  }

  thinkZombie(z, now) {
    let target = this.nearestOf(this.civs, z.x, z.y, 270, m => !m.turning);
    if (!target) target = this.nearestOf(this.cops, z.x, z.y, 320);
    if (target) {
      this.physics.moveTo(z, target.x, target.y, z.speed);
    } else {
      if (!z.wanderTo || Phaser.Math.Distance.Between(z.x, z.y, z.wanderTo.x, z.wanderTo.y) < 24) {
        // shamble loosely toward the player so the horde stays with the action
        z.wanderTo = this.city.streetPointNear(this.player.x, this.player.y, 60, 420);
      }
      this.physics.moveTo(z, z.wanderTo.x, z.wanderTo.y, 42);
    }
  }

  thinkCop(cop, now) {
    const t = COP_TYPES[cop.copType];
    let target = this.nearestOf(this.zombies, cop.x, cop.y, t.sight);
    const pd = Phaser.Math.Distance.Between(cop.x, cop.y, this.player.x, this.player.y);
    if (!this.over && pd < t.sight && (!target ||
        pd < Phaser.Math.Distance.Between(cop.x, cop.y, target.x, target.y))) {
      target = this.player;
    }

    if (target) {
      const d = Phaser.Math.Distance.Between(cop.x, cop.y, target.x, target.y);
      if (d < 80) {
        // too close — back away while firing
        const ang = Phaser.Math.Angle.Between(target.x, target.y, cop.x, cop.y);
        cop.setVelocity(Math.cos(ang) * t.speed, Math.sin(ang) * t.speed);
      } else if (d > t.fireRange * 0.85) {
        this.physics.moveTo(cop, target.x, target.y, t.speed);
      } else {
        cop.setVelocity(0, 0);
      }
      cop.setRotation(Phaser.Math.Angle.Between(cop.x, cop.y, target.x, target.y));
      if (d < t.fireRange && now > cop.nextShot) {
        cop.nextShot = now + t.fireDelay * (0.85 + Math.random() * 0.3);
        this.fireBullet(cop, target);
      }
    } else {
      if (!cop.wanderTo || Phaser.Math.Distance.Between(cop.x, cop.y, cop.wanderTo.x, cop.wanderTo.y) < 24) {
        cop.wanderTo = this.city.streetPointNear(cop.x, cop.y, 120, 400);
      }
      this.physics.moveTo(cop, cop.wanderTo.x, cop.wanderTo.y, t.speed * 0.55);
    }
  }

  // ---------------------------------------------------------------- update loop

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) {
      const muted = AudioFX.toggleMute();
      this.uiQueue.push({ type: 'headline', text: muted ? '[ AUDIO MUTED ]' : '[ AUDIO ON ]' });
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.scene.stop('ui');
      this.scene.restart({ level: this.levelIndex });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.Z)) {
      this.zoomIdx = (this.zoomIdx + 1) % this.zoomSteps.length;
      const z = this.zoomSteps[this.zoomIdx];
      this.cameras.main.setZoom(z);
      this.uiQueue.push({ type: 'headline', text: `[ ZOOM ${z.toFixed(2)}x ]` });
    }
    if (this.over) return;

    this.updatePlayer(time, delta);

    // staggered AI so we never think about everyone in one frame
    for (const c of this.civs.getChildren()) {
      if (c.active && time > c.nextThink) {
        this.thinkCiv(c, time);
        c.nextThink = time + 130 + Math.random() * 90;
        if (c.state === 'panic') c.stamina = Math.max(0, c.stamina - 2.2);
        else c.stamina = Math.min(100, c.stamina + 1.4);
      }
      if (c.active && !c.turning && c.body.velocity.length() > 8) c.setRotation(c.body.velocity.angle());
      this.stepAnim(c, time);
    }
    for (const z of this.zombies.getChildren()) {
      if (z.active && time > z.nextThink) {
        this.thinkZombie(z, time);
        z.nextThink = time + 140 + Math.random() * 100;
      }
      if (z.active && z.body.velocity.length() > 8) z.setRotation(z.body.velocity.angle());
      this.stepAnim(z, time);
    }
    for (const cop of this.cops.getChildren()) {
      if (cop.active && time > cop.nextThink) {
        this.thinkCop(cop, time);
        cop.nextThink = time + 110 + Math.random() * 70;
      }
      this.stepAnim(cop, time);
    }

    // bullet lifespan
    for (const b of this.bullets.getChildren()) {
      if (b.active && time > b.expireAt) this.killBullet(b);
    }

    // outbreak bookkeeping
    this.outbreak = 1 - this.aliveCivs / this.initialCivs;
    while (this.headlineIdx < HEADLINES.length && this.outbreak >= HEADLINES[this.headlineIdx].pct) {
      this.uiQueue.push({ type: 'headline', text: HEADLINES[this.headlineIdx].text });
      this.headlineIdx++;
    }
    for (const s of this.spawnSchedule) {
      if (!s.done && this.outbreak >= s.pct) {
        s.done = true;
        for (let i = 0; i < s.count; i++) {
          const pt = this.city.streetPointNear(this.player.x, this.player.y, 500, 850);
          this.spawnCop(pt.x, pt.y, s.type);
        }
        this.uiQueue.push({ type: 'stinger', text: COP_TYPES[s.type].label });
        AudioFX.siren();
      }
    }

    AudioFX.heartbeat(this.outbreak);

    // win: every civilian infected and every responder down
    if (this.aliveCivs <= 0 && this.cops.countActive(true) === 0) {
      this.endLevel(true);
    }
  }

  updatePlayer(time, delta) {
    const k = this.keys;
    const p = this.player;

    if (time < this.lungeUntil) {
      // mid-lunge: keep the burst velocity
    } else {
      let dx = (k.A.isDown || k.LEFT.isDown ? -1 : 0) + (k.D.isDown || k.RIGHT.isDown ? 1 : 0);
      let dy = (k.W.isDown || k.UP.isDown ? -1 : 0) + (k.S.isDown || k.DOWN.isDown ? 1 : 0);
      if (dx || dy) {
        this.playerDir.set(dx, dy).normalize();
        p.setVelocity(this.playerDir.x * 150, this.playerDir.y * 150);
      } else {
        p.setVelocity(0, 0);
      }
      if (Phaser.Input.Keyboard.JustDown(k.SPACE) && time > this.lungeReadyAt) {
        this.lungeReadyAt = time + 1600;
        this.lungeUntil = time + 210;
        p.setVelocity(this.playerDir.x * 430, this.playerDir.y * 430);
        AudioFX.lunge();
        this.infectFx.explode(6, p.x, p.y);
      }
    }
    if (p.body.velocity.length() > 8) p.setRotation(p.body.velocity.angle());
    this.stepAnim(p, time);
    this.aura.setPosition(p.x, p.y);

    // slow regeneration
    if (time > this.nextRegenAt) {
      this.nextRegenAt = time + 9000;
      if (p.hp < p.maxHp) p.hp++;
    }

    this.lungeCooldown = Phaser.Math.Clamp((this.lungeReadyAt - time) / 1600, 0, 1);
  }

  endLevel(win) {
    if (this.over) return;
    this.over = true;
    const elapsed = Math.round((this.time.now - this.startTime) / 1000);
    this.uiQueue.push({ type: 'stinger', text: win ? 'DISTRICT FALLEN' : 'PATIENT ZERO CONTAINED' });
    if (win) { AudioFX.win(); } else { AudioFX.lose(); this.player.setTint(0x666666); }
    this.physics.pause();
    this.tweens.add({ targets: this.cameras.main, zoom: this.cameras.main.zoom * 1.12, duration: 1200, ease: 'Sine.easeOut' });
    this.time.delayedCall(1500, () => {
      this.scene.stop('ui');
      this.scene.start('end', {
        win,
        level: this.levelIndex,
        seconds: elapsed,
        infected: this.infectedCount,
        final: win && this.levelIndex === LEVELS.length - 1,
      });
    });
  }
}
