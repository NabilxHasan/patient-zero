// Win / lose / final victory screens.
class EndScene extends Phaser.Scene {
  constructor() { super('end'); }

  init(data) { this.data_ = data; }

  create() {
    const { win, level, seconds, infected, final } = this.data_;
    const W = this.scale.width, H = this.scale.height;
    const MONO = 'Consolas, "Courier New", monospace';

    this.add.rectangle(0, 0, W, H, 0x07090c).setOrigin(0);

    for (let i = 0; i < 10; i++) {
      const b = this.add.image(Math.random() * W, Math.random() * H, 'blob')
        .setTint(win ? 0x1d5a34 : 0x5a1d1d).setAlpha(0.12).setScale(2 + Math.random() * 4);
      this.tweens.add({
        targets: b, alpha: 0.04, scale: b.scale * 1.3,
        duration: 4000 + Math.random() * 3000, yoyo: true, repeat: -1,
      });
    }

    let title, sub, color;
    if (final) {
      title = 'THE OUTBREAK HAS BEGUN';
      sub = 'Three districts have fallen. What you kicked off\ncan no longer be stopped. The city was only the beginning.';
      color = '#49ff8c';
    } else if (win) {
      title = 'DISTRICT FALLEN';
      sub = 'The infection spreads to the next district.';
      color = '#49ff8c';
    } else {
      title = 'PATIENT ZERO CONTAINED';
      sub = 'The outbreak died with you.\nThe city wakes up tomorrow and never knows how close it came.';
      color = '#ff5b5b';
    }

    const t = this.add.text(W / 2, H * 0.30, title, {
      fontFamily: MONO, fontSize: '54px', fontStyle: 'bold', color,
    }).setOrigin(0.5);
    t.setShadow(0, 0, win ? '#1a7a44' : '#7a1a1a', 20, false, true);

    this.add.text(W / 2, H * 0.44, sub, {
      fontFamily: MONO, fontSize: '18px', color: '#9ca3af', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);

    // stats
    const grade = seconds < 90 ? 'S' : seconds < 150 ? 'A' : seconds < 240 ? 'B' : 'C';
    this.add.text(W / 2, H * 0.58,
      `TIME  ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}      ` +
      `INFECTED  ${infected}      RATING  ${win ? grade : '—'}`, {
      fontFamily: MONO, fontSize: '18px', color: '#6ee7a0',
    }).setOrigin(0.5);

    // buttons
    const mkButton = (y, label, cb) => {
      const btn = this.add.text(W / 2, y, `[ ${label} ]`, {
        fontFamily: MONO, fontSize: '24px', color: '#e5e7eb',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#49ff8c'));
      btn.on('pointerout', () => btn.setColor('#e5e7eb'));
      btn.on('pointerdown', () => { AudioFX.click(); cb(); });
      return btn;
    };

    if (final) {
      mkButton(H * 0.74, 'PLAY AGAIN', () => this.scene.start('game', { level: 0 }));
      mkButton(H * 0.84, 'MAIN MENU', () => this.scene.start('menu'));
    } else if (win) {
      const next = mkButton(H * 0.74, 'NEXT DISTRICT →', () => this.scene.start('game', { level: level + 1 }));
      this.tweens.add({ targets: next, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
      mkButton(H * 0.84, 'MAIN MENU', () => this.scene.start('menu'));
    } else {
      const retry = mkButton(H * 0.74, 'TRY AGAIN', () => this.scene.start('game', { level }));
      this.tweens.add({ targets: retry, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
      mkButton(H * 0.84, 'MAIN MENU', () => this.scene.start('menu'));
    }

    this.cameras.main.fadeIn(400, 0, 0, 0);
  }
}
