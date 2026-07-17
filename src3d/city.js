// Procedural 3D city: district-styled blocks, extruded buildings with lit
// windows, parks with real animated water and breakable trees, pushable street
// props, parked cars, streetlights, and a quarantine border with watchtowers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  box, mat, makeTree, makeProp, makeBorderWall, groundGlow, makeCivCar, makeBench,
  makeBarn, makeSilo, makeHaystack, makeFence, makeBillboard, makeNeonStrip, makeHoverCar,
} from './models.js';
import { BLOCK, STREET, CELL } from './levels.js';

// The city never moves, so its meshes are baked into one merged mesh per
// material. A district was ~420 draw calls, and on integrated GPUs draw-call
// overhead alone cost ~13ms/frame regardless of resolution.
// Excluded: anything animated, transparent, or gameplay-owned (water, glow
// quads, breakable trees, pushable props, barrels, kits).
function mergeStatic(root) {
  const buckets = new Map();
  const out = new THREE.Group();
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });

  for (const o of meshes) {
    const m = o.material;
    const ok = m && !m.transparent && !Array.isArray(m) && !o.userData.noMerge
      && o.geometry.isBufferGeometry && o.geometry.index;   // keep indexed-only so merges are uniform
    if (!ok) { out.attach(o); continue; }                   // preserve anything we can't bake
    const key = m.uuid + '|' + (o.castShadow ? 1 : 0) + '|' + (o.receiveShadow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, { material: m, cast: o.castShadow, receive: o.receiveShadow, geos: [], src: [] });
    const gg = o.geometry.clone();
    gg.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(gg.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) gg.deleteAttribute(name);
    }
    const b = buckets.get(key);
    b.geos.push(gg); b.src.push(o);
  }

  let count = 0;
  for (const b of buckets.values()) {
    if (!b.geos.length) continue;
    let geo = null;
    try { geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false); }
    catch { geo = null; }
    if (geo) {
      const mesh = new THREE.Mesh(geo, b.material);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      out.add(mesh); count++;
    } else {
      // merge failed — keep the originals rather than dropping the geometry
      for (const o of b.src) out.attach(o);
    }
  }
  return { merged: out, count };
}

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
  // Everything added to `stat` is baked down into a few merged meshes at the
  // end; `group` holds anything animated, transparent or gameplay-owned.
  const stat = new THREE.Group();

  const pal = cfg.palette;
  const blockers = [];
  const trees = [];
  const props = [];
  const waters = [];
  const spots = [];   // rotating searchlights on watchtowers
  const lamps = [];   // breakable streetlights (kept out of the static bake)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 60, H + 60),
    new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -0.02, H / 2);
  ground.receiveShadow = true;
  stat.add(ground);

  // lane markings
  const laneMat = new THREE.MeshStandardMaterial({ color: 0x2c333f, roughness: 1 });
  for (let r = 0; r <= rows; r++) {
    const z = STREET / 2 + r * CELL;
    const l = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.35), laneMat);
    l.rotation.x = -Math.PI / 2; l.position.set(W / 2, 0.01, z); stat.add(l);
  }
  for (let c = 0; c <= cols; c++) {
    const x = STREET / 2 + c * CELL;
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.35, H), laneMat);
    l.rotation.x = -Math.PI / 2; l.position.set(x, 0.01, H / 2); stat.add(l);
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x232933, roughness: 1 });

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bx = STREET + cx * CELL + BLOCK / 2;
      const bz = STREET + cy * CELL + BLOCK / 2;

      const sw = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 2.6, BLOCK + 2.6), sidewalkMat);
      sw.rotation.x = -Math.PI / 2; sw.position.set(bx, 0.005, bz); sw.receiveShadow = true; stat.add(sw);

      if (Math.random() < cfg.parkChance) park(stat, group, bx, bz, cfg, trees, waters, blockers);
      else building(stat, bx, bz, blockers, cfg);

      if (Math.random() < 0.5) car(stat, bx, bz, blockers, cfg);
    }
  }

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (Math.random() < 0.5) continue;
      streetlight(group, lamps, STREET / 2 + c * CELL + 1.2, STREET / 2 + r * CELL + 1.2);
    }
  }

  // pushable street props (dynamic — never merged)
  for (let i = 0; i < (cfg.props || 0); i++) {
    const p = randomStreetPointRaw();
    const g = makeProp(Math.random() < 0.5 ? 'bin' : 'crate');
    g.position.set(p.x, 0, p.z);
    group.add(g);
    props.push({ mesh: g, x: p.x, z: p.z, vx: 0, vz: 0, spin: 0 });
  }

  // ---- quarantine border + watchtowers ----
  border(stat, group, W, H, spots);

  // bake the static city down
  const { merged } = mergeStatic(stat);
  group.add(merged);

  function insideBlocked(x, z, pad = 0.5, y = 0) {
    for (const b of blockers) {
      if (y >= (b.top ?? 99) - 0.05) continue;         // over it, or standing on it
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
  // `y` is the actor's feet height — jump over anything shorter than that.
  function collide(x, z, rad, y = 0) {
    for (const b of blockers) {
      if (y >= (b.top ?? 99) - 0.05) continue;        // over it, or standing on it
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

  // Surface height under (x,z): a rooftop if you're over a building, else the
  // street. Drives landing so the transformed player can walk the skyline.
  function groundHeightAt(x, z) {
    let h = 0;
    for (const b of blockers) {
      if (!b.walkable) continue;
      if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hh) h = Math.max(h, b.top);
    }
    return h;
  }

  function tick(dt, t) {
    for (const w of waters) w.uniforms.uTime.value = t;
    for (const s of spots) { s.pivot.rotation.y += dt * s.speed; }
  }

  return {
    group, W, H, blockers, trees, props, lamps, tick,
    randomStreetPoint: randomStreetPointRaw, streetPointNear, collide, blockedSegment, groundHeightAt,
  };
}

// Facades are baked into a canvas instead of built from hundreds of window
// planes — a 5x5 district was spending ~1000 draw calls on windows alone.
// Albedo carries the wall + windows; a matching emissive map lights only the
// lit ones.
function facadeMaterial(w, h, wallColor) {
  const cols = Math.max(2, Math.round(w / 1.35));
  const rows = Math.max(2, Math.round(h / 1.45));
  const CW = 16, CH = 16;                       // px per window cell
  const cw = cols * CW, ch = rows * CH;

  const base = document.createElement('canvas'); base.width = cw; base.height = ch;
  const glow = document.createElement('canvas'); glow.width = cw; glow.height = ch;
  const b = base.getContext('2d'), gl = glow.getContext('2d');

  const hex = '#' + wallColor.toString(16).padStart(6, '0');
  b.fillStyle = hex; b.fillRect(0, 0, cw, ch);
  gl.fillStyle = '#000'; gl.fillRect(0, 0, cw, ch);

  // subtle concrete banding
  b.fillStyle = 'rgba(255,255,255,0.04)';
  for (let r = 0; r < rows; r++) b.fillRect(0, r * CH, cw, 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * CW + 4, y = r * CH + 3, ww = CW - 8, wh = CH - 7;
      const lit = Math.random() < 0.3;
      b.fillStyle = lit ? '#e8cf8a' : '#11141b';
      b.fillRect(x, y, ww, wh);
      b.fillStyle = 'rgba(0,0,0,0.35)';          // frame
      b.fillRect(x, y, ww, 1); b.fillRect(x, y + wh - 1, ww, 1);
      if (lit) { gl.fillStyle = '#e8cf8a'; gl.fillRect(x, y, ww, wh); }
    }
  }
  const map = new THREE.CanvasTexture(base);
  const emissiveMap = new THREE.CanvasTexture(glow);
  map.magFilter = emissiveMap.magFilter = THREE.NearestFilter;
  return new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.92,
  });
}

