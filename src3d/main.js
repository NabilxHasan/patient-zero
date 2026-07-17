// 3D bootstrap: renderer, night city lighting, mouse-driven camera, input,
// menu/end/leaderboard screens, and freeze-resilience (timer fallback + pause
// overlay + error banner).
import * as THREE from 'three';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { LEVELS } from './levels.js';
import { loadUser, saveUser, addScore, topScores, loadProgress, saveProgress } from './scores.js';
import { Minimap } from './minimap.js';

function showFatal(label, detail) {
  const el = document.getElementById('fatal');
  el.textContent = '⚠ ' + label + '\n' + detail + '\n(screenshot this and send it over)';
  el.style.display = 'block';
}
addEventListener('error', e => showFatal('Script error: ' + (e.message || ''), (e.filename || '').split('/').pop() + ':' + e.lineno));
addEventListener('unhandledrejection', e => showFatal('Promise rejection', (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// A 2x pixel ratio renders 4x the fragments — on integrated GPUs that alone
// costs ~8ms/frame at 1080p. Stylized flat shading doesn't need it.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d15);
scene.fog = new THREE.Fog(0x090d15, 26, 62);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 300);

const hemi = new THREE.HemisphereLight(0x9aabcc, 0x27303f, 1.45);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x4a5668, 0.5);  // fill so night sides aren't pure black
scene.add(amb);
const moon = new THREE.DirectionalLight(0xbcd0ff, 1.15);
moon.position.set(-20, 34, 14);
moon.castShadow = true;
// Tightened: a 2048 map over a 80-unit frustum was re-rendering hundreds of
// casters each frame. 1024 over the visible area looks the same in motion.
moon.shadow.mapSize.set(1024, 1024);
const sc = moon.shadow.camera;
sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.far = 90;
moon.shadow.bias = -0.0004;
scene.add(moon);
const moonTarget = new THREE.Object3D(); scene.add(moonTarget); moon.target = moonTarget;
const playerLight = new THREE.PointLight(0x49ff8c, 2.2, 14, 2);
scene.add(playerLight);
// reusable explosion flash
const blastLight = new THREE.PointLight(0xffa040, 0, 26, 2);
scene.add(blastLight);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (typeof minimap !== 'undefined') minimap.resize();
});

// ---- input ----
const keys = { W: false, A: false, S: false, D: false };
const input = { mx: 0, mz: 0, lunge: false, jump: false };
let lastSpaceAt = -1;
const codeMap = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', ArrowUp: 'W', ArrowLeft: 'A', ArrowDown: 'S', ArrowRight: 'D' };
const POWER_KEYS = { Digit1: 'gas', Digit2: 'stun', Digit3: 'horde', Digit4: 'rage', Digit5: 'hulk' };
addEventListener('keydown', e => {
  // Escape always toggles the pause menu, even while paused.
  if (e.code === 'Escape') { e.preventDefault(); if (game && !transitioning) { paused ? resume() : pause(true); } return; }
  // focus-loss pause resumes on any key; the Escape menu only on Escape/buttons
  if (paused) { if (!pauseIsMenu) resume(); return; }
  if (codeMap[e.code]) keys[codeMap[e.code]] = true;
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    const now = performance.now();
    // First tap dashes immediately (delaying it to wait for a second tap would
    // make the dash feel laggy); a second tap inside the window jumps.
    if (now - lastSpaceAt < 300) { input.jump = true; }
    else { input.lunge = true; }
    lastSpaceAt = now;
  }
  if (e.code === 'Tab') { e.preventDefault(); minimap.toggleFull(); }
  if (POWER_KEYS[e.code] && game && !game.over) {
    const t = POWER_KEYS[e.code];
    if (game.usePower(t)) hud.firePower(t);
  }
  if (e.code === 'KeyM') { const m = AudioFX.toggleMute(); hud.setHeadline(m ? '[ AUDIO MUTED ]' : '[ AUDIO ON ]'); }
  if (e.code === 'KeyR' && game && !transitioning) restart();
  if (e.code === 'KeyZ') cycleZoom();
});
addEventListener('keyup', e => {
  if (codeMap[e.code]) keys[codeMap[e.code]] = false;
  if (e.code === 'Space') input.lunge = false;
});

