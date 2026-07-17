// Procedural 3D city: district-styled blocks, extruded buildings with lit
// windows, parks with real animated water and breakable trees, pushable street
// props, parked cars, streetlights, and a quarantine border with watchtowers.
import * as THREE from 'three';
import { box, mat, makeTree, makeProp, makeBorderWall, groundGlow } from './models.js';
import { BLOCK, STREET, CELL } from './levels.js';

const CAR_COLORS = [0x8a4a42, 0x46687a, 0x6b6f75, 0x7a6a4a, 0x4a5a7a];

// ---- animated water ----
// Built on a subdivided plane (not a circle fan — radial triangles make the
// wave displacement streak out from the centre) and masked to a disc in the
// fragment shader.
const WATER_VS = `
uniform float uTime;
varying float vWave;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float w = sin(p.x * 1.4 + uTime * 1.7) * 0.07
          + sin(p.y * 1.9 - uTime * 1.3) * 0.05
          + sin((p.x + p.y) * 2.6 + uTime * 2.2) * 0.03;
  p.z += w;
  vWave = w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const WATER_FS = `
varying float vWave;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5);
  if (d > 0.5) discard;                       // disc mask
  vec3 deep = vec3(0.03, 0.08, 0.13);
  vec3 shallow = vec3(0.08, 0.20, 0.28);
  float m = smoothstep(-0.09, 0.09, vWave);
  vec3 c = mix(deep, shallow, m);
  c += vec3(0.16, 0.24, 0.30) * pow(max(m, 0.0), 5.0);   // subtle crest sheen
  float edge = smoothstep(0.5, 0.44, d);                 // soften the rim
  gl_FragColor = vec4(c, 0.90 * edge);
}`;

function makeWater(r) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2, r * 2, 28, 28),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: WATER_VS, fragmentShader: WATER_FS,
      transparent: true,
    })
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function buildCity(scene, cfg) {
  const cols = cfg.cols, rows = cfg.rows;
  const W = STREET + cols * CELL;
  const H = STREET + rows * CELL;
  const group = new THREE.Group();
  scene.add(group);

  const pal = cfg.palette;
  const blockers = [];
  const trees = [];
  const props = [];
  const waters = [];
  const spots = [];   // rotating searchlights on watchtowers

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 60, H + 60),
    new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -0.02, H / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // lane markings
  const laneMat = new THREE.MeshStandardMaterial({ color: 0x2c333f, roughness: 1 });
  for (let r = 0; r <= rows; r++) {
    const z = STREET / 2 + r * CELL;
    const l = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.35), laneMat);
    l.rotation.x = -Math.PI / 2; l.position.set(W / 2, 0.01, z); group.add(l);
  }
  for (let c = 0; c <= cols; c++) {
    const x = STREET / 2 + c * CELL;
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.35, H), laneMat);
    l.rotation.x = -Math.PI / 2; l.position.set(x, 0.01, H / 2); group.add(l);
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x232933, roughness: 1 });

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bx = STREET + cx * CELL + BLOCK / 2;
      const bz = STREET + cy * CELL + BLOCK / 2;

      const sw = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 2.6, BLOCK + 2.6), sidewalkMat);
      sw.rotation.x = -Math.PI / 2; sw.position.set(bx, 0.005, bz); sw.receiveShadow = true; group.add(sw);

      if (Math.random() < cfg.parkChance) park(group, bx, bz, cfg, trees, waters);
      else building(group, bx, bz, blockers, cfg);

      if (Math.random() < 0.55) car(group, bx, bz, blockers);
    }
  }

  // streetlights
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (Math.random() < 0.5) continue;
      streetlight(group, STREET / 2 + c * CELL + 1.2, STREET / 2 + r * CELL + 1.2);
    }
  }

  // pushable street props
  for (let i = 0; i < (cfg.props || 0); i++) {
    const p = randomStreetPointRaw();
    const g = makeProp(Math.random() < 0.5 ? 'bin' : 'crate');
    g.position.set(p.x, 0, p.z);
    group.add(g);
    props.push({ mesh: g, x: p.x, z: p.z, vx: 0, vz: 0, spin: 0 });
  }

  // ---- quarantine border + watchtowers ----
  border(group, W, H, spots);

  function insideBlocked(x, z, pad = 0.5) {
    for (const b of blockers) {
      if (Math.abs(x - b.x) < b.hw + pad && Math.abs(z - b.z) < b.hh + pad) return true;
    }
    return false;
  }
  function randomStreetPointRaw() {
    for (let i = 0; i < 80; i++) {
      const x = 2 + Math.random() * (W - 4), z = 2 + Math.random() * (H - 4);
      if (!insideBlocked(x, z, 0.9)) return { x, z };
    }
    return { x: STREET / 2, z: STREET / 2 };
  }
  function streetPointNear(px, pz, minD, maxD) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = THREE.MathUtils.clamp(px + Math.cos(a) * d, 2, W - 2);
      const z = THREE.MathUtils.clamp(pz + Math.sin(a) * d, 2, H - 2);
      if (!insideBlocked(x, z, 0.9)) return { x, z };
    }
    return randomStreetPointRaw();
  }
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
    x = THREE.MathUtils.clamp(x, 1.0, W - 1.0);
    z = THREE.MathUtils.clamp(z, 1.0, H - 1.0);
    return { x, z };
  }
  function blockedSegment(x, z) { return insideBlocked(x, z, 0); }

  function tick(dt, t) {
    for (const w of waters) w.uniforms.uTime.value = t;
    for (const s of spots) { s.pivot.rotation.y += dt * s.speed; }
  }

  return {
    group, W, H, blockers, trees, props, tick,
    randomStreetPoint: randomStreetPointRaw, streetPointNear, collide, blockedSegment,
  };
}

function building(group, cx, cz, blockers, cfg) {
  const w = BLOCK - (1 + Math.random() * 2);
  const d = BLOCK - (1 + Math.random() * 2);
  const [hMin, hMax] = cfg.buildingH;
  const h = hMin + Math.random() * (hMax - hMin);
  const roofs = cfg.palette.roofs;
  const color = roofs[(Math.random() * roofs.length) | 0];
  const b = box(w, h, d, color, { receive: true });
  b.position.set(cx, h / 2, cz);
  group.add(b);

  const winMat = new THREE.MeshStandardMaterial({ color: 0xe3c987, emissive: 0xe3c987, emissiveIntensity: 1.6, roughness: 0.6 });
  const darkWin = new THREE.MeshStandardMaterial({ color: 0x12151c, roughness: 0.8 });
  const rowsY = Math.max(1, Math.floor(h / 1.4));
  const perRow = Math.max(1, Math.floor(w / 1.3));
  for (let fy = 0; fy < rowsY; fy++) {
    const yy = 0.9 + fy * 1.4;
    if (yy > h - 0.4) break;
    for (let fx = 0; fx < perRow; fx++) {
      const lit = Math.random() < 0.28;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), lit ? winMat : darkWin);
      const xx = -w / 2 + 0.9 + fx * 1.3;
      const q1 = q.clone(); q1.position.set(cx + xx, yy, cz + d / 2 + 0.02); group.add(q1);
      if (Math.random() < 0.6) { const q2 = q.clone(); q2.rotation.y = Math.PI; q2.position.set(cx - xx, yy, cz - d / 2 - 0.02); group.add(q2); }
    }
  }
  if (Math.random() < 0.7) {
    const ac = box(0.9, 0.6, 0.9, 0x59606c, {});
    ac.position.set(cx + (Math.random() - 0.5) * (w - 2), h + 0.3, cz + (Math.random() - 0.5) * (d - 2));
    group.add(ac);
  }
  blockers.push({ x: cx, z: cz, hw: w / 2, hh: d / 2 });
}

function park(group, cx, cz, cfg, trees, waters) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), mat(0x1d3322, 0x000000, 1, 1));
  grass.rotation.x = -Math.PI / 2; grass.position.set(cx, 0.02, cz); grass.receiveShadow = true; group.add(grass);

  if (Math.random() < 0.7) {
    const r = 2.0 + Math.random() * 0.8;
    const w = makeWater(r);
    w.position.set(cx + (Math.random() - 0.5) * 2.5, 0.06, cz + (Math.random() - 0.5) * 2.5);
    group.add(w);
    waters.push(w.material);
    // damp rim
    const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 32), mat(0x24302a, 0x000000, 1, 1));
    rim.rotation.x = -Math.PI / 2; rim.position.set(w.position.x, 0.04, w.position.z); group.add(rim);
  }

  if (cfg.trees !== false) {
    for (let i = 0; i < 6; i++) {
      const tx = cx + (Math.random() - 0.5) * (BLOCK - 2), tz = cz + (Math.random() - 0.5) * (BLOCK - 2);
      const t = makeTree();
      t.position.set(tx, 0, tz);
      group.add(t);
      trees.push({ mesh: t, x: tx, z: tz, broken: false });
    }
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

function streetlight(group, x, z) {
  const pole = box(0.16, 3.2, 0.16, 0x2b2f36, {}); pole.position.set(x, 1.6, z); group.add(pole);
  const head = box(0.7, 0.18, 0.4, 0x3a3f47, {}); head.position.set(x, 3.2, z + 0.2); group.add(head);
  const bulb = box(0.4, 0.1, 0.28, 0xffe1a1, { emissive: 0xffca7a, emissiveIntensity: 3, cast: false }); bulb.position.set(x, 3.08, z + 0.2); group.add(bulb);
  const pl = new THREE.PointLight(0xffca7a, 7, 9, 2); pl.position.set(x, 3, z + 0.2); group.add(pl);
  const pool = groundGlow(0xffca7a, 7, 0.18); pool.position.set(x, 0.04, z + 0.2); group.add(pool);
}

// Quarantine perimeter: barrier walls, corner watchtowers with sweeping lights.
function border(group, W, H, spots) {
  const t = 0.6;
  const segs = [
    { len: W + 2, horiz: true, x: W / 2, z: -t, inward: true },
    { len: W + 2, horiz: true, x: W / 2, z: H + t, inward: false },
    { len: H + 2, horiz: false, x: -t, z: H / 2, inward: true },
    { len: H + 2, horiz: false, x: W + t, z: H / 2, inward: false },
  ];
  for (const s of segs) {
    const wall = makeBorderWall(s.len, s.horiz, s.inward);
    wall.position.set(s.x, 0, s.z);
    group.add(wall);
  }
  for (const [cx, cz] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const legs = box(1.3, 5.2, 1.3, 0x2e343d, {}); legs.position.set(cx, 2.6, cz); group.add(legs);
    const cab = box(2.2, 1.2, 2.2, 0x39414c, {}); cab.position.set(cx, 5.6, cz); group.add(cab);
    const pivot = new THREE.Group(); pivot.position.set(cx, 5.4, cz); group.add(pivot);
    const beam = box(0.45, 0.3, 0.45, 0xfff3c8, { emissive: 0xffe9a8, emissiveIntensity: 4, cast: false });
    beam.position.set(0, 0, 1.2); pivot.add(beam);
    const sl = new THREE.SpotLight(0xffe9a8, 60, 34, 0.30, 0.55, 1.6);
    sl.position.set(0, 0, 1.2); sl.target.position.set(0, -5.4, 14);
    pivot.add(sl); pivot.add(sl.target);
    spots.push({ pivot, speed: 0.25 + Math.random() * 0.2 });
  }
}
