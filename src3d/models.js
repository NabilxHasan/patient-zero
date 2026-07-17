// Procedural low-poly models — zero external assets.
// One shared unit-cube geometry, materials cached by color, so a whole city of
// characters is cheap. Characters face +Z; rotate via group.rotation.y.
import * as THREE from 'three';

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const _mats = new Map();

export function mat(color, emissive = 0x000000, emissiveIntensity = 1, roughness = 0.85) {
  const key = `${color}|${emissive}|${emissiveIntensity}|${roughness}`;
  if (!_mats.has(key)) {
    _mats.set(key, new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity, roughness, metalness: 0.05, flatShading: true,
    }));
  }
  return _mats.get(key);
}

export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(UNIT, mat(color, opts.emissive ?? 0x000000, opts.emissiveIntensity ?? 1, opts.roughness ?? 0.85));
  m.scale.set(w, h, d);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? false;
  return m;
}

export function cyl(r, h, color, opts = {}) {
  const m = new THREE.Mesh(CYL, mat(color, opts.emissive ?? 0x000000, opts.emissiveIntensity ?? 1, opts.roughness ?? 0.85));
  m.scale.set(r * 2, h, r * 2);
  m.castShadow = opts.cast ?? true;
  return m;
}

// Soft radial gradient — used for ground glow so it fades out instead of
// rendering as a hard-edged disc.
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// Soft ground glow quad (additive, no hard edge, never z-fights).
export function groundGlow(color, size, opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// A limb that pivots at its top (hip/shoulder). box hangs below the pivot.
function limb(px, py, pz, w, len, d, color) {
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  const b = box(w, len, d, color);
  b.position.y = -len / 2;
  pivot.add(b);
  return pivot;
}

export const CIV_PALETTES = [
  { shirt: 0xc97b52, skin: 0xf0cfa8, hair: 0x3a2a1a },
  { shirt: 0x5f8fc9, skin: 0xe8c39a, hair: 0x1f1f24 },
  { shirt: 0xaab35f, skin: 0x8d5a3a, hair: 0x14100c },
  { shirt: 0xc47d9e, skin: 0xf2d9b8, hair: 0x6b4a2a },
  { shirt: 0x8a7ad8, skin: 0xd9b08c, hair: 0x2a1a10 },
  { shirt: 0xcf5f5f, skin: 0xe8c39a, hair: 0x30302f },
];

// kind: 'civ' | 'zombie' | 'police' | 'military' | 'player'
export function makeCharacter(kind, palette) {
  const g = new THREE.Group();
  const p = palette || CIV_PALETTES[0];
  const parts = {};
  let scale = 1;

  if (kind === 'civ') {
    g.add(box(0.6, 0.7, 0.4, p.shirt, {}).translateY(0.95));         // torso
    g.add(box(0.44, 0.42, 0.42, p.skin, {}).translateY(1.55));       // head
    g.add(box(0.5, 0.16, 0.46, p.hair, {}).translateY(1.74));        // hair
    parts.legL = limb(-0.16, 0.6, 0, 0.22, 0.6, 0.24, 0x2b2f3a);
    parts.legR = limb(0.16, 0.6, 0, 0.22, 0.6, 0.24, 0x2b2f3a);
    parts.armL = limb(-0.4, 1.25, 0, 0.18, 0.55, 0.2, p.shirt);
    parts.armR = limb(0.4, 1.25, 0, 0.18, 0.55, 0.2, p.shirt);
    Object.values(parts).forEach(l => g.add(l));

  } else if (kind === 'zombie') {
    const skin = 0x86b06a, cloth = 0x415033;
    g.add(box(0.6, 0.7, 0.4, cloth, {}).translateY(0.9));
    const head = box(0.44, 0.42, 0.42, skin, {}); head.position.set(0, 1.5, 0.06); g.add(head);
    // glowing eyes
    const eyeGeo = box(0.08, 0.08, 0.06, 0xc7ff5e, { emissive: 0xc7ff5e, emissiveIntensity: 3, cast: false });
    eyeGeo.position.set(-0.1, 1.55, 0.24); g.add(eyeGeo);
    const eye2 = box(0.08, 0.08, 0.06, 0xc7ff5e, { emissive: 0xc7ff5e, emissiveIntensity: 3, cast: false });
    eye2.position.set(0.1, 1.55, 0.24); g.add(eye2);
    parts.legL = limb(-0.16, 0.55, 0, 0.22, 0.55, 0.24, 0x33321f);
    parts.legR = limb(0.16, 0.55, 0, 0.22, 0.55, 0.24, 0x33321f);
    parts.armL = limb(-0.4, 1.2, 0, 0.18, 0.55, 0.2, skin);
    parts.armR = limb(0.4, 1.2, 0, 0.18, 0.55, 0.2, skin);
    parts.armL.rotation.x = -1.4; parts.armR.rotation.x = -1.4;   // reaching forward
    Object.values(parts).forEach(l => g.add(l));
    g.rotation.z = 0.06; // slight hunch lean baked into upright pose

  } else if (kind === 'police' || kind === 'military') {
    const mil = kind === 'military';
    const body = mil ? 0x4c5b32 : 0x2c4585;
    const skin = 0xe3c39a;
    g.add(box(0.64, 0.72, 0.42, body, {}).translateY(0.95));
    if (mil) { // vest plate
      g.add(box(0.5, 0.4, 0.1, 0x3a4726, {}).translateY(1.0).translateZ(0.2));
    }
    const head = box(0.42, 0.4, 0.42, skin, {}); head.position.y = 1.55; g.add(head);
    if (mil) g.add(box(0.5, 0.24, 0.5, 0x5d7040, {}).translateY(1.72)); // helmet
    else { g.add(box(0.5, 0.14, 0.5, 0x1a2952, {}).translateY(1.74)); g.add(box(0.5, 0.08, 0.2, 0x1a2952, {}).translateY(1.7).translateZ(0.3)); } // cap+brim
    parts.legL = limb(-0.17, 0.6, 0, 0.24, 0.6, 0.26, 0x1c1f28);
    parts.legR = limb(0.17, 0.6, 0, 0.24, 0.6, 0.26, 0x1c1f28);
    // both arms forward holding a weapon
    parts.armL = limb(-0.34, 1.28, 0, 0.18, 0.5, 0.2, body);
    parts.armR = limb(0.34, 1.28, 0, 0.18, 0.5, 0.2, body);
    parts.armL.rotation.x = -1.3; parts.armR.rotation.x = -1.3;
    Object.values(parts).forEach(l => g.add(l));
    const gun = box(0.12, 0.12, mil ? 0.7 : 0.4, 0x1a1c22, { cast: false });
    gun.position.set(0, 1.15, mil ? 0.5 : 0.35); g.add(gun);
    parts.muzzle = new THREE.Object3D(); parts.muzzle.position.set(0, 1.15, mil ? 0.9 : 0.6); g.add(parts.muzzle);

  } else if (kind === 'player') {
    scale = 1.15;
    const core = 0x2f6b45;
    g.add(box(0.72, 0.8, 0.5, 0x265f3d, { emissive: 0x123a24, emissiveIntensity: 0.3 }).translateY(1.0));
    // glowing chest core
    const heart = box(0.24, 0.24, 0.18, 0xbdf5d0, { emissive: 0x40e070, emissiveIntensity: 1.8, cast: false });
    heart.position.set(0, 1.05, 0.26); g.add(heart); parts.heart = heart;
    const head = box(0.46, 0.44, 0.46, core, { emissive: 0x123a24, emissiveIntensity: 0.25 }); head.position.y = 1.62; g.add(head);
    const e1 = box(0.1, 0.1, 0.06, 0xd6ffe0, { emissive: 0x8fffb0, emissiveIntensity: 2, cast: false }); e1.position.set(-0.11, 1.66, 0.24); g.add(e1);
    const e2 = box(0.1, 0.1, 0.06, 0xd6ffe0, { emissive: 0x8fffb0, emissiveIntensity: 2, cast: false }); e2.position.set(0.11, 1.66, 0.24); g.add(e2);
    parts.legL = limb(-0.18, 0.65, 0, 0.26, 0.65, 0.28, 0x235c3a);
    parts.legR = limb(0.18, 0.65, 0, 0.26, 0.65, 0.28, 0x235c3a);
    parts.armL = limb(-0.44, 1.32, 0, 0.2, 0.6, 0.22, 0x35d977);
    parts.armR = limb(0.44, 1.32, 0, 0.2, 0.6, 0.22, 0x35d977);
    // clawed reaching arms
    parts.armL.rotation.x = -0.9; parts.armR.rotation.x = -0.9;
    Object.values(parts).forEach(l => l.parent === undefined && g.add(l));
    g.add(parts.legL); g.add(parts.legR); g.add(parts.armL); g.add(parts.armR);
  }

  g.scale.setScalar(scale);
  g.userData.parts = parts;
  g.userData.kind = kind;
  g.userData.stepPhase = Math.random() * Math.PI * 2;
  return g;
}

// Advance a two-frame-ish walk cycle for a character group.
export function animateWalk(g, speed, dt, moving) {
  const parts = g.userData.parts;
  if (!parts) return;
  const kind = g.userData.kind;
  if (moving) {
    g.userData.stepPhase += dt * (6 + speed * 0.15);
    const sw = Math.sin(g.userData.stepPhase) * 0.7;
    if (parts.legL) parts.legL.rotation.x = sw;
    if (parts.legR) parts.legR.rotation.x = -sw;
    if (kind === 'civ') {
      if (parts.armL) parts.armL.rotation.x = -sw;
      if (parts.armR) parts.armR.rotation.x = sw;
    } else if (kind === 'zombie') {
      if (parts.armL) parts.armL.rotation.x = -1.4 + Math.sin(g.userData.stepPhase * 0.5) * 0.15;
      if (parts.armR) parts.armR.rotation.x = -1.4 - Math.sin(g.userData.stepPhase * 0.5) * 0.15;
    }
    // little bob
    g.position.y = Math.abs(Math.sin(g.userData.stepPhase)) * 0.05;
  } else {
    if (parts.legL) parts.legL.rotation.x *= 0.8;
    if (parts.legR) parts.legR.rotation.x *= 0.8;
    g.position.y *= 0.8;
  }
  if (parts.heart) {
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.15;
    parts.heart.scale.setScalar(pulse);
  }
}

// ---------------------------------------------------------------- world objects

export function makeBarrel() {
  const g = new THREE.Group();
  const body = cyl(0.42, 1.1, 0xb03a2a, { roughness: 0.7 });
  body.position.y = 0.55; g.add(body);
  const band = cyl(0.45, 0.14, 0x2a2f38, {}); band.position.y = 0.72; g.add(band);
  const top = cyl(0.42, 0.1, 0xd45a3a, { emissive: 0x501008, emissiveIntensity: 0.6 }); top.position.y = 1.12; g.add(top);
  // hazard stripe glow so they read at a glance
  const warn = box(0.2, 0.4, 0.02, 0xffb03a, { emissive: 0xff8a00, emissiveIntensity: 2, cast: false });
  warn.position.set(0, 0.6, 0.44); g.add(warn);
  g.userData.glow = groundGlow(0xff6a2a, 3, 0.25);
  g.userData.glow.position.y = 0.03;
  g.add(g.userData.glow);
  return g;
}

export function makeHealthKit() {
  const g = new THREE.Group();
  const b = box(0.6, 0.4, 0.6, 0xf2f2f2, { roughness: 0.6 }); b.position.y = 0.25; g.add(b);
  const c1 = box(0.36, 0.12, 0.12, 0xe03a3a, { emissive: 0xe03a3a, emissiveIntensity: 1.4 }); c1.position.y = 0.47; g.add(c1);
  const c2 = box(0.12, 0.12, 0.36, 0xe03a3a, { emissive: 0xe03a3a, emissiveIntensity: 1.4 }); c2.position.y = 0.47; g.add(c2);
  const glow = groundGlow(0x40ff70, 2.6, 0.3); glow.position.y = 0.03; g.add(glow);
  return g;
}

// Pushable street prop (crate / bin) — knocked around on contact.
export function makeProp(type) {
  const g = new THREE.Group();
  if (type === 'bin') {
    const b = cyl(0.36, 0.9, 0x3d4a3a, {}); b.position.y = 0.45; g.add(b);
    const lid = cyl(0.4, 0.1, 0x4d5c48, {}); lid.position.y = 0.94; g.add(lid);
  } else {
    const b = box(0.8, 0.8, 0.8, 0x7a5a34, {}); b.position.y = 0.4; g.add(b);
    const t = box(0.84, 0.1, 0.14, 0x5c4426, { cast: false }); t.position.y = 0.62; g.add(t);
  }
  return g;
}

// Breakable tree — returns group with trunk/foliage so it can shatter.
export function makeTree() {
  const g = new THREE.Group();
  const trunk = box(0.3, 1, 0.3, 0x4a3320, {}); trunk.position.y = 0.5; g.add(trunk);
  const f1 = box(1.4, 1.4, 1.4, 0x2c4a2e, {}); f1.position.y = 1.6; g.add(f1);
  const f2 = box(0.9, 0.9, 0.9, 0x3a5e3a, {}); f2.position.y = 2.3; g.add(f2);
  g.userData.chunks = [trunk, f1, f2];
  return g;
}

// ---------------------------------------------------------------- vehicles

export function makePoliceCar() {
  const g = new THREE.Group();
  const body = box(1.9, 0.6, 4.0, 0x1f3f8a, { roughness: 0.5 }); body.position.y = 0.55; g.add(body);
  const cabin = box(1.7, 0.55, 1.9, 0x14264f, {}); cabin.position.set(0, 1.05, -0.15); g.add(cabin);
  const glass = box(1.55, 0.4, 0.1, 0x9fb4c4, { roughness: 0.2 }); glass.position.set(0, 1.05, 0.82); g.add(glass);
  const stripe = box(1.95, 0.22, 1.4, 0xf2f2f2, { cast: false }); stripe.position.set(0, 0.55, 0.6); g.add(stripe);
  // light bar
  const red = box(0.5, 0.16, 0.3, 0xff3030, { emissive: 0xff2020, emissiveIntensity: 3, cast: false });
  red.position.set(-0.4, 1.4, -0.15); g.add(red);
  const blue = box(0.5, 0.16, 0.3, 0x3060ff, { emissive: 0x2040ff, emissiveIntensity: 3, cast: false });
  blue.position.set(0.4, 1.4, -0.15); g.add(blue);
  for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const w = cyl(0.35, 0.25, 0x14161c, {}); w.rotation.z = Math.PI / 2; w.position.set(x, 0.35, z); g.add(w);
  }
  g.userData.beacons = [red, blue];
  return g;
}