// ---- mouse: right-click cycles camera, left-click strikes, wheel cycles powers ----
const CAM_MODES = ['top', 'tpp', 'fpp'];
let camMode = 0;
const app_ = document.getElementById('app');
app_.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousedown', e => {
  if (paused || !game || game.over) return;
  if (e.button === 2) {
    camMode = (camMode + 1) % CAM_MODES.length;
    hud.setHeadline(`[ CAMERA — ${CAM_MODES[camMode].toUpperCase()} ]`);
  } else if (e.button === 0) {
    if (!pointerLocked) { requestLock(); return; }   // first click captures
    game.strike();
  } else if (e.button === 1) {
    e.preventDefault();
    const t = hud.selectedPower();
    if (t && game.usePower(t)) hud.firePower(t);
  }
});
addEventListener('wheel', e => {
  if (paused || !game) return;
  hud.cyclePower(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ---- mouse look ----
// Pointer lock + relative movement, like GTA/FPS. The old build mapped the
// absolute cursor position to a bounded yaw, which is why it felt inverted and
// unfinished, and why the OS cursor sat on top of the game.
let camYaw = 0, targetYaw = 0;
let camPitch = 0, targetPitch = 0;          // radians; 0 = level, +up, -down
const MOUSE_SENS = 0.0011;
const PITCH_MIN = -0.55, PITCH_MAX = 1.15;
let invertY = false;
let pointerLocked = false;
const crosshair = document.getElementById('crosshair');
const lockHint = document.getElementById('lockHint');

function requestLock() {
  const el = renderer.domElement;
  if (!el.requestPointerLock) return;
  // Browsers reject this when it isn't user-gesture-initiated or the document
  // isn't focused, and it returns a promise in newer versions — swallow it or
  // the rejection surfaces as a fatal error banner. Click-to-capture covers it.
  try {
    const r = el.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* not available here */ }
}
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  crosshair.classList.toggle('on', pointerLocked);
  lockHint.classList.toggle('hidden2', pointerLocked || !game);
  // Escape releases the lock natively — treat that as opening the pause menu.
  if (!pointerLocked && game && !game.over && !transitioning && !paused) pause(true);
});
addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  // right = turn right (yaw decreases), down = look down
  targetYaw -= e.movementX * MOUSE_SENS;
  targetPitch += (invertY ? e.movementY : -e.movementY) * MOUSE_SENS;
  targetPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, targetPitch));
});

const ZOOMS = [1.35, 1.1, 0.9];
let zoomIdx = 1;
function cycleZoom() { zoomIdx = (zoomIdx + 1) % ZOOMS.length; if (hud) hud.setHeadline(`[ ZOOM ${ZOOMS[zoomIdx].toFixed(2)}x ]`); }

const hud = new HUD();
const minimap = new Minimap();
minimap.resize();
let game = null;
let shake = 0;
let transitioning = false;
const camPos = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function startGame(level) {
  clearScene();
  game = new Game(scene, level);
  game.start();
  hud.show();
  updateCamera(0, true);   // snap behind the player on spawn
  transitioning = false;
  lockHint.classList.remove('hidden2');
  requestLock();
}
function clearScene() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (c === moon || c === moonTarget || c === playerLight || c === blastLight || c === hemi || c === amb) continue;
    scene.remove(c);
  }
  game = null;
}
function restart() { transitioning = true; startGame(game.levelIndex); }

