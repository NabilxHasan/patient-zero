// HUD overlay scene — polls the game scene's state each frame.
const MONO_UI = 'Consolas, "Courier New", monospace';

class UIScene extends Phaser.Scene {
  constructor() { super('ui'); }

  create() {
    const W = this.scale.width;

    // night vignette over the whole scene, under the HUD widgets
    this.add.image(W / 2, this.scale.height / 2, 'vignette')
      .setDisplaySize(W + 60, this.scale.height + 60).setDepth(0);

    // news ticker strip
    this.add.rectangle(0, 0, W, 34, 0x05070a, 0.92).setOrigin(0).setDepth(1);
    this.liveDot = this.add.circle(18, 17, 5, 0xff3b3b).setDepth(2);
    this.tweens.add({ targets: this.liveDot, alpha: 0.2, duration: 500, yoyo: true, repeat: -1 });
    this.add.text(32, 17, 'LIVE', { fontFamily: MONO_UI, fontSize: '13px', color: '#ff6b6b', fontStyle: 'bold' })
      .setOrigin(0, 0.5).setDepth(2);
    this.headlineText = this.add.text(78, 17, '', { fontFamily: MONO_UI, fontSize: '14px', color: '#d1d5db' })
      .setOrigin(0, 0.5).setDepth(2);
    this.headlineTarget = '';
    this.headlineShown = 0;

    // outbreak meter
    this.levelText = this.add.text(16, 46, '', { fontFamily: MONO_UI, fontSize: '13px', color: '#9ca3af' }).setDepth(2);
    this.add.rectangle(16, 68, 260, 14, 0x111827, 0.9).setOrigin(0).setDepth(2).setStrokeStyle(1, 0x374151);
    this.outbreakFill = this.add.rectangle(17, 69, 1, 12, 0x49ff8c).setOrigin(0).setDepth(3);
    this.outbreakText = this.add.text(284, 75, '', { fontFamily: MONO_UI, fontSize: '14px', color: '#6ee7a0', fontStyle: 'bold' })
      .setOrigin(0, 0.5).setDepth(2);

    // hp + lunge (bottom left)
    const bh = this.scale.height;
    this.hpLabel = this.add.text(16, bh - 58, 'VITALS', { fontFamily: MONO_UI, fontSize: '11px', color: '#6b7280' }).setDepth(2);
    this.hpPips = [];
    for (let i = 0; i < 8; i++) {
      this.hpPips.push(this.add.rectangle(16 + i * 20, bh - 40, 14, 14, 0x49ff8c).setOrigin(0).setDepth(2));
    }
    this.add.text(16, bh - 20, 'LUNGE', { fontFamily: MONO_UI, fontSize: '11px', color: '#6b7280' }).setDepth(2);
    this.add.rectangle(70, bh - 20, 100, 8, 0x111827, 0.9).setOrigin(0, 0).setDepth(2).setStrokeStyle(1, 0x374151);
    this.lungeFill = this.add.rectangle(71, bh - 19, 98, 6, 0xd8c877).setOrigin(0).setDepth(3);

    // horde stats (bottom right)
    this.statText = this.add.text(this.scale.width - 16, bh - 32, '', {
      fontFamily: MONO_UI, fontSize: '13px', color: '#9ca3af', align: 'right',
    }).setOrigin(1, 0.5).setDepth(2);

    // center stinger
    this.stinger = this.add.text(W / 2, this.scale.height * 0.34, '', {
      fontFamily: MONO_UI, fontSize: '44px', color: '#ff5b5b', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setDepth(5);

    // level intro card
    this.introTitle = this.add.text(W / 2, this.scale.height * 0.42, '', {
      fontFamily: MONO_UI, fontSize: '30px', color: '#e5e7eb', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setDepth(5);
    this.introSub = this.add.text(W / 2, this.scale.height * 0.50, '', {
      fontFamily: MONO_UI, fontSize: '17px', color: '#6ee7a0', fontStyle: 'italic',
    }).setOrigin(0.5).setAlpha(0).setDepth(5);

    // hunt arrow: points at the last remaining humans so the endgame never stalls
    this.huntArrow = this.add.image(0, 0, 'arrow').setDepth(4).setVisible(false);
    this.tweens.add({ targets: this.huntArrow, alpha: 0.45, duration: 450, yoyo: true, repeat: -1 });

    // damage flash
    this.flash = this.add.rectangle(0, 0, W, this.scale.height, 0xff2222, 0.28)
      .setOrigin(0).setDepth(9).setAlpha(0);

    // control hint, fades out
    this.hint = this.add.text(W / 2, bh - 24, 'WASD move · SPACE lunge', {
      fontFamily: MONO_UI, fontSize: '14px', color: '#4b5563',
    }).setOrigin(0.5).setDepth(2);
    this.tweens.add({ targets: this.hint, alpha: 0, delay: 9000, duration: 1500 });
  }

  update(time, delta) {
    const gs = this.scene.get('game');
    // groups lose their children mid scene-transition; skip the frame rather than crash
    if (!gs || !gs.player || !gs.civs || !gs.civs.children || !gs.player.body) return;

    // drain the game's message queue
    while (gs.uiQueue && gs.uiQueue.length) {
      const msg = gs.uiQueue.shift();
      if (msg.type === 'headline') {
        this.headlineTarget = msg.text;
        this.headlineShown = 0;
      } else if (msg.type === 'stinger') {
        this.showStinger(msg.text);
      } else if (msg.type === 'flash') {
        this.flash.setAlpha(0.35);
        this.tweens.add({ targets: this.flash, alpha: 0, duration: 300 });
      } else if (msg.type === 'level') {
        this.levelText.setText(msg.name);
        this.showIntro(msg.name, msg.intro);
      }
    }

    // typewriter headline
    if (this.headlineShown < this.headlineTarget.length) {
      this.headlineShown = Math.min(this.headlineTarget.length, this.headlineShown + delta * 0.05);
      this.headlineText.setText(this.headlineTarget.slice(0, Math.floor(this.headlineShown)) + '▌');
    } else if (this.headlineText.text.endsWith('▌')) {
      this.headlineText.setText(this.headlineTarget);
    }

    // meters
    const pct = Phaser.Math.Clamp(gs.outbreak, 0, 1);
    this.outbreakFill.width = Math.max(1, 258 * pct);
    this.outbreakFill.fillColor = pct < 0.5 ? 0x49ff8c : (pct < 0.85 ? 0xd8c877 : 0xff5b5b);
    this.outbreakText.setText(`${Math.round(pct * 100)}% OVERRUN`);

    for (let i = 0; i < this.hpPips.length; i++) {
      const pip = this.hpPips[i];
      if (i >= gs.player.maxHp) { pip.setVisible(false); continue; }
      pip.setVisible(true);
      pip.fillColor = i < gs.player.hp ? 0x49ff8c : 0x1f2937;
    }
    this.lungeFill.width = Math.max(1, 98 * (1 - (gs.lungeCooldown || 0)));

    this.statText.setText(
      `HORDE ${gs.zombies.countActive(true)}   ·   RESPONDERS ${gs.cops.countActive(true)}   ·   SURVIVORS ${Math.max(0, gs.aliveCivs)}`
    );

    this.updateHuntArrow(gs);
  }

  // When few humans remain, point at the nearest one (red = armed responder)
  updateHuntArrow(gs) {
    const copsN = gs.cops.countActive(true);
    const remaining = Math.max(0, gs.aliveCivs) + copsN;
    let best = null, bestD = Infinity, bestIsCop = false;
    if (!gs.over && remaining > 0 && remaining <= 8) {
      const scan = (grp, isCop) => {
        for (const m of grp.getChildren()) {
          if (!m.active || m.turning) continue;
          const d = Phaser.Math.Distance.Between(m.x, m.y, gs.player.x, gs.player.y);
          if (d < bestD) { bestD = d; best = m; bestIsCop = isCop; }
        }
      };
      scan(gs.civs, false);
      scan(gs.cops, true);
    }
    if (best && bestD > 300) {
      const cam = gs.cameras.main;
      const sx = (gs.player.x - cam.worldView.x) * cam.zoom;
      const sy = (gs.player.y - cam.worldView.y) * cam.zoom;
      const a = Phaser.Math.Angle.Between(gs.player.x, gs.player.y, best.x, best.y);
      this.huntArrow.setPosition(sx + Math.cos(a) * 110, sy + Math.sin(a) * 110)
        .setRotation(a)
        .setTint(bestIsCop ? 0xff8080 : 0xffd980)
        .setVisible(true);
    } else {
      this.huntArrow.setVisible(false);
    }
  }

  showStinger(text) {
    this.stinger.setText(text).setAlpha(0).setScale(1.4);
    this.tweens.add({ targets: this.stinger, alpha: 1, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.stinger, alpha: 0, delay: 1600, duration: 500 });
    this.cameras.main.shake(100, 0.002);
  }

  showIntro(name, sub) {
    this.introTitle.setText(name).setAlpha(0);
    this.introSub.setText(sub).setAlpha(0);
    this.tweens.add({ targets: [this.introTitle, this.introSub], alpha: 1, duration: 500 });
    this.tweens.add({ targets: [this.introTitle, this.introSub], alpha: 0, delay: 2600, duration: 600 });
  }
}
