// One continuous map: the three districts built side by side into a single
// coordinate space, joined by highways and quarantine gates.
//
// Districts are built locally (0..W) then their group is offset; their blockers
// are copied into world space so collision, ground height and spawning all work
// across the seams. Static geometry stays baked per district, so the whole world
// is still only a handful of draw calls and three.js frustum-culls the ones
// behind you.
import * as THREE from 'three';
import { buildCity } from './city.js';
import { box, groundGlow } from './models.js';
import { LEVELS, STREET } from './levels.js';

export const GAP = 26;          // highway strip between districts

export function buildWorld(scene, levels = LEVELS) {
  const root = new THREE.Group();
  scene.add(root);

  const districts = [];
  let cursorX = 0;
  let maxH = 0;

  for (let i = 0; i < levels.length; i++) {
    const cfg = levels[i];
    const holder = new THREE.Group();
    root.add(holder);
    const city = buildCity(holder, cfg);          // builds at local 0..W
    const ox = cursorX, oz = 0;
    holder.position.set(ox, 0, oz);

    districts.push({
      index: i, cfg, city, ox, oz, W: city.W, H: city.H,
      cleared: false,
      bounds: { x0: ox, z0: oz, x1: ox + city.W, z1: oz + city.H },
    });
    cursorX += city.W + GAP;
    maxH = Math.max(maxH, city.H);
  }

  const W = cursorX - GAP;
  const H = maxH;

  // ---- blockers in world space ----
  const blockers = [];
  for (const d of districts) {
    for (const b of d.city.blockers) {
      blockers.push({ ...b, x: b.x + d.ox, z: b.z + d.oz, district: d.index });
    }
  }

  // ---- connecting highway + gates ----
  const gates = [];
  const stat = new THREE.Group();
  root.add(stat);
  for (let i = 0; i < districts.length - 1; i++) {
    const a = districts[i], b = districts[i + 1];
    const x0 = a.ox + a.W, x1 = b.ox;
    const cx = (x0 + x1) / 2, cz = H / 2;

    // road deck
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 + 2, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 1 })
    );
    road.rotation.x = -Math.PI / 2; road.position.set(cx, 0.01, cz); road.receiveShadow = true; stat.add(road);
    for (let k = 0; k < 6; k++) {                       // centre dashes
      const dash = box(1.6, 0.02, 0.3, 0x4a525e, {});
      dash.position.set(x0 + 1 + k * ((x1 - x0) / 6), 0.03, cz); stat.add(dash);
    }

    // gate: two pillars and a sliding barrier that lifts once the district falls
    for (const oz2 of [-8.4, 8.4]) {
      stat.add(box(1.2, 6, 1.2, 0x6b7480, { cast: true }).translateX(cx).translateY(3).translateZ(cz + oz2));
    }
    // barrier is a group so the chevrons ride with it as it lifts
    const barrier = new THREE.Group();
    barrier.position.set(cx, 2.2, cz);
    root.add(barrier);
    const slab = box(1.0, 4.4, 16.4, 0x8a939e, { cast: true });
    barrier.add(slab);
    for (let k = 0; k < 8; k++) {
      const chev = box(1.06, 0.7, 0.9, k % 2 ? 0xffc23a : 0x24272e,
        { emissive: k % 2 ? 0xffa000 : 0x000000, emissiveIntensity: k % 2 ? 1.4 : 0 });
      chev.position.set(0.04, 0, -7 + k * 2);
      barrier.add(chev);
    }
    const glow = groundGlow(0xffa000, 20, 0.25);
    glow.position.set(cx, 0.06, cz);
    root.add(glow);

    const gate = {
      x: cx, z: cz, unlocksDistrict: i + 1, open: false,
      mesh: barrier, glow, closedY: 2.2,
      blocker: { x: cx, z: cz, hw: 0.6, hh: 8.2, top: 4.4, walkable: false, gate: true },
    };
    blockers.push(gate.blocker);
    gates.push(gate);
  }

  // ---- world-space helpers ----
  function insideBlocked(x, z, pad = 0.5, y = 0) {
    for (const b of blockers) {
      if (b.disabled) continue;
      if (y >= (b.top ?? 99) - 0.05) continue;
      if (Math.abs(x - b.x) < b.hw + pad && Math.abs(z - b.z) < b.hh + pad) return true;
    }
    return false;
  }

  function collide(x, z, rad, y = 0) {
    for (const b of blockers) {
      if (b.disabled) continue;
      if (y >= (b.top ?? 99) - 0.05) continue;
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

  function groundHeightAt(x, z) {
    let h = 0;
    for (const b of blockers) {
      if (b.disabled || !b.walkable) continue;
      if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hh) h = Math.max(h, b.top);
    }
    return h;
  }
  function blockedSegment(x, z) { return insideBlocked(x, z, 0); }

  function districtAt(x, z) {
    for (const d of districts) {
      if (x >= d.bounds.x0 - GAP / 2 && x <= d.bounds.x1 + GAP / 2) return d;
    }
    return districts[0];
  }

  // Spawn helpers take world coords and stay inside the given district.
  function randomStreetPoint(di = 0) {
    const d = districts[di] || districts[0];
    for (let i = 0; i < 90; i++) {
      const x = d.ox + 2 + Math.random() * (d.W - 4);
      const z = d.oz + 2 + Math.random() * (d.H - 4);
      if (!insideBlocked(x, z, 0.9)) return { x, z };
    }
    return { x: d.ox + STREET / 2, z: d.oz + STREET / 2 };
  }
  function streetPointNear(px, pz, minD, maxD) {
    const d = districtAt(px, pz);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, r = minD + Math.random() * (maxD - minD);
      const x = THREE.MathUtils.clamp(px + Math.cos(a) * r, d.bounds.x0 + 2, d.bounds.x1 - 2);
      const z = THREE.MathUtils.clamp(pz + Math.sin(a) * r, d.bounds.z0 + 2, d.bounds.z1 - 2);
      if (!insideBlocked(x, z, 0.9)) return { x, z };
    }
    return randomStreetPoint(d.index);
  }

  function openGate(g) {
    if (g.open) return;
    g.open = true;
    g.blocker.disabled = true;
    g.glow.material.color.setHex(0x49ff8c);
  }

  // Aggregate the dynamic objects into world space. Their meshes are re-parented
  // to the world root with attach() (which preserves the world transform), so
  // their local position IS their world position — otherwise gameplay code
  // writing world coords into a mesh sitting inside an offset district group
  // would double-offset it.
  root.updateMatrixWorld(true);
  const trees = [], props = [], lamps = [];
  for (const d of districts) {
    for (const t of d.city.trees) { root.attach(t.mesh); t.x += d.ox; t.z += d.oz; trees.push(t); }
    for (const p of d.city.props) { root.attach(p.mesh); p.x += d.ox; p.z += d.oz; props.push(p); }
    for (const l of d.city.lamps) {
      root.attach(l.mesh);
      if (l.pool) root.attach(l.pool);
      l.x += d.ox; l.z += d.oz;
      lamps.push(l);
    }
  }

  function tick(dt, t) {
    for (const d of districts) d.city.tick(dt, t);
    for (const g of gates) {
      const wantY = g.open ? g.closedY + 5.2 : g.closedY;   // slide up out of the way
      g.mesh.position.y += (wantY - g.mesh.position.y) * (1 - Math.exp(-3 * dt));
      g.mesh.visible = g.mesh.position.y < g.closedY + 5.0;
    }
  }

  return {
    root, districts, gates, blockers, trees, props, lamps, W, H,
    collide, groundHeightAt, blockedSegment, randomStreetPoint, streetPointNear,
    districtAt, openGate, tick,
  };
}
