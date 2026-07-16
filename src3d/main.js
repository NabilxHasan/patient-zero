// 3D bootstrap: renderer, night city lighting, camera-follow, input, menu/end
// screens, and freeze-resilience (timer-loop fallback + pause overlay + error
// banner) — the same hardening the 2D build needed.
import * as THREE from 'three';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { LEVELS } from './levels.js';

// ---- error banner (surfaces crashes without the dev console) ----
function showFatal(label, detail) {
  const el = document.getElementById('fatal');
  el.textContent = '⚠ ' + label + '\n' + detail + '\n(screenshot this and send it over)';
  el.style.display = 'block';
}
addEventListener('error', e => showFatal('Script error: ' + (e.message || ''), (e.filename || '').split('/').pop() + ':' + e.lineno));
addEventListener('unhandledrejection', e => showFatal('Promise rejection', (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

// ---- renderer / scene / camera ----
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

// lights
scene.add(new THREE.HemisphereLight(0x9aabcc, 0x0c1018, 1.0));
const moon = new THREE.DirectionalLight(0xbcd0ff, 1.15);
moon.position.set(-20, 34, 14);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
const sc = moon.shadow.camera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.far = 120;
moon.shadow.bias = -0.0004;
scene.add(moon);
const moonTarget = new THREE.Object3D(); scene.add(moonTarget); moon.target = moonTarget;
// green light that travels with patient zero
const playerLight = new THREE.PointLight(0x49ff8c, 2.2, 14, 2);
scene.add(playerLight);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- input ----
const input = { W: false, A: false, S: false, D: false, lunge: false };
const codeMap = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', ArrowUp: 'W', ArrowLeft: 'A', ArrowDown: 'S', ArrowRight: 'D' };
addEventListener('keydown', e => {
  if (codeMap[e.code]) input[codeMap[e.code]] = true;
  if (e.code === 'Space') input.lunge = true;
  if (e.code === 'KeyM') { const m = AudioFX.toggleMute(); hud.setHeadline(m ? '[ AUDIO MUTED ]' : '[ AUDIO ON ]'); }
  if (e.code === 'KeyR' && game && !transitioning) restart();
  if (e.code === 'KeyZ') cycleZoom();
  if (paused) resume();
});
addEventListener('keyup', e => {
  if (codeMap[e.code]) input[codeMap[e.code]] = false;
  if (e.code === 'Space') input.lunge = false;
});

// ---- camera zoom ----
const ZOOMS = [1.35, 1.1, 0.9];
let zoomIdx = 1;
function cycleZoom() { zoomIdx = (zoomIdx + 1) % ZOOMS.length; if (hud) hud.setHeadline(`[ ZOOM ${ZOOMS[zoomIdx].toFixed(2)}x ]`); }

// ---- state ----
const hud = new HUD();
let game = null;
let shake = 0;
let transitioning = false;
const camPos = new THREE.Vector3();

function startGame(level) {
  clearScene();
  game = new Game(scene, level);
  game.start();
  hud.show();
  // snap camera behind player
  updateCamera(1);
  transitioning = false;
}

function clearScene() {
  if (game) {
    // remove everything except lights/camera helpers we keep
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c === moon || c === moonTarget || c === playerLight || c.isHemisphereLight) continue;
      scene.remove(c);
    }
  }
  game = null;
}

function restart() { transitioning = true; startGame(game.levelIndex); }

function updateCamera(lerp) {
  if (!game) return;
  const p = game.player;
  const z = ZOOMS[zoomIdx];
  const target = camPos.set(p.x, 15 * z, p.z + 12 * z);
  camera.position.lerp(target, lerp);
  const shx = (Math.random() - 0.5) * shake, shz = (Math.random() - 0.5) * shake;
  camera.lookAt(p.x + shx, 1.2, p.z + shz);
  playerLight.position.set(p.x, 3.7, p.z);
  moon.position.set(p.x - 20, 34, p.z + 14);
  moonTarget.position.set(p.x, 0, p.z);
}

// ---- message pump ----
function drainMessages() {
  if (!game) return;
  while (game.msgs.length) {
    const m = game.msgs.shift();
    if (m.type === 'headline') hud.setHeadline(m.text);
    else if (m.type === 'stinger') hud.showStinger(m.text);
    else if (m.type === 'flash') hud.flash();
    else if (m.type === 'shake') shake = Math.max(shake, m.amt);
    else if (m.type === 'level') hud.setLevel(m.name, m.intro);
    else if (m.type === 'end') { transitioning = true; setTimeout(() => showEnd(m), 1400); }
  }
}

// ---- main step ----
function step(dt) {
  if (game && !paused && !transitioning) {
    game.update(dt, input);
    drainMessages();
  }
  shake *= 0.86;
  updateCamera(paused ? 1 : 0.12);
  hud.tick(dt, game && !game.over ? game : game);
  renderer.render(scene, camera);
}

// ---- loop with hidden-tab fallback ----
let last = performance.now();
function frame() {
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  try { step(dt); } catch (e) { showFatal('Loop crash: ' + e.message, (e.stack || '').split('\n')[1] || ''); throw e; }
  schedule();
}
function schedule() { if (document.hidden) setTimeout(frame, 33); else requestAnimationFrame(frame); }

// ---- pause / resume ----
let paused = false;
const pauseEl = document.getElementById('pause');
function pause() { if (paused || !game) return; paused = true; pauseEl.style.display = 'flex'; }
function resume() { paused = false; pauseEl.style.display = 'none'; last = performance.now(); if (window.AudioFX) AudioFX.resume(); }
addEventListener('blur', pause);
addEventListener('focus', resume);
pauseEl.addEventListener('pointerdown', resume);

// ---- menu / end screens ----
function makeScreen(html) {
  const el = document.createElement('div');
  el.className = 'screen';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
function clearScreens() { document.querySelectorAll('.screen').forEach(s => s.remove()); }

function showMenu() {
  hud.hide();
  const el = makeScreen(`
    <div class="small">IUT 12th ICT FEST 2026 · GAMEJAM · THEME: KICKOFF</div>
    <h1>PATIENT ZERO</h1>
    <div class="tag">Every outbreak has a kickoff.</div>
    <div class="sub">You are the first infected. Touch civilians to spread the plague.<br>
    Every victim rises and hunts. The city sends police — then the army.<br>
    Overrun all three districts. If YOU fall, the outbreak dies with you.</div>
    <div class="keys">WASD / ARROWS — move &nbsp; SPACE — lunge &nbsp; Z — zoom &nbsp; M — mute &nbsp; R — restart</div>
    <button class="btn pulse" id="startBtn">[ CLICK TO BEGIN THE OUTBREAK ]</button>`);
  el.querySelector('#startBtn').onclick = () => { AudioFX.resume(); AudioFX.click(); clearScreens(); startGame(0); };
}

function showEnd(m) {
  const final = m.win && m.level === LEVELS.length - 1;
  let title, sub, bad = !m.win;
  if (final) { title = 'THE OUTBREAK HAS BEGUN'; sub = 'Three districts have fallen. What you kicked off can no longer be stopped.'; }
  else if (m.win) { title = 'DISTRICT FALLEN'; sub = 'The infection spreads to the next district.'; }
  else { title = 'PATIENT ZERO CONTAINED'; sub = 'The outbreak died with you. The city never learns how close it came.'; }
  const grade = m.seconds < 90 ? 'S' : m.seconds < 150 ? 'A' : m.seconds < 240 ? 'B' : 'C';
  const mm = String(Math.floor(m.seconds / 60)).padStart(2, '0'), ss = String(m.seconds % 60).padStart(2, '0');
  hud.hide();
  const el = makeScreen(`
    <h1 class="${bad ? 'bad' : ''}">${title}</h1>
    <div class="sub">${sub}</div>
    <div class="tag" style="font-size:18px;color:#6ee7a0;margin-top:14px">TIME ${mm}:${ss} &nbsp; INFECTED ${m.infected} &nbsp; RATING ${m.win ? grade : '—'}</div>
    <div id="btns"></div>`);
  const btns = el.querySelector('#btns');
  const add = (label, cb, pulse) => { const b = document.createElement('button'); b.className = 'btn' + (pulse ? ' pulse' : ''); b.textContent = `[ ${label} ]`; b.onclick = () => { AudioFX.click(); clearScreens(); cb(); }; btns.appendChild(b); btns.appendChild(document.createElement('br')); };
  if (final) { add('PLAY AGAIN', () => startGame(0), true); add('MAIN MENU', showMenu); }
  else if (m.win) { add('NEXT DISTRICT →', () => startGame(m.level + 1), true); add('MAIN MENU', showMenu); }
  else { add('TRY AGAIN', () => startGame(m.level), true); add('MAIN MENU', showMenu); }
}

// ---- debug hooks for verification ----
window.__scene = scene; window.__camera = camera; window.__renderer = renderer;
window.__render = () => renderer.render(scene, camera);
window.__game = () => game;
window.__startGame = startGame;
window.__step = step;

showMenu();
schedule();
console.log('Patient Zero 3D ready');
