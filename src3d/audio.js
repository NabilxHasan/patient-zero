// Procedural WebAudio SFX engine — zero audio assets, zero licensing worries.
const AudioFX = {
  ctx: null,
  master: null,
  muted: false,
  _noiseBuf: null,
  _nextBeat: 0,
  _droneNodes: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    // 1 second of white noise, reused by every noise-based effect
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  resume() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  },

  _tone(freq, freqEnd, dur, type, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  _noise(dur, filterType, freq, freqEnd, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },

  // --- one-shot effects ---
  infect()   { this._tone(280, 70, 0.25, 'sawtooth', 0.30); this._noise(0.16, 'lowpass', 700, 250, 0.25); },
  turn()     { this._tone(75, 52, 0.6, 'sawtooth', 0.22); this._tone(150, 100, 0.5, 'sine', 0.12, 0.08); },
  shot()     { this._noise(0.11, 'highpass', 900, 900, 0.30); this._tone(190, 55, 0.08, 'square', 0.18); },
  zdie()     { this._noise(0.3, 'lowpass', 900, 180, 0.32); this._tone(120, 40, 0.22, 'sine', 0.20); },
  hit()      { this._tone(130, 38, 0.22, 'square', 0.35); this._noise(0.12, 'lowpass', 500, 200, 0.30); },
  lunge()    { this._noise(0.18, 'bandpass', 380, 1600, 0.22); },
  copDown()  { this._tone(220, 60, 0.3, 'square', 0.2); this._noise(0.25, 'lowpass', 800, 200, 0.25); },
  click()    { this._tone(880, 660, 0.05, 'square', 0.12); },
  stinger()  { this._tone(52, 40, 0.9, 'sine', 0.5); this._noise(0.5, 'lowpass', 300, 80, 0.2); },
  win()      { [220, 277, 330, 440].forEach((f, i) => this._tone(f, f, 0.35, 'triangle', 0.2, i * 0.12)); },
  lose()     { [220, 185, 147, 110].forEach((f, i) => this._tone(f, f * 0.97, 0.5, 'sawtooth', 0.16, i * 0.18)); },

  siren() {
    for (let i = 0; i < 3; i++) {
      this._tone(620, 620, 0.16, 'triangle', 0.10, i * 0.32);
      this._tone(880, 880, 0.16, 'triangle', 0.10, i * 0.32 + 0.16);
    }
  },

  // Heartbeat that accelerates with the outbreak. Call from the game loop.
  heartbeat(outbreakPct) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now < this._nextBeat) return;
    const interval = 1.4 - outbreakPct * 0.9; // 1.4s calm -> 0.5s at full outbreak
    this._nextBeat = now + interval;
    const vol = 0.25 + outbreakPct * 0.25;
    this._tone(52, 40, 0.14, 'sine', vol);
    this._tone(48, 38, 0.12, 'sine', vol * 0.6, 0.16); // lub-dub
  },
};
