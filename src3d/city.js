// Procedural 3D city: sidewalked blocks, extruded buildings with lit windows,
// parks with trees and ponds, parked cars, glowing streetlights.
// Returns collision AABBs (on the XZ plane) and spawn helpers.
import * as THREE from 'three';
import { box, mat } from './models.js';
import { BLOCK, STREET, CELL } from './levels.js';

const ROOF_SHADES = [0x2a2e3c, 0x33302c, 0x2c3438, 0x322c38, 0x2e3230];
const CAR_COLORS = [0x8a4a42, 0x46687a, 0x6b6f75, 0x7a6a4a, 0x4a5a7a];

export function buildCity(scene, cfg) {
  const cols = cfg.cols, rows = cfg.rows;
  const W = STREET + cols * CELL;
  const H = STREET + rows * CELL;
  const group = new THREE.Group();
  scene.add(group);

  const blockers = [];   // { x, z, hw, hh } AABBs on XZ (half extents)
  const lights = [];     // streetlight positions for glow sprites

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 40, H + 40),
    new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -0.02, H / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // road markings (thin emissive-ish strips) via a merged plane grid
  const laneMat = new THREE.MeshStandardMaterial({ color: 0x2c333f, roughness: 1 });
  for (let r = 0; r <= rows; r++) {
    const z = STREET / 2 + r * CELL;
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.35), laneMat);
    lane.rotation.x = -Math.PI / 2; lane.position.set(W / 2, 0.01, z); group.add(lane);
  }
  for (let c = 0; c <= cols; c++) {
    const x = STREET / 2 + c * CELL;
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.35, H), laneMat);
    lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.01, H / 2); group.add(lane);
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x232933, roughness: 1 });

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bx = STREET + cx * CELL + BLOCK / 2;   // block center X
      const bz = STREET + cy * CELL + BLOCK / 2;   // block center Z

      // sidewalk apron
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 2.6, BLOCK + 2.6), sidewalkMat);
      sw.rotation.x = -Math.PI / 2; sw.position.set(bx, 0.005, bz); sw.receiveShadow = true; group.add(sw);

      if (Math.random() < cfg.parkChance) {
        park(group, bx, bz);
      } else {
        building(group, bx, bz, blockers);
      }

      // parked cars along a random curb
      if (Math.random() < 0.6) car(group, bx, bz, blockers);
    }
  }

  // streetlights at intersections
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (Math.random() < 0.5) continue;
      const x = STREET / 2 + c * CELL + 1.2, z = STREET / 2 + r * CELL + 1.2;
      streetlight(group, x, z, lights);
    }
  }

  function insideBlocked(x, z, pad = 0.5) {
    for (const b of blockers) {
      if (Math.abs(x - b.x) < b.hw + pad && Math.abs(z - b.z) < b.hh + pad) return true;
    }
    return false;
  }
  function inBounds(x, z) { return x > 1 && z > 1 && x < W - 1 && z < H - 1; }

  function randomStreetPoint() {
    for (let i = 0; i < 80; i++) {
      const x = 1 + Math.random() * (W - 2), z = 1 + Math.random() * (H - 2);
      if (!insideBlocked(x, z, 0.8)) return { x, z };
    }
    return { x: STREET / 2, z: STREET / 2 };
  }
  function streetPointNear(px, pz, minD, maxD) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = THREE.MathUtils.clamp(px + Math.cos(a) * d, 1, W - 1);
      const z = THREE.MathUtils.clamp(pz + Math.sin(a) * d, 1, H - 1);
      if (!insideBlocked(x, z, 0.8)) return { x, z };
    }
    return randomStreetPoint();
  }

  // Resolve a circle (radius rad) at (x,z) out of any building/car AABB.
  function collide(x, z, rad) {
    for (const b of blockers) {
      const dx = x - b.x, dz = z - b.z;
      const ox = b.hw + rad - Math.abs(dx);
      const oz = b.hh + rad - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) x += dx > 0 ? ox : -ox;
        else z += dz > 0 ? oz : -oz;
      }
    }
    x = THREE.MathUtils.clamp(x, 0.6, W - 0.6);
    z = THREE.MathUtils.clamp(z, 0.6, H - 0.6);
    return { x, z };
  }
  function blockedSegment(x, z) { return insideBlocked(x, z, 0); }

  return { group, W, H, blockers, lights, randomStreetPoint, streetPointNear, collide, inBounds, blockedSegment };
}