function building(stat, cx, cz, blockers, cfg) {
  const w = BLOCK - (1 + Math.random() * 2);
  const d = BLOCK - (1 + Math.random() * 2);
  const [hMin, hMax] = cfg.buildingH;
  const h = hMin + Math.random() * (hMax - hMin);
  const roofs = cfg.palette.roofs;
  const color = roofs[(Math.random() * roofs.length) | 0];
  const theme = cfg.theme || 'city';

  // ---- rural: barns, farmhouses and silos instead of a facade grid ----
  if (theme === 'rural') {
    const barn = makeBarn(w, h, d, color);
    barn.position.set(cx, 0, cz);
    stat.add(barn);
    if (Math.random() < 0.45) {
      const sh = 5 + Math.random() * 3;
      const silo = makeSilo(sh);
      const sx = cx + (w / 2 + 2.2) * (Math.random() < 0.5 ? -1 : 1);
      silo.position.set(sx, 0, cz + (Math.random() - 0.5) * 3);
      stat.add(silo);
      blockers.push({ x: silo.position.x, z: silo.position.z, hw: 1.6, hh: 1.6, top: sh + 1.2, walkable: true });
    }
    for (let i = 0; i < 2; i++) {                       // hay bales you can vault
      const hx = cx + (Math.random() - 0.5) * (BLOCK + 3);
      const hz = cz + (d / 2 + 1.6 + Math.random() * 1.5) * (Math.random() < 0.5 ? -1 : 1);
      const hay = makeHaystack(); hay.position.set(hx, 0, hz); stat.add(hay);
      blockers.push({ x: hx, z: hz, hw: 0.75, hh: 0.75, top: 1.35, walkable: true });
    }
    blockers.push({ x: cx, z: cz, hw: w / 2, hh: d / 2, top: h + 0.9, walkable: true });
    return;
  }

  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMaterial(w, h, color));
  b.position.set(cx, h / 2, cz);
  b.castShadow = true; b.receiveShadow = true;
  stat.add(b);

  // ---- neon: light strips, holo billboards ----
  if (theme === 'neon') {
    const hues = [0xff2fb9, 0x00e5ff, 0x7c4dff, 0x00ffc8, 0xff5c00];
    const hue = hues[(Math.random() * hues.length) | 0];
    for (let i = 1; i < Math.floor(h / 2.4); i++) {     // horizontal bands
      const y = i * 2.4;
      for (const [ox, oz, hor, len] of [[0, d / 2 + 0.08, true, w], [0, -d / 2 - 0.08, true, w],
                                        [w / 2 + 0.08, 0, false, d], [-w / 2 - 0.08, 0, false, d]]) {
        const strip = makeNeonStrip(len, hor, hue);
        strip.position.set(cx + ox, y, cz + oz);
        stat.add(strip);
      }
    }
    // corner uplights
    for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      const col = makeNeonStrip(h, false, hue);
      col.rotation.x = Math.PI / 2;
      col.position.set(cx + ox, h / 2, cz + oz);
      stat.add(col);
    }
    if (Math.random() < 0.6) {                          // rooftop billboard
      const bb = makeBillboard((Math.random() * 4) | 0);
      bb.position.set(cx, h + 0.2, cz + (Math.random() - 0.5) * (d - 4));
      bb.rotation.y = Math.random() * Math.PI * 2;
      stat.add(bb);
    }
  }

  // ---- rooftop: walkable in Hulk form, so dress it ----
  const roof = box(w + 0.1, 0.2, d + 0.1, color, { cast: false }); roof.position.set(cx, h + 0.1, cz); stat.add(roof);
  // parapet lip around the edge
  for (const [ox, oz, pw, pd] of [[0, -d / 2, w, 0.2], [0, d / 2, w, 0.2], [-w / 2, 0, 0.2, d], [w / 2, 0, 0.2, d]]) {
    const lip = box(pw, 0.5, pd, 0x4a515c, {});
    lip.position.set(cx + ox, h + 0.45, cz + oz); stat.add(lip);
  }
  const rx = () => cx + (Math.random() - 0.5) * (w - 2.5);
  const rz = () => cz + (Math.random() - 0.5) * (d - 2.5);
  if (Math.random() < 0.8) {                       // AC unit
    const ac = box(1.0, 0.7, 1.0, 0x59606c, {}); ac.position.set(rx(), h + 0.55, rz()); stat.add(ac);
  }
  if (Math.random() < 0.6) {                       // chimney with a cap
    const x0 = rx(), z0 = rz();
    stat.add(box(0.6, 1.6, 0.6, 0x6b4a3a, {}).translateX(x0).translateY(h + 1.0).translateZ(z0));
    stat.add(box(0.8, 0.16, 0.8, 0x3a3f47, {}).translateX(x0).translateY(h + 1.85).translateZ(z0));
  }
  if (Math.random() < 0.55) {                      // solar array
    const x0 = rx(), z0 = rz();
    for (let i = 0; i < 2; i++) {
      const panel = box(1.5, 0.08, 0.9, 0x1c3350, { roughness: 0.25 });
      panel.position.set(x0, h + 0.62, z0 + i * 1.1);
      panel.rotation.x = -0.42;
      stat.add(panel);
      stat.add(box(0.08, 0.35, 0.08, 0x3a3f47, {}).translateX(x0).translateY(h + 0.35).translateZ(z0 + i * 1.1));
    }
  }
  if (Math.random() < 0.5) {                       // crates + vent pipe
    stat.add(box(0.7, 0.7, 0.7, 0x7a5a34, {}).translateX(rx()).translateY(h + 0.55).translateZ(rz()));
    const x0 = rx(), z0 = rz();
    stat.add(box(0.3, 0.9, 0.3, 0x4a515c, {}).translateX(x0).translateY(h + 0.65).translateZ(z0));
  }
  if (Math.random() < 0.35) {                      // roof access hatch
    stat.add(box(1.0, 0.25, 1.0, 0x3a3028, {}).translateX(rx()).translateY(h + 0.32).translateZ(rz()));
  }
  if (Math.random() < 0.4) {
    const vent = box(0.5, 0.35, 0.5, 0x4a515c, { cast: false });
    vent.position.set(cx + (Math.random() - 0.5) * (w - 2), h + 0.38, cz + (Math.random() - 0.5) * (d - 2));
    stat.add(vent);
  }
  // entrance canopy so the ground floor reads
  const door = box(1.4, 0.12, 0.5, 0x2a2f38, { cast: false });
  door.position.set(cx, 2.1, cz + d / 2 + 0.2); stat.add(door);
  blockers.push({ x: cx, z: cz, hw: w / 2, hh: d / 2, top: h, walkable: true });
}

