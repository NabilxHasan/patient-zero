// Procedural night-city generator: sidewalked blocks, detailed roofs, parks,
// parked cars (solid cover), streetlight pools, road markings.
// Returns wall bodies for collision plus helpers for spawn placement.

const ROOF_SHADES = [
  [0x2a2e3c, 0x333849], [0x33302c, 0x3d3a35], [0x2c3438, 0x353f44],
  [0x322c38, 0x3c3544], [0x2e3230, 0x383d3a],
];
const CAR_COLORS = [0x8a4a42, 0x46687a, 0x6b6f75, 0x7a6a4a, 0x4a5a7a, 0x384048];

function buildCity(scene, cfg) {
  const W = cfg.worldW, H = cfg.worldH;
  const BLOCK = 250, STREET = 115;
  const cell = BLOCK + STREET;

  const ground = scene.add.graphics().setDepth(-10);
  ground.fillStyle(0x171b22, 1);
  ground.fillRect(0, 0, W, H);

  // asphalt grime
  for (let i = 0; i < 70; i++) {
    ground.fillStyle(0x000000, 0.05);
    ground.fillCircle(Math.random() * W, Math.random() * H, 6 + Math.random() * 16);
  }

  const cols = Math.floor((W - STREET) / cell);
  const rows = Math.floor((H - STREET) / cell);

  // dashed lane markings along street centers
  ground.fillStyle(0x2e3542, 1);
  for (let r = 0; r <= rows; r++) {
    const y = STREET / 2 + r * cell;
    for (let x = 10; x < W - 20; x += 42) ground.fillRect(x, y - 1.5, 18, 3);
  }
  for (let c = 0; c <= cols; c++) {
    const x = STREET / 2 + c * cell;
    for (let y = 10; y < H - 20; y += 42) ground.fillRect(x - 1.5, y, 3, 18);
  }

  // crosswalks + streetlight pools at intersections
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const ix = STREET / 2 + c * cell, iy = STREET / 2 + r * cell;
      ground.fillStyle(0x39414f, 0.8);
      for (let s = -2; s <= 2; s++) {
        ground.fillRect(ix - 44, iy + s * 9 - 2.5, 12, 5);
        ground.fillRect(ix + 32, iy + s * 9 - 2.5, 12, 5);
        ground.fillRect(ix + s * 9 - 2.5, iy - 44, 5, 12);
        ground.fillRect(ix + s * 9 - 2.5, iy + 32, 5, 12);
      }
      if (Math.random() < 0.45) {
        scene.add.image(ix + 18, iy + 18, 'blob').setTint(0xffca7a).setAlpha(0.11)
          .setScale(2.6).setDepth(-7);
        ground.fillStyle(0x3a3f4a, 1);
        ground.fillCircle(ix + 18, iy + 18, 3);
      }
    }
  }

  const buildGfx = scene.add.graphics().setDepth(5);
  const blockedRects = [];
  const wallBodies = [];

  const addWall = (cx, cy, w, h, pad = 4) => {
    const wall = scene.add.rectangle(cx, cy, w, h);
    wall.setVisible(false);
    scene.physics.add.existing(wall, true);
    wallBodies.push(wall);
    blockedRects.push({ x: cx - w / 2 - pad, y: cy - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 });
  };

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bx = STREET + cx * cell;
      const by = STREET + cy * cell;

      // sidewalk apron around the whole block
      ground.fillStyle(0x232933, 1);
      ground.fillRoundedRect(bx - 16, by - 16, BLOCK + 32, BLOCK + 32, 8);
      ground.fillStyle(0x1d222b, 1);
      ground.fillRoundedRect(bx - 16, by - 16, BLOCK + 32, 3, 2); // curb shading hint

      if (Math.random() < cfg.parkChance) {
        drawPark(ground, bx, by, BLOCK);
      } else {
        drawBuilding(scene, buildGfx, bx, by, BLOCK, addWall);
      }

      // parked cars hugging the block's curb
      if (Math.random() < 0.62) placeCar(scene, ground, bx, by, BLOCK, addWall);
      if (Math.random() < 0.28) placeCar(scene, ground, bx, by, BLOCK, addWall);
    }
  }

  function insideBuilding(x, y, pad = 24) {
    for (const r of blockedRects) {
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    }
    return false;
  }

  function randomStreetPoint(minX = 40, minY = 40, maxX = W - 40, maxY = H - 40) {
    for (let i = 0; i < 60; i++) {
      const x = Phaser.Math.Between(minX, maxX);
      const y = Phaser.Math.Between(minY, maxY);
      if (!insideBuilding(x, y)) return { x, y };
    }
    return { x: STREET / 2 + 20, y: STREET / 2 + 20 };
  }

  function streetPointNear(px, py, minDist, maxDist) {
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = minDist + Math.random() * (maxDist - minDist);
      const x = Phaser.Math.Clamp(px + Math.cos(ang) * d, 40, W - 40);
      const y = Phaser.Math.Clamp(py + Math.sin(ang) * d, 40, H - 40);
      if (!insideBuilding(x, y)) return { x, y };
    }
    return randomStreetPoint();
  }

  return { wallBodies, buildingRects: blockedRects, insideBuilding, randomStreetPoint, streetPointNear, W, H };
}

