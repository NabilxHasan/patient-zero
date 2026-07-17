// Canvas minimap. Corner view follows patient zero; Tab expands it to the whole
// district. Drawn on a 2D canvas rather than a second 3D pass — a render-to-
// texture camera would double the draw calls on integrated GPUs.
export class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.full = false;
    this.blockerCache = null;
    this.cacheFor = null;
  }

  toggleFull() {
    this.full = !this.full;
    this.canvas.classList.toggle('full', this.full);
    this.resize();
  }

  resize() {
    const s = this.full ? Math.min(innerWidth, innerHeight) * 0.82 : 190;
    this.canvas.width = this.canvas.height = Math.floor(s * Math.min(devicePixelRatio, 1.5));
    this.canvas.style.width = this.canvas.style.height = s + 'px';
  }

  draw(gs) {
    if (!gs || !gs.city) return;
    const c = this.ctx, S = this.canvas.width;
    const W = gs.city.W, H = gs.city.H;
    const p = gs.player;

    // world->map: full view fits the district, corner view follows the player
    const span = this.full ? Math.max(W, H) : 46;
    const cx = this.full ? W / 2 : p.x;
    const cz = this.full ? H / 2 : p.z;
    const k = S / span;
    const tx = (wx) => (wx - cx) * k + S / 2;
    const tz = (wz) => (wz - cz) * k + S / 2;

    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(8,11,16,0.86)';
    c.fillRect(0, 0, S, S);

    // district bounds
    c.strokeStyle = '#3a424f'; c.lineWidth = 2;
    c.strokeRect(tx(0), tz(0), W * k, H * k);

    // buildings (cached per district — they never move)
    if (this.cacheFor !== gs.city) { this.cacheFor = gs.city; this.blockerCache = gs.city.blockers; }
    c.fillStyle = '#232a35';
    for (const b of this.blockerCache) {
      if ((b.top ?? 99) < 2) continue;                 // skip kerb clutter
      c.fillRect(tx(b.x - b.hw), tz(b.z - b.hh), b.hw * 2 * k, b.hh * 2 * k);
    }

    const dot = (x, z, r, color) => {
      c.fillStyle = color;
      c.beginPath(); c.arc(tx(x), tz(z), r, 0, 7); c.fill();
    };

    for (const k2 of gs.kits) dot(k2.x, k2.z, 2.5, '#40ff70');
    for (const pk of gs.powerPickups) dot(pk.x, pk.z, 2.5, '#c46aff');
    for (const b of gs.barrels) if (!b.dead) dot(b.x, b.z, 2, '#ff5a2a');
    for (const civ of gs.civs) if (!civ.turning) dot(civ.x, civ.z, 1.8, '#d9c9a8');
    for (const z of gs.zombies) dot(z.x, z.z, 2, '#49ff8c');
    for (const cop of gs.cops) dot(cop.x, cop.z, 2.4, cop.copType === 'military' ? '#9aa65b' : '#5b8dff');
    for (const v of gs.vehicles) dot(v.x, v.z, 3.2, v.vtype === 'heli' ? '#ffd77a' : '#ff3030');
    for (const h of gs.healers) {                       // medics pulse so they're findable
      const r = 3.5 + Math.sin(gs.time * 6) * 1.2;
      dot(h.x, h.z, r, '#6ac8ff');
    }

    // patient zero — arrow pointing along travel
    const a = Math.atan2(p.vx, p.vz);
    c.save();
    c.translate(tx(p.x), tz(p.z));
    c.rotate(-a + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(0, 2.5); c.lineTo(-4.5, 5); c.closePath(); c.fill();
    c.restore();

    if (this.full) {
      c.fillStyle = '#6b7280';
      c.font = '12px Consolas, monospace';
      c.fillText('TAB — close map', 10, S - 10);
    }
  }
}
