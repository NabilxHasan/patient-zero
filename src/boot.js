// Generates every texture procedurally — the game ships with zero image assets.
// Agent sprites are drawn top-down facing +x at 2x size (52px) and displayed at 0.5 scale.

// Civilian outfit variants, picked at random per spawn.
const CIV_PALETTES = {
  civA: { shirt: 0xc97b52, shirtDark: 0xa05e3c, skin: 0xf0cfa8, hair: 0x3a2a1a },
  civB: { shirt: 0x5f8fc9, shirtDark: 0x486fa0, skin: 0xe8c39a, hair: 0x1f1f24 },
  civC: { shirt: 0xaab35f, shirtDark: 0x87904a, skin: 0x8d5a3a, hair: 0x14100c },
  civD: { shirt: 0xc47d9e, shirtDark: 0x9c5f7c, skin: 0xf2d9b8, hair: 0x6b4a2a },
  civE: { shirt: 0x8a7ad8, shirtDark: 0x6b5cb0, skin: 0xd9b08c, hair: 0x2a1a10 },
};
const CIV_KEYS = Object.keys(CIV_PALETTES);

class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  create() {
    const g = this.make.graphics({ add: false });

    // ---------- tiny utility textures ----------
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture('px', 4, 4);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, 10, 4, 2);
    g.generateTexture('bullet', 10, 4);
    g.clear();

    for (let i = 10; i > 0; i--) {
      g.fillStyle(0xffffff, (i / 10) * 0.10);
      g.fillCircle(28, 28, i * 2.8);
    }
    g.generateTexture('blob', 56, 56);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillCircle(13, 13, 8);
    g.fillCircle(22, 10, 4);
    g.fillCircle(7, 21, 3);
    g.fillCircle(23, 21, 3);
    g.fillCircle(16, 4, 2);
    g.generateTexture('splat', 30, 30);
    g.clear();

    // hunt-arrow pointer
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(0, 0, 22, 9, 0, 18);
    g.generateTexture('arrow', 22, 18);
    g.clear();

    // ---------- character sprites ----------
    for (const key of CIV_KEYS) {
      this.drawCiv(g, key, CIV_PALETTES[key], 0);
      this.drawCiv(g, key, CIV_PALETTES[key], 1);
    }
    this.drawZombie(g, 0); this.drawZombie(g, 1);
    this.drawPolice(g, 0); this.drawPolice(g, 1);
    this.drawMilitary(g, 0); this.drawMilitary(g, 1);
    this.drawPlayer(g, 0); this.drawPlayer(g, 1);

    g.destroy();

    // ---------- vignette (canvas radial gradient) ----------
    const vig = this.textures.createCanvas('vignette', 512, 512);
    const ctx = vig.context;
    const grd = ctx.createRadialGradient(256, 256, 150, 256, 256, 370);
    grd.addColorStop(0, 'rgba(4,6,12,0)');
    grd.addColorStop(1, 'rgba(4,6,12,0.62)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 512, 512);
    vig.refresh();

    this.scene.start('menu');
  }

  shadow(g, x = 26, y = 30) {
    g.fillStyle(0x000000, 0.30);
    g.fillEllipse(x, y, 34, 20);
  }

  drawCiv(g, key, p, frame) {
    this.shadow(g);
    // torso with shading, shoulders spanning y
    g.fillStyle(p.shirtDark, 1); g.fillEllipse(25, 26, 20, 27);
    g.fillStyle(p.shirt, 1); g.fillEllipse(27, 26, 17, 23);
    // swinging hands
    g.fillStyle(p.skin, 1);
    if (frame === 0) { g.fillCircle(31, 11, 4); g.fillCircle(22, 41, 4); }
    else { g.fillCircle(22, 11, 4); g.fillCircle(31, 41, 4); }
    // head: hair mass with face peeking toward facing
    g.fillStyle(p.hair, 1); g.fillCircle(25.5, 26, 7.5);
    g.fillStyle(p.skin, 1); g.fillCircle(29.5, 26, 5);
    g.generateTexture(`${key}_${frame}`, 52, 52);
    g.clear();
  }

  drawZombie(g, frame) {
    this.shadow(g, 25);
    // hunched, ragged torso
    g.fillStyle(0x39452f, 1); g.fillEllipse(23, 26, 19, 25);
    g.fillStyle(0x475738, 1); g.fillEllipse(25, 26, 16, 21);
    // arms reaching forward, swaying per frame
    const aOff = frame === 0 ? 0 : 2;
    g.fillStyle(0x86b06a, 1);
    g.fillEllipse(34, 18 + aOff, 15, 6); g.fillCircle(41, 18 + aOff, 3.5);
    g.fillEllipse(34, 34 - aOff, 15, 6); g.fillCircle(41, 34 - aOff, 3.5);
    // head leaning forward, wound, glowing eyes
    g.fillStyle(0x86b06a, 1); g.fillCircle(30, 26, 7);
    g.fillStyle(0x7a2020, 1); g.fillCircle(27.5, 22.5, 2.2);
    g.fillStyle(0x6e1d1d, 1); g.fillCircle(21, 30, 2.5);
    g.fillStyle(0xc7ff5e, 1); g.fillCircle(34, 23.5, 1.6); g.fillCircle(34, 28.5, 1.6);
    g.generateTexture(`zombie_${frame}`, 52, 52);
    g.clear();
  }

  drawPolice(g, frame) {
    this.shadow(g);
    const hOff = frame === 0 ? 0 : 1;
    g.fillStyle(0x2c4585, 1); g.fillEllipse(25, 26, 20, 27);
    g.fillStyle(0x3a57a5, 1); g.fillEllipse(26.5, 26, 17, 23);
    // two-handed pistol stance
    g.fillStyle(0xe8c39a, 1); g.fillCircle(33 + hOff, 21, 4); g.fillCircle(34 + hOff, 30, 4);
    g.fillStyle(0x22262c, 1); g.fillRoundedRect(33 + hOff, 24, 12, 4, 2);
    // cap with front brim
    g.fillStyle(0x1a2952, 1); g.fillEllipse(29.5, 26, 8, 12);
    g.fillStyle(0x223468, 1); g.fillCircle(24.5, 26, 7.2);
    g.fillStyle(0xd9c26a, 1); g.fillCircle(22, 21, 1.6);
    g.generateTexture(`police_${frame}`, 52, 52);
    g.clear();
  }

  drawMilitary(g, frame) {
    this.shadow(g);
    const hOff = frame === 0 ? 0 : 1;
    // shoulder plates
    g.fillStyle(0x3c4828, 1); g.fillRoundedRect(17, 12, 10, 9, 3); g.fillRoundedRect(17, 31, 10, 9, 3);
    g.fillStyle(0x4c5b32, 1); g.fillEllipse(25, 26, 20, 27);
    g.fillStyle(0x5d7040, 1); g.fillEllipse(26.5, 26, 17, 23);
    // rifle with stock and mag, gripped in both hands
    g.fillStyle(0x24261f, 1);
    g.fillRoundedRect(28, 24, 22, 4, 2);
    g.fillRect(36, 28, 4, 6);
    g.fillStyle(0xc9a27e, 1); g.fillCircle(33 + hOff, 21, 4); g.fillCircle(40 + hOff, 29, 3.6);
    // helmet
    g.fillStyle(0x5d7040, 1); g.fillCircle(25, 26, 8);
    g.lineStyle(1.6, 0x748952, 1); g.strokeCircle(25, 26, 8);
    g.generateTexture(`military_${frame}`, 52, 52);
    g.clear();
  }

  drawPlayer(g, frame) {
    // 60px canvas — patient zero is bigger and unmistakable
    g.fillStyle(0x000000, 0.30); g.fillEllipse(30, 35, 40, 22);
    g.fillStyle(0x1d4a30, 0.55); g.fillEllipse(28, 30, 36, 42);
    g.fillStyle(0x2e7a4c, 1); g.fillEllipse(28, 30, 24, 31);
    g.fillStyle(0x3fae66, 1); g.fillEllipse(30, 30, 20, 26);
    // clawed arms, swaying
    const cOff = frame === 0 ? 0 : 3;
    g.fillStyle(0x35d977, 1);
    g.fillEllipse(38, 19 + cOff, 14, 6);
    g.fillEllipse(38, 41 - cOff, 14, 6);
    g.fillTriangle(43, 16 + cOff, 51, 19 + cOff, 43, 22 + cOff);
    g.fillTriangle(43, 38 - cOff, 51, 41 - cOff, 43, 44 - cOff);
    // glowing core and veins
    g.lineStyle(1.5, 0x9fffc4, 0.9);
    g.lineBetween(30, 30, 36, 22); g.lineBetween(30, 30, 23, 37); g.lineBetween(30, 30, 25, 22);
    g.fillStyle(0x53ff7a, 0.5); g.fillCircle(30, 30, 8);
    g.fillStyle(0xd9ffe6, 1); g.fillCircle(30, 30, 4.5);
    // head with burning eyes
    g.fillStyle(0x2a5c3c, 1); g.fillCircle(36, 30, 8);
    g.fillStyle(0xeaffea, 1); g.fillCircle(40, 26.5, 2); g.fillCircle(40, 33.5, 2);
    g.generateTexture(`player_${frame}`, 60, 60);
    g.clear();
  }
}
