// Local persistence for the player's codename and the highscore board.
// localStorage only — no server, no accounts, works offline and on itch.io.
const USER_KEY = 'pz3d_user';
const SCORE_KEY = 'pz3d_scores';

function safeGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
  catch { return fallback; }   // private mode / storage disabled
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* non-fatal */ }
}

export function loadUser() { return safeGet(USER_KEY, ''); }
export function saveUser(name) { safeSet(USER_KEY, String(name).slice(0, 14)); }

export function allScores() {
  try {
    const raw = safeGet(SCORE_KEY, '[]');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function addScore(entry) {
  const list = allScores();
  list.push({
    name: String(entry.name || 'PATIENT ZERO').slice(0, 14),
    score: Math.max(0, Math.round(entry.score) || 0),
    district: entry.district || 1,
    seconds: entry.seconds || 0,
    infected: entry.infected || 0,
    win: !!entry.win,
    at: Date.now(),
  });
  list.sort((a, b) => b.score - a.score);
  safeSet(SCORE_KEY, JSON.stringify(list.slice(0, 25)));
}

export function topScores(n = 6) { return allScores().slice(0, n); }