export function makeTank() {
  const g = new THREE.Group();
  const hull = box(2.6, 0.8, 4.4, 0x46512e, { roughness: 0.8 }); hull.position.y = 0.75; g.add(hull);
  const skirt = box(2.9, 0.5, 4.2, 0x333c22, {}); skirt.position.y = 0.4; g.add(skirt);
  const turret = new THREE.Group(); turret.position.set(0, 1.25, -0.2); g.add(turret);
  const tBody = box(1.8, 0.7, 2.2, 0x525e36, {}); turret.add(tBody);
  const barrel = box(0.26, 0.26, 2.8, 0x3a4228, {}); barrel.position.set(0, 0.05, 1.6); turret.add(barrel);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, 3.1); turret.add(muzzle);
  // treads
  for (const x of [-1.45, 1.45]) {
    const tread = box(0.45, 0.7, 4.5, 0x1c2116, {}); tread.position.set(x, 0.45, 0); g.add(tread);
  }
  g.userData.turret = turret;
  g.userData.muzzle = muzzle;
  return g;
}

export function makeHelicopter() {
  const g = new THREE.Group();
  const body = box(1.4, 1.1, 3.6, 0x3c4630, { roughness: 0.6 }); body.position.y = 0; g.add(body);
  const nose = box(1.1, 0.8, 0.9, 0x9fb4c4, { roughness: 0.2 }); nose.position.set(0, 0.05, 2.0); g.add(nose);
  const tail = box(0.35, 0.35, 2.6, 0x3c4630, {}); tail.position.set(0, 0.2, -2.8); g.add(tail);
  const fin = box(0.12, 0.9, 0.6, 0x333c22, {}); fin.position.set(0, 0.7, -3.8); g.add(fin);
  for (const x of [-0.7, 0.7]) { const skid = box(0.12, 0.12, 2.6, 0x22261c, {}); skid.position.set(x, -0.85, 0); g.add(skid); }
  const mast = box(0.18, 0.4, 0.18, 0x22261c, {}); mast.position.y = 0.75; g.add(mast);
  const rotor = new THREE.Group(); rotor.position.y = 0.95; g.add(rotor);
  for (let i = 0; i < 4; i++) {
    const blade = box(0.16, 0.05, 6.4, 0x1a1d22, { cast: false });
    blade.rotation.y = (i / 4) * Math.PI * 2; rotor.add(blade);
  }
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.25, 0.4, -3.8); g.add(tailRotor);
  for (let i = 0; i < 2; i++) { const b = box(0.08, 1.4, 0.05, 0x1a1d22, { cast: false }); b.rotation.z = i * Math.PI / 2; tailRotor.add(b); }
  const spot = box(0.3, 0.2, 0.2, 0xfff0c0, { emissive: 0xffe9a8, emissiveIntensity: 4, cast: false });
  spot.position.set(0, -0.6, 1.7); g.add(spot);
  g.userData.rotor = rotor; g.userData.tailRotor = tailRotor;
  return g;
}