function drawBuilding(scene, g, bx, by, BLOCK, addWall) {
  const mx = 12 + Math.random() * 24, my = 12 + Math.random() * 24;
  const bw = BLOCK - mx * 2, bh = BLOCK - my * 2;
  const x = bx + mx, y = by + my;
  const [base, lit] = Phaser.Utils.Array.GetRandom(ROOF_SHADES);

  // drop shadow, roof base, bevel
  g.fillStyle(0x0b0d12, 0.9);
  g.fillRoundedRect(x + 6, y + 7, bw, bh, 6);
  g.fillStyle(base, 1);
  g.fillRoundedRect(x, y, bw, bh, 6);
  g.fillStyle(lit, 1);
  g.fillRoundedRect(x + 3, y + 3, bw - 6, bh - 6, 5);
  g.lineStyle(2, 0x454c5e, 0.55);
  g.lineBetween(x + 4, y + 2, x + bw - 4, y + 2);
  g.lineBetween(x + 2, y + 4, x + 2, y + bh - 4);
  g.lineStyle(2, 0x0f1117, 0.8);
  g.lineBetween(x + 4, y + bh - 2, x + bw - 4, y + bh - 2);
  g.lineBetween(x + bw - 2, y + 4, x + bw - 2, y + bh - 4);

  // window grid (some lit with a faint glow)
  for (let wy = y + 16; wy < y + bh - 16; wy += 24) {
    for (let wx = x + 16; wx < x + bw - 16; wx += 24) {
      if (Math.random() < 0.45) continue;
      const isLit = Math.random() < 0.13;
      if (isLit) {
        g.fillStyle(0xffca7a, 0.12); g.fillCircle(wx + 3.5, wy + 3.5, 9);
        g.fillStyle(0xe3c987, 0.95);
      } else {
        g.fillStyle(0x161a23, 1);
      }
      g.fillRect(wx, wy, 7, 7);
    }
  }

  // roof furniture: AC units, vents, skylight, antenna
  const props = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < props; i++) {
    const px = x + 22 + Math.random() * (bw - 50);
    const py = y + 22 + Math.random() * (bh - 50);
    const kind = Math.floor(Math.random() * 4);
    if (kind === 0) {          // AC unit with fan
      g.fillStyle(0x11141b, 0.6); g.fillRect(px + 2, py + 3, 15, 15);
      g.fillStyle(0x59606c, 1); g.fillRect(px, py, 15, 15);
      g.fillStyle(0x3c424c, 1); g.fillCircle(px + 7.5, py + 7.5, 5);
      g.lineStyle(1.4, 0x59606c, 1);
      g.lineBetween(px + 3.5, py + 7.5, px + 11.5, py + 7.5);
      g.lineBetween(px + 7.5, py + 3.5, px + 7.5, py + 11.5);
    } else if (kind === 1) {   // vent slats
      g.fillStyle(0x1d222c, 1);
      for (let s = 0; s < 3; s++) g.fillRect(px, py + s * 5, 13, 2.5);
    } else if (kind === 2) {   // skylight
      g.fillStyle(0x24384a, 1); g.fillRect(px, py, 14, 10);
      g.lineStyle(1.4, 0x3d5a75, 1); g.strokeRect(px, py, 14, 10);
      g.lineBetween(px + 7, py, px + 7, py + 10);
    } else {                   // antenna
      g.fillStyle(0x59606c, 1); g.fillCircle(px, py, 2.5);
      g.lineStyle(1.4, 0x59606c, 1); g.lineBetween(px, py, px + 9, py - 9);
    }
  }

  addWall(x + bw / 2, y + bh / 2, bw, bh);
}