// Frame-rate independent exponential smoothing. A fixed per-frame lerp makes the
// camera feel different at every framerate and lurch whenever frames drop.
function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function updateCamera(dt, snap) {
  if (!game) return;
  const p = game.player;
  const z = ZOOMS[zoomIdx];
  camYaw = snap ? targetYaw : damp(camYaw, targetYaw, 18, dt);
  camPitch = snap ? targetPitch : damp(camPitch, targetPitch, 18, dt);
  const mode = CAM_MODES[camMode];
  const py = p.y || 0;
  const shx = (Math.random() - 0.5) * shake, shz = (Math.random() - 0.5) * shake;
  const scale = (game.playerScale || 1.15) / 1.15;

  // camera-forward from yaw+pitch (yaw 0 looks down -Z)
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  const fwd = _v3.set(-Math.sin(camYaw) * cp, sp, -Math.cos(camYaw) * cp);

  if (mode === 'fpp') {
    const eye = 1.55 * scale;
    camera.position.set(p.x, py + eye, p.z);
    camera.lookAt(p.x + fwd.x * 10 + shx, py + eye + fwd.y * 10, p.z + fwd.z * 10 + shz);
    p.mesh.visible = false;                  // don't render the inside of our own head
  } else {
    p.mesh.visible = true;
    const tpp = mode === 'tpp';
    // TPP sits behind the shoulder along -forward; top-down keeps the overhead
    // framing but still orbits with yaw.
    const dist = (tpp ? 6.0 * scale : 12) * z;
    const aim = py + (tpp ? 1.5 * scale : 1.2);
    let tx, ty, tz;
    if (tpp) {
      tx = p.x - fwd.x * dist;
      ty = aim - fwd.y * dist + 1.4 * scale;
      tz = p.z - fwd.z * dist;
    } else {
      const lift = 20 * z * (1 - camPitch * 0.35);
      tx = p.x + Math.sin(camYaw) * dist;
      ty = py + lift;
      tz = p.z + Math.cos(camYaw) * dist;
    }
    ty = Math.max(ty, py + 1.0);             // never clip through the deck
    if (snap) camera.position.set(tx, ty, tz);
    else {
      const rate = tpp ? 16 : 9;
      camera.position.x = damp(camera.position.x, tx, rate, dt);
      camera.position.y = damp(camera.position.y, ty, rate, dt);
      camera.position.z = damp(camera.position.z, tz, rate, dt);
    }
    camera.lookAt(p.x + shx, aim, p.z + shz);
  }
  playerLight.position.set(p.x, py + 3.7, p.z);
  moon.position.set(p.x - 20, 34, p.z + 14);
  moonTarget.position.set(p.x, 0, p.z);
}

// Movement is camera-relative so the controls stay intuitive as the view orbits.
function computeMove() {
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // camera-forward on the XZ plane
  const rx = -fz, rz = fx;                                // screen-right
  const fwd = (keys.W ? 1 : 0) - (keys.S ? 1 : 0);
  const str = (keys.D ? 1 : 0) - (keys.A ? 1 : 0);
  input.mx = fx * fwd + rx * str;
  input.mz = fz * fwd + rz * str;
}

function drainMessages() {
  if (!game) return;
  while (game.msgs.length) {
    const m = game.msgs.shift();
    if (m.type === 'headline') hud.setHeadline(m.text);
    else if (m.type === 'stinger') hud.showStinger(m.text);
    else if (m.type === 'flash') hud.flash();
    else if (m.type === 'shake') shake = Math.max(shake, m.amt);
    else if (m.type === 'level') hud.setLevel(m.name, m.intro);
    else if (m.type === 'blast') { blastLight.position.set(m.x, 2.5, m.z); blastLight.intensity = 90; }
    else if (m.type === 'end') { transitioning = true; setTimeout(() => showEnd(m), 1400); }
  }
}

function step(dt) {
  if (game && !paused && !transitioning) {
    computeMove();
    game.update(dt, input);
    input.jump = false;          // one-shot; consumed by this tick
    drainMessages();
  }
  const decay = Math.exp(-9 * dt);
  shake *= decay;
  blastLight.intensity *= decay;
  updateCamera(dt, false);
  hud.tick(dt, game);
  if (game) minimap.draw(game);
  renderer.render(scene, camera);
}

let last = performance.now();
function frame() {
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  try { step(dt); } catch (e) { showFatal('Loop crash: ' + e.message, (e.stack || '').split('\n')[1] || ''); throw e; }
  schedule();
}
function schedule() { if (document.hidden) setTimeout(frame, 33); else requestAnimationFrame(frame); }

let paused = false, pauseIsMenu = false;
const pauseEl = document.getElementById('pause');

