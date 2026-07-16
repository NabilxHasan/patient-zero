// Title screen. First click also unlocks the WebAudio context.
class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const MONO = 'Consolas, "Courier New", monospace';

    this.add.rectangle(0, 0, W, H, 0x07090c).setOrigin(0);

    // ambient drifting "infection" blobs
    for (let i = 0; i < 14; i++) {
      const b = this.add.image(Math.random() * W, Math.random() * H, 'blob')
        .setTint(0x1d5a34).setAlpha(0.10 + Math.random() * 0.12)
        .setScale(2 + Math.random() * 5);
      this.tweens.add({
        targets: b,
        x: b.x + (Math.random() * 300 - 150),
        y: b.y + (Math.random() * 300 - 150),
        alpha: 0.05,
        duration: 6000 + Math.random() * 6000,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // zombies shambling across the title screen
    for (let i = 0; i < 5; i++) {
      const z = this.add.image(-60 - Math.random() * 500, H * (0.62 + Math.random() * 0.33), 'zombie_0')
        .setScale(0.7).setAlpha(0.85);
      const dur = 26000 + Math.random() * 18000;
      this.tweens.add({ targets: z, x: W + 60, duration: dur, repeat: -1, delay: Math.random() * 4000 });
      this.time.addEvent({
        delay: 260 + Math.random() * 60, loop: true,
        callback: () => z.setTexture(z.texture.key === 'zombie_0' ? 'zombie_1' : 'zombie_0'),
      });
    }

    this.add.text(W / 2, H * 0.16, 'IUT 12th ICT FEST 2026 · GAMEJAM · THEME: KICKOFF', {
      fontFamily: MONO, fontSize: '14px', color: '#4b5563', letterSpacing: 2,
    }).setOrigin(0.5);

    const title = this.add.text(W / 2, H * 0.32, 'PATIENT ZERO', {
      fontFamily: MONO, fontSize: '84px', fontStyle: 'bold', color: '#49ff8c',
    }).setOrigin(0.5);
    title.setShadow(0, 0, '#1a7a44', 24, false, true);

    // occasional glitch jitter on the title
    this.time.addEvent({
      delay: 2200, loop: true, callback: () => {
        this.tweens.add({ targets: title, x: W / 2 + 6, duration: 40, yoyo: true, repeat: 3 });
      },
    });

    this.add.text(W / 2, H * 0.43, 'Every outbreak has a kickoff.', {
      fontFamily: MONO, fontSize: '22px', color: '#9ca3af', fontStyle: 'italic',
    }).setOrigin(0.5);

    this.add.text(W / 2, H * 0.58,
      'You are the first infected. Touch civilians to spread the plague.\n' +
      'Every victim rises and hunts. The city will send police — then the army.\n' +
      'Overrun all three districts. If YOU fall, the outbreak dies with you.', {
      fontFamily: MONO, fontSize: '16px', color: '#6ee7a0', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);

    this.add.text(W / 2, H * 0.73, 'WASD / ARROWS — move      SPACE — lunge      M — mute      R — restart district', {
      fontFamily: MONO, fontSize: '15px', color: '#6b7280',
    }).setOrigin(0.5);

    const start = this.add.text(W / 2, H * 0.85, '[ CLICK TO BEGIN THE OUTBREAK ]', {
      fontFamily: MONO, fontSize: '24px', color: '#e5e7eb',
    }).setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });

    this.input.once('pointerdown', () => {
      AudioFX.resume();
      AudioFX.click();
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.time.delayedCall(420, () => this.scene.start('game', { level: 0 }));
    });
  }
}