// ---------------------------------------------------------------- borders

// Quarantine perimeter: concrete barrier with hazard stripes and warning lamps.
export function makeBorderWall(len, horizontal, inward) {
  const g = new THREE.Group();
  const w = horizontal ? len : 1.4;
  const d = horizontal ? 1.4 : len;
  // light concrete so the barrier still reads as a structure under night lighting
  const base = box(w, 3.0, d, 0x6b7480, { receive: true }); base.position.y = 1.5; g.add(base);
  const cap = box(w + 0.2, 0.3, d + 0.2, 0x8a939e, {}); cap.position.y = 3.15; g.add(cap);
  const skirt = box(w + 0.5, 0.4, d + 0.5, 0x4d545e, {}); skirt.position.y = 0.2; g.add(skirt);

  const face = (d / 2 + 0.05) * (inward ? 1 : -1);
  const n = Math.max(2, Math.floor(len / 2.6));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    // alternating hazard chevrons on the inward face
    const s = box(horizontal ? 1.0 : 0.08, 0.9, horizontal ? 0.08 : 1.0, i % 2 ? 0xffc23a : 0x24272e,
      { emissive: i % 2 ? 0xffa000 : 0x000000, emissiveIntensity: i % 2 ? 1.6 : 0, cast: false });
    s.position.set(
      horizontal ? t * len : (horizontal ? 0 : face),
      1.4,
      horizontal ? face : t * len
    );
    g.add(s);
    // warning lamps along the cap
    if (i % 4 === 0) {
      const lamp = box(0.22, 0.22, 0.22, 0xff5a3a, { emissive: 0xff3a20, emissiveIntensity: 3, cast: false });
      lamp.position.set(horizontal ? t * len : 0, 3.45, horizontal ? 0 : t * len);
      g.add(lamp);
      const pl = new THREE.PointLight(0xff5a3a, 3, 8, 2);
      pl.position.copy(lamp.position); g.add(pl);
    }
  }
  return g;
}