// `menu` = deliberate pause (Escape) with options; otherwise it's a focus-loss
// pause that resumes on any interaction.
function pause(menu) {
  if (paused || !game || transitioning) return;
  if (document.pointerLockElement) document.exitPointerLock();
  paused = true; pauseIsMenu = !!menu;
  keys.W = keys.A = keys.S = keys.D = false; input.lunge = false;
  pauseEl.innerHTML = menu ? `
    <div>
      <div style="color:#49ff8c;font-size:46px;font-weight:bold;letter-spacing:3px;text-shadow:0 0 26px #1a7a44">PAUSED</div>
      <div id="pauseBtns" style="margin-top:18px"></div>
      <div class="keys" style="margin-top:18px;color:#4b5563;font-size:13px">
        WASD move · MOUSE look · SPACE dash · 1-4 powers · Z zoom · M mute · ESC resume
      </div>
    </div>` : `
    <div>
      <div style="color:#49ff8c;font-size:44px;font-weight:bold">PAUSED</div>
      <div style="color:#9ca3af;margin-top:12px">tab lost focus — click or press any key to resume</div>
    </div>`;
  pauseEl.style.display = 'flex';

  if (menu) {
    const holder = pauseEl.querySelector('#pauseBtns');
    const add = (label, cb, pulse) => {
      const b = document.createElement('button');
      b.className = 'btn' + (pulse ? ' pulse' : '');
      b.textContent = `[ ${label} ]`;
      b.onclick = (ev) => { ev.stopPropagation(); AudioFX.click(); cb(); };
      holder.appendChild(b); holder.appendChild(document.createElement('br'));
    };
    add('RESUME', resume, true);
    add('RESTART DISTRICT', () => { resume(); restart(); });
    add('MAIN MENU', () => { resume(); clearScene(); hud.hide(); showMenu(); });
  }
}

function resume() {
  paused = false; pauseIsMenu = false;
  pauseEl.style.display = 'none';
  if (game) requestLock();
  last = performance.now();
  if (window.AudioFX) AudioFX.resume();
}

addEventListener('blur', () => pause(false));
addEventListener('focus', () => { if (!pauseIsMenu) resume(); });   // don't nuke a deliberate pause
pauseEl.addEventListener('pointerdown', () => { if (!pauseIsMenu) resume(); });