function park(stat, group, cx, cz, cfg, trees, waters, blockers) {
  const rural = cfg.theme === 'rural';
  if (rural) {
    // ploughed field with a rail fence around it
    const field = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), mat(0x2f3a1c, 0x000000, 1, 1));
    field.rotation.x = -Math.PI / 2; field.position.set(cx, 0.02, cz); field.receiveShadow = true; stat.add(field);
    for (let r = 0; r < 7; r++) {                      // furrows
      const row = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 1, 0.5), mat(0x3d4a26, 0x000000, 1, 1));
      row.rotation.x = -Math.PI / 2;
      row.position.set(cx, 0.03, cz - BLOCK / 2 + 1 + r * 1.5); stat.add(row);
    }
    for (const [ox, oz, hor] of [[0, -BLOCK / 2, true], [0, BLOCK / 2, true], [-BLOCK / 2, 0, false], [BLOCK / 2, 0, false]]) {
      const f = makeFence(BLOCK, hor); f.position.set(cx + ox, 0, cz + oz); stat.add(f);
      blockers.push({ x: cx + ox, z: cz + oz, hw: hor ? BLOCK / 2 : 0.16, hh: hor ? 0.16 : BLOCK / 2, top: 1.1, walkable: false });
    }
    if (cfg.trees !== false) for (let i = 0; i < 3; i++) {
      const tx = cx + (Math.random() - 0.5) * (BLOCK - 3), tz = cz + (Math.random() - 0.5) * (BLOCK - 3);
      const t = makeTree(); t.position.set(tx, 0, tz); group.add(t);
      trees.push({ mesh: t, x: tx, z: tz, broken: false });
    }
    return;
  }
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), mat(0x1d3322, 0x000000, 1, 1));
  grass.rotation.x = -Math.PI / 2; grass.position.set(cx, 0.02, cz); grass.receiveShadow = true; stat.add(grass);

  if (Math.random() < 0.7) {
    const r = 2.0 + Math.random() * 0.8;
    const w = makeWater(r);
    w.position.set(cx + (Math.random() - 0.5) * 2.5, 0.06, cz + (Math.random() - 0.5) * 2.5);
    group.add(w);
    waters.push(w.material);
    // damp rim
    const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 32), mat(0x24302a, 0x000000, 1, 1));
    rim.rotation.x = -Math.PI / 2; rim.position.set(w.position.x, 0.04, w.position.z); stat.add(rim);
  }

  // benches line the paths — vault them with a jump
  for (let i = 0; i < 3; i++) {
    const horiz = Math.random() < 0.5;
    const bx2 = cx + (horiz ? (Math.random() - 0.5) * (BLOCK - 4) : (Math.random() < 0.5 ? -1 : 1) * 2.6);
    const bz2 = cz + (horiz ? (Math.random() < 0.5 ? -1 : 1) * 2.6 : (Math.random() - 0.5) * (BLOCK - 4));
    const bench = makeBench();
    bench.position.set(bx2, 0, bz2);
    bench.rotation.y = horiz ? 0 : Math.PI / 2;
    stat.add(bench);
    blockers.push({ x: bx2, z: bz2, hw: horiz ? 0.95 : 0.3, hh: horiz ? 0.3 : 0.95, top: 1.0 });
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

function car(stat, cx, cz, blockers, cfg) {
  const horiz = Math.random() < 0.5;
  const along = (Math.random() - 0.5) * (BLOCK - 3);
  const side = (Math.random() < 0.5 ? 1 : -1) * (BLOCK / 2 + 1.6);
  const x = cx + (horiz ? along : side);
  const z = cz + (horiz ? side : along);
  const neon = cfg && cfg.theme === 'neon';
  const color = neon
    ? [0x2a1630, 0x14202e, 0x231a3a, 0x1b1f3a][(Math.random() * 4) | 0]
    : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  const g = neon ? makeHoverCar(color) : makeCivCar(color);
  g.position.set(x, 0, z);
  g.rotation.y = horiz ? Math.PI / 2 : 0;   // park along the kerb
  stat.add(g);
  const L = 4.0, Wd = 1.9;
  const w = horiz ? L : Wd, d = horiz ? Wd : L;
  blockers.push({ x, z, hw: w / 2, hh: d / 2, top: 1.4, walkable: true });
}

// Lamps are emissive geometry plus a glow quad on the ground — no real
// PointLight. ~15 of them as dynamic lights was a large share of the frame cost.
// The lamp housing is light grey and the bulb only mildly emissive: a bright
// bulb on a near-black pole just reads as a gold rectangle floating in the air.
// Lamps stay unmerged so they can be smashed.
function streetlight(group, lamps, x, z) {
  const g = new THREE.Group();
  g.add(box(0.34, 0.24, 0.34, 0x6b7480, {}).translateY(0.12));
  const pole = box(0.16, 3.6, 0.16, 0x79828e, { cast: true }); pole.position.y = 1.8; g.add(pole);
  const arm = box(0.14, 0.14, 0.8, 0x79828e, {}); arm.position.set(0, 3.55, 0.35); g.add(arm);
  const head = box(0.44, 0.2, 0.4, 0x8e97a3, {}); head.position.set(0, 3.4, 0.66); g.add(head);
  const bulb = box(0.3, 0.06, 0.26, 0xfff0c4, { emissive: 0xffca7a, emissiveIntensity: 1.4, cast: false });
  bulb.position.set(0, 3.28, 0.66); g.add(bulb);
  g.position.set(x, 0, z);
  group.add(g);
  const pool = groundGlow(0xffca7a, 8, 0.3); pool.position.set(x, 0.04, z + 0.66); group.add(pool);
  lamps.push({ mesh: g, x, z, broken: false, pool, chunks: [pole, arm, head, bulb] });
}

// Quarantine perimeter: barrier walls, corner watchtowers with sweeping lights.
function border(stat, group, W, H, spots) {
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
    stat.add(wall);
  }
  for (const [cx, cz] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const leg = box(0.22, 5.4, 0.22, 0x4a525d, {}); leg.position.set(cx + ox, 2.7, cz + oz); stat.add(leg);
    }
    const deck = box(2.6, 0.2, 2.6, 0x5a626d, {}); deck.position.set(cx, 5.4, cz); stat.add(deck);
    const cab = box(2.0, 1.4, 2.0, 0x6b7480, {}); cab.position.set(cx, 6.2, cz); stat.add(cab);
    const roof = box(2.4, 0.16, 2.4, 0x8a939e, { cast: false }); roof.position.set(cx, 7.0, cz); stat.add(roof);
    // Sweeping lamp: emissive head + a moving ground pool. A real SpotLight per
    // tower is four more dynamic lights for a beam nobody looks straight at.
    const pivot = new THREE.Group(); pivot.position.set(cx, 6.2, cz); group.add(pivot);
    const beam = box(0.5, 0.34, 0.5, 0xfff3c8, { emissive: 0xffe9a8, emissiveIntensity: 4.5, cast: false });
    beam.position.set(0, 0, 1.1); pivot.add(beam);
    const pool = groundGlow(0xffe9a8, 13, 0.3); pool.position.set(0, -6.15, 7); pivot.add(pool);
    spots.push({ pivot, speed: 0.25 + Math.random() * 0.2 });
  }
}
