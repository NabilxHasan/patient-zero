// DOM HUD controller — reads the game's message queue and reflects state.
export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.headline = document.getElementById('headline');
    this.districtName = document.getElementById('districtName');
    this.meterFill = document.getElementById('meterFill');
    this.meterPct = document.getElementById('meterPct');
    this.pips = document.getElementById('pips');
    this.lunge = document.getElementById('lunge');
    this.stats = document.getElementById('stats');
    this.stinger = document.getElementById('stinger');
    this.intro = document.getElementById('intro');
    this.flashEl = document.getElementById('flash');
    this.hlTarget = ''; this.hlShown = 0;
    this._pipCount = 0;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setLevel(name, intro) {
    this.districtName.textContent = name;
    this.intro.querySelector('.t').textContent = name;
    this.intro.querySelector('.s').textContent = intro;
    this.intro.style.opacity = '1';
    setTimeout(() => { this.intro.style.opacity = '0'; }, 2800);
  }

  setHeadline(text) { this.hlTarget = text; this.hlShown = 0; }

  showStinger(text) {
    this.stinger.textContent = text;
    this.stinger.style.transform = 'scale(1.3)';
    this.stinger.style.opacity = '1';
    requestAnimationFrame(() => { this.stinger.style.transform = 'scale(1)'; });
    clearTimeout(this._st);
    this._st = setTimeout(() => { this.stinger.style.opacity = '0'; }, 1700);
  }

  flash() {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = '0.4';
    requestAnimationFrame(() => { this.flashEl.style.transition = 'opacity 0.3s'; this.flashEl.style.opacity = '0'; });
  }

  tick(dt, gs) {
    // typewriter headline
    if (this.hlShown < this.hlTarget.length) {
      this.hlShown = Math.min(this.hlTarget.length, this.hlShown + dt * 55);
      this.headline.textContent = this.hlTarget.slice(0, Math.floor(this.hlShown)) + '▌';
    } else if (this.headline.textContent.endsWith('▌')) {
      this.headline.textContent = this.hlTarget;
    }
    if (!gs) return;
    const pct = Math.max(0, Math.min(1, gs.outbreak));
    this.meterFill.style.width = (pct * 100) + '%';
    this.meterFill.style.background = pct < 0.5 ? '#49ff8c' : (pct < 0.85 ? '#d8c877' : '#ff5b5b');
    this.meterPct.textContent = Math.round(pct * 100) + '% OVERRUN';

    if (this._pipCount !== gs.player.maxHp) {
      this.pips.innerHTML = '';
      for (let i = 0; i < gs.player.maxHp; i++) { const d = document.createElement('div'); d.className = 'pip'; this.pips.appendChild(d); }
      this._pipCount = gs.player.maxHp;
    }
    const kids = this.pips.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < gs.player.hp);
    this.lunge.style.width = ((1 - (gs.lungeCooldown || 0)) * 100) + '%';
    this.stats.textContent = `HORDE ${gs.zombies.length}   ·   RESPONDERS ${gs.cops.length}   ·   SURVIVORS ${Math.max(0, gs.aliveCivs)}`;
  }
}