// ---- screens ----
function makeScreen(html) {
  const el = document.createElement('div');
  el.className = 'screen';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
function clearScreens() { document.querySelectorAll('.screen').forEach(s => s.remove()); }

function boardHTML() {
  const rows = topScores(6);
  if (!rows.length) return '<div class="small" style="margin-top:10px">no runs recorded yet</div>';
  return '<table class="board"><tr><th>#</th><th>NAME</th><th>SCORE</th><th>DISTRICT</th></tr>' +
    rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHTML(r.name)}</td><td>${r.score}</td><td>${r.district}</td></tr>`).join('') +
    '</table>';
}
function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showMenu() {
  hud.hide();
  const user = loadUser();
  const el = makeScreen(`
    <div class="small">IUT 12th ICT FEST 2026 · GAMEJAM · THEME: KICKOFF</div>
    <h1>PATIENT ZERO</h1>
    <div class="tag">Every outbreak has a kickoff.</div>
    <div class="sub">You are the first infected. Touch civilians to spread the plague.<br>
    Every victim rises and hunts. The city sends police, armour, then gunships.<br>
    <b>DASH</b> is a takedown — it drops a responder outright.<br>
    Dash into red barrels to blow them apart; the blast never touches your kind.<br>
    Scavenge powers off the street and fire them with <b>1-4</b>.<br>
    Later districts send <b style="color:#6ac8ff">field medics</b> who cure your horde — put them down.</div>
    <div style="margin-top:14px">
      <label class="small">CODENAME&nbsp;</label>
      <input id="nameIn" maxlength="14" value="${escapeHTML(user)}" placeholder="patient zero">
    </div>
    <button class="btn pulse" id="startBtn">[ BEGIN THE OUTBREAK ]</button>
    <div class="keys">WASD move · MOUSE look · SPACE dash · SPACE×2 jump · LMB strike · RMB camera · WHEEL+MMB powers · 1-5 powers · TAB map · ESC pause</div>
    <div class="boardWrap">${boardHTML()}</div>`);
  const nameIn = el.querySelector('#nameIn');
  const go = (lvl) => {
    const n = (nameIn.value || '').trim() || 'PATIENT ZERO';
    saveUser(n);
    AudioFX.resume(); AudioFX.click();
    clearScreens(); startGame(lvl || 0);
  };
  el.querySelector('#startBtn').onclick = () => go(0);
  nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Enter') go(0); });

  // checkpoint: jump straight to any district already cleared
  const unlocked = loadProgress();
  if (unlocked > 0) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '4px';
    wrap.innerHTML = '<div class="small">CHECKPOINT — RESUME AT</div>';
    for (let i = 0; i <= unlocked && i < LEVELS.length; i++) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.fontSize = '15px';
      b.textContent = `[ DISTRICT ${i + 1} ]`;
      b.onclick = () => go(i);
      wrap.appendChild(b);
    }
    el.querySelector('#startBtn').insertAdjacentElement('afterend', wrap);
  }
}

function showEnd(m) {
  const final = m.win && m.level === LEVELS.length - 1;
  if (m.win) saveProgress(m.level + 1);   // checkpoint
  const name = loadUser();
  const score = m.infected * 10 + (m.kills || 0) * 5 + (m.win ? 500 : 0) + (m.win ? Math.max(0, 300 - m.seconds) : 0);
  addScore({ name, score, district: m.level + 1, seconds: m.seconds, infected: m.infected, win: m.win });

  let title, sub;
  if (final) { title = 'THE OUTBREAK HAS BEGUN'; sub = 'Three districts have fallen. What you kicked off can no longer be stopped.'; }
  else if (m.win) { title = 'DISTRICT FALLEN'; sub = 'The infection spreads to the next district.'; }
  else { title = 'PATIENT ZERO CONTAINED'; sub = 'The outbreak died with you. The city never learns how close it came.'; }
  const grade = m.seconds < 90 ? 'S' : m.seconds < 150 ? 'A' : m.seconds < 240 ? 'B' : 'C';
  const mm = String(Math.floor(m.seconds / 60)).padStart(2, '0'), ss = String(m.seconds % 60).padStart(2, '0');
  hud.hide();
  const el = makeScreen(`
    <h1 class="${m.win ? '' : 'bad'}">${title}</h1>
    <div class="sub">${sub}</div>
    <div class="tag" style="font-size:17px;color:#6ee7a0;margin-top:12px">
      ${escapeHTML(name)} &nbsp;·&nbsp; SCORE ${score} &nbsp;·&nbsp; TIME ${mm}:${ss} &nbsp;·&nbsp; INFECTED ${m.infected} &nbsp;·&nbsp; RATING ${m.win ? grade : '—'}</div>
    <div class="boardWrap">${boardHTML()}</div>
    <div id="btns"></div>`);
  const btns = el.querySelector('#btns');
  const add = (label, cb, pulse) => {
    const b = document.createElement('button');
    b.className = 'btn' + (pulse ? ' pulse' : '');
    b.textContent = `[ ${label} ]`;
    b.onclick = () => { AudioFX.click(); clearScreens(); cb(); };
    btns.appendChild(b); btns.appendChild(document.createElement('br'));
  };
  if (final) { add('PLAY AGAIN', () => startGame(0), true); add('MAIN MENU', showMenu); }
  else if (m.win) { add('NEXT DISTRICT →', () => startGame(m.level + 1), true); add('MAIN MENU', showMenu); }
  else { add('TRY AGAIN', () => startGame(m.level), true); add('MAIN MENU', showMenu); }
}

window.__scene = scene; window.__camera = camera; window.__renderer = renderer;
window.__render = () => renderer.render(scene, camera);
window.__game = () => game;
window.__startGame = startGame;
window.__step = step;
window.__setYaw = y => { targetYaw = camYaw = y; };

showMenu();
schedule();
console.log('Patient Zero 3D ready');