function building(group, cx, cz, blockers) {
  const w = BLOCK - (1 + Math.random() * 2);
  const d = BLOCK - (1 + Math.random() * 2);
  const h = 3 + Math.random() * 8;
  const color = ROOF_SHADES[(Math.random() * ROOF_SHADES.length) | 0];
  const b = box(w, h, d, color, { receive: true });
  b.position.set(cx, h / 2, cz);
  group.add(b);

  // lit windows: small emissive quads on the four faces
  const winMat = new THREE.MeshStandardMaterial({ color: 0xe3c987, emissive: 0xe3c987, emissiveIntensity: 1.6, roughness: 0.6 });
  const darkWin = new THREE.MeshStandardMaterial({ color: 0x12151c, roughness: 0.8 });
  const rowsY = Math.max(1, Math.floor(h / 1.4));
  const perRow = Math.max(1, Math.floor(w / 1.3));
  for (let fy = 0; fy < rowsY; fy++) {
    const yy = 0.9 + fy * 1.4;
    if (yy > h - 0.4) break;
    for (let fx = 0; fx < perRow; fx++) {
      const lit = Math.random() < 0.28;
      const m = lit ? winMat : darkWin;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), m);
      const xx = -w / 2 + 0.9 + fx * 1.3;
      // front (+z) and back (-z)
      const q1 = q.clone(); q1.position.set(cx + xx, yy, cz + d / 2 + 0.02); group.add(q1);
      if (Math.random() < 0.6) { const q2 = q.clone(); q2.rotation.y = Math.PI; q2.position.set(cx - xx, yy, cz - d / 2 - 0.02); group.add(q2); }
    }
  }
  // roof prop
  if (Math.random() < 0.7) {
    const ac = box(0.9, 0.6, 0.9, 0x59606c, {}); ac.position.set(cx + (Math.random() - 0.5) * (w - 2), h + 0.3, cz + (Math.random() - 0.5) * (d - 2)); group.add(ac);
  }
  blockers.push({ x: cx, z: cz, hw: w / 2, hh: d / 2 });
}

function park(group, cx, cz) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), mat(0x1d3322, 0x000000, 1, 1));
  grass.rotation.x = -Math.PI / 2; grass.position.set(cx, 0.02, cz); grass.receiveShadow = true; group.add(grass);
  if (Math.random() < 0.6) {
    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), new THREE.MeshStandardMaterial({ color: 0x1e3947, roughness: 0.3, metalness: 0.4 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(cx + (Math.random() - 0.5) * 3, 0.03, cz + (Math.random() - 0.5) * 3); group.add(pond);
  }
  for (let i = 0; i < 6; i++) {
    const tx = cx + (Math.random() - 0.5) * (BLOCK - 2), tz = cz + (Math.random() - 0.5) * (BLOCK - 2);
    const trunk = box(0.3, 1, 0.3, 0x4a3320, {}); trunk.position.set(tx, 0.5, tz); group.add(trunk);
    const foliage = box(1.4, 1.4, 1.4, 0x2c4a2e, {}); foliage.position.set(tx, 1.6, tz); group.add(foliage);
    const top = box(0.9, 0.9, 0.9, 0x3a5e3a, {}); top.position.set(tx, 2.3, tz); group.add(top);
  }
}

function car(group, cx, cz, blockers) {
  const horiz = Math.random() < 0.5;
  const along = (Math.random() - 0.5) * (BLOCK - 3);
  const side = (Math.random() < 0.5 ? 1 : -1) * (BLOCK / 2 + 1.6);
  const x = cx + (horiz ? along : side);
  const z = cz + (horiz ? side : along);
  const L = 3.4, Wd = 1.7;
  const w = horiz ? L : Wd, d = horiz ? Wd : L;
  const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  const body = box(w, 0.7, d, color, {}); body.position.set(x, 0.45, z); group.add(body);
  const cab = box(horiz ? 1.6 : 1.1, 0.5, horiz ? 1.1 : 1.6, color, {}); cab.position.set(x, 1.0, z); group.add(cab);
  blockers.push({ x, z, hw: w / 2, hh: d / 2 });
}

function streetlight(group, x, z, lights) {
  const pole = box(0.16, 3.2, 0.16, 0x2b2f36, {}); pole.position.set(x, 1.6, z); group.add(pole);
  const head = box(0.7, 0.18, 0.4, 0x3a3f47, {}); head.position.set(x, 3.2, z + 0.2); group.add(head);
  const bulb = box(0.4, 0.1, 0.28, 0xffe1a1, { emissive: 0xffca7a, emissiveIntensity: 3, cast: false }); bulb.position.set(x, 3.08, z + 0.2); group.add(bulb);
  const pl = new THREE.PointLight(0xffca7a, 8, 9, 2); pl.position.set(x, 3, z + 0.2); group.add(pl);
  lights.push({ x, z });
}