function drawPark(g, bx, by, BLOCK) {
  g.fillStyle(0x1b2a1f, 1);
  g.fillRoundedRect(bx, by, BLOCK, BLOCK, 10);

  // crossing footpaths
  g.fillStyle(0x2b3229, 1);
  g.fillRect(bx, by + BLOCK / 2 - 7, BLOCK, 14);
  g.fillRect(bx + BLOCK / 2 - 7, by, 14, BLOCK);

  // pond in a random quadrant
  if (Math.random() < 0.6) {
    const qx = bx + (Math.random() < 0.5 ? 62 : BLOCK - 62);
    const qy = by + (Math.random() < 0.5 ? 62 : BLOCK - 62);
    g.fillStyle(0x1e3947, 1); g.fillEllipse(qx, qy, 74, 56);
    g.lineStyle(2, 0x2c4f63, 0.9); g.strokeEllipse(qx, qy, 74, 56);
    g.fillStyle(0x2c4f63, 0.5); g.fillEllipse(qx - 8, qy - 6, 30, 18);
  }

  // trees with shadows and highlights
  for (let i = 0; i < 8; i++) {
    const tx = bx + 28 + Math.random() * (BLOCK - 56);
    const ty = by + 28 + Math.random() * (BLOCK - 56);
    const r = 8 + Math.random() * 6;
    g.fillStyle(0x000000, 0.25); g.fillEllipse(tx + 4, ty + 5, r * 2.1, r * 1.4);
    g.fillStyle(0x2c4a2e, 1); g.fillCircle(tx, ty, r);
    g.fillStyle(0x3a5e3a, 1); g.fillCircle(tx - r * 0.25, ty - r * 0.25, r * 0.62);
  }
}

function placeCar(scene, g, bx, by, BLOCK, addWall) {
  const side = Math.floor(Math.random() * 4); // 0 N, 1 S, 2 W, 3 E
  const along = 40 + Math.random() * (BLOCK - 80);
  const gap = 34; // distance from block edge into the street
  let cx, cy, horiz;
  if (side === 0) { cx = bx + along; cy = by - gap; horiz = true; }
  else if (side === 1) { cx = bx + along; cy = by + BLOCK + gap; horiz = true; }
  else if (side === 2) { cx = bx - gap; cy = by + along; horiz = false; }
  else { cx = bx + BLOCK + gap; cy = by + along; horiz = false; }

  const L = 46, Wd = 22;
  const w = horiz ? L : Wd, h = horiz ? Wd : L;
  const color = Phaser.Utils.Array.GetRandom(CAR_COLORS);
  const flip = Math.random() < 0.5 ? 1 : -1;

  // shadow, body, cabin, windshield, lights
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(cx - w / 2 + 3, cy - h / 2 + 4, w, h, 7);
  g.fillStyle(color, 1);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
  g.fillStyle(0x0e1116, 0.35);
  g.fillRoundedRect(cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4, 6);
  g.fillStyle(color, 1);
  const cw = horiz ? 20 : 14, ch = horiz ? 14 : 20;
  g.fillRoundedRect(cx - cw / 2, cy - ch / 2, cw, ch, 4);
  g.fillStyle(0x9fb4c4, 0.55);
  if (horiz) g.fillRect(cx + flip * 11 - 2, cy - 8, 4, 16);
  else g.fillRect(cx - 8, cy + flip * 11 - 2, 16, 4);
  g.fillStyle(0xffe9a8, 0.9);
  if (horiz) { g.fillCircle(cx + flip * (L / 2 - 3), cy - 7, 2); g.fillCircle(cx + flip * (L / 2 - 3), cy + 7, 2); }
  else { g.fillCircle(cx - 7, cy + flip * (L / 2 - 3), 2); g.fillCircle(cx + 7, cy + flip * (L / 2 - 3), 2); }
  g.fillStyle(0xd05050, 0.9);
  if (horiz) { g.fillCircle(cx - flip * (L / 2 - 3), cy - 7, 2); g.fillCircle(cx - flip * (L / 2 - 3), cy + 7, 2); }
  else { g.fillCircle(cx - 7, cy - flip * (L / 2 - 3), 2); g.fillCircle(cx + 7, cy - flip * (L / 2 - 3), 2); }

  addWall(cx, cy, w, h, 2);
}
