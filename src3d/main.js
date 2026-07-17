// 3D bootstrap: renderer, night city lighting, mouse-driven camera, input,
// menu/end/leaderboard screens, and freeze-resilience (timer fallback + pause
// overlay + error banner).
import * as THREE from 'three';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { LEVELS } from './levels.js';
import { loadUser, saveUser, addScore, topScores } from './scores.js';

function showFatal(label, detail) {
  const el = document.getElementById('fatal');
  el.textContent = '⚠ ' + label + '\n' + detail + '\n(screenshot this and send it over)';
  el.style.display = 'block';
}
addEventListener('error', e => showFatal('Script error: ' + (e.message || ''), (e.filename || '').split('/').pop() + ':' + e.lineno));
addEventListener('unhandledrejection', e => showFatal('Promise rejection', (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

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

const hemi = new THREE.HemisphereLight(0x9aabcc, 0x27303f, 1.45);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x4a5668, 0.5);  // fill so night sides aren't pure black
scene.add(amb);
const moon = new THREE.DirectionalLight(0xbcd0ff, 1.15);
moon.position.set(-20, 34, 14);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
const sc = moon.shadow.camera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.far = 120;
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
});

// ---- input ----
const keys = { W: false, A: false, S: false, D: false };
const input = { mx: 0, mz: 0, lunge: false };
const codeMap = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', ArrowUp: 'W', ArrowLeft: 'A', ArrowDown: 'S', ArrowRight: 'D' };
addEventListener('keydown', e => {
  if (codeMap[e.code]) keys[codeMap[e.code]] = true;
  if (e.code === 'Space') { input.lunge = true; e.preventDefault(); }
  if (e.code === 'KeyM') { const m = AudioFX.toggleMute(); hud.setHeadline(m ? '[ AUDIO MUTED ]' : '[ AUDIO ON ]'); }
  if (e.code === 'KeyR' && game && !transitioning) restart();
  if (e.code === 'KeyZ') cycleZoom();
  if (paused) resume();
});
addEventListener('keyup', e => {
  if (codeMap[e.code]) keys[codeMap[e.code]] = false;
  if (e.code === 'Space') input.lunge = false;
});

// ---- mouse look: orbits the camera around patient zero ----
let camYaw = 0, targetYaw = 0, camPitch = 1, targetPitch = 1;
addEventListener('mousemove', e => {
  const nx = (e.clientX / innerWidth - 0.5) * 2;    // -1 .. 1
  const ny = (e.clientY / innerHeight - 0.5) * 2;
  targetYaw = -nx * 1.0;
  targetPitch = 1 - ny * 0.35;
});

const ZOOMS = [1.35, 1.1, 0.9];
let zoomIdx = 1;
function cycleZoom() { zoomIdx = (zoomIdx + 1) % ZOOMS.length; if (hud) hud.setHeadline(`[ ZOOM ${ZOOMS[zoomIdx].toFixed(2)}x ]`); }

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
  updateCamera(1);
  transitioning = false;
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

function updateCamera(lerp) {
  if (!game) return;
  const p = game.player;
  const z = ZOOMS[zoomIdx];
  camYaw += (targetYaw - camYaw) * 0.08;
  camPitch += (targetPitch - camPitch) * 0.08;
  // Camera must clear the skyline — downtown towers reach ~12 units and will
  // occlude the player if the eye sits too low.
  const dist = 12 * z, height = 20 * z * camPitch;
  const target = camPos.set(p.x + Math.sin(camYaw) * dist, height, p.z + Math.cos(camYaw) * dist);
  camera.position.lerp(target, lerp);
  const shx = (Math.random() - 0.5) * shake, shz = (Math.random() - 0.5) * shake;
  camera.lookAt(p.x + shx, 1.2, p.z + shz);
  playerLight.position.set(p.x, 3.7, p.z);
  moon.position.set(p.x - 20, 34, p.z + 14);
  moonTarget.position.set(p.x, 0, p.z);
}

// Movement is camera-relative so the controls stay intuitive as the view orbits.
function computeMove() {
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // away from camera
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
    drainMessages();
  }
  shake *= 0.86;
  blastLight.intensity *= 0.86;
  updateCamera(paused ? 1 : 0.12);
  hud.tick(dt, game);
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

let paused = false;
const pauseEl = document.getElementById('pause');
function pause() { if (paused || !game) return; paused = true; pauseEl.style.display = 'flex'; }
function resume() { paused = false; pauseEl.style.display = 'none'; last = performance.now(); if (window.AudioFX) AudioFX.resume(); }
addEventListener('blur', pause);
addEventListener('focus', resume);
pauseEl.addEventListener('pointerdown', resume);

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
    Dash into red barrels to blow them apart — the blast never touches your kind.</div>
    <div style="margin-top:14px">
      <label class="small">CODENAME&nbsp;</label>
      <input id="nameIn" maxlength="14" value="${escapeHTML(user)}" placeholder="patient zero">
    </div>
    <button class="btn pulse" id="startBtn">[ BEGIN THE OUTBREAK ]</button>
    <div class="keys">WASD move · MOUSE look · SPACE dash · Z zoom · M mute · R restart</div>
    <div class="boardWrap">${boardHTML()}</div>`);
  const nameIn = el.querySelector('#nameIn');
  const go = () => {
    const n = (nameIn.value || '').trim() || 'PATIENT ZERO';
    saveUser(n);
    AudioFX.resume(); AudioFX.click();
    clearScreens(); startGame(0);
  };
  el.querySelector('#startBtn').onclick = go;
  nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Enter') go(); });
}

function showEnd(m) {
  const final = m.win && m.level === LEVELS.length - 1;
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
