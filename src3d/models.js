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
