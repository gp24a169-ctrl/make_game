'use strict';
// ============================================================
//  PRISM BARRAGE - original vertical bullet-hell shooter
// ============================================================
const W = 480, H = 720, TAU = Math.PI * 2;
// canvas = play field (W x H at FX,FY) + side panel
const CW = 800, CH = 760, FX = 24, FY = 20;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

// ---------------- utilities ----------------
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

// ---------------- difficulty ----------------
const DIFFS = [
  { name: 'EASY',    spd: 0.70, dens: 0.55, rate: 0.60, lives: 5, bombs: 3, mul: 0.5 },
  { name: 'NORMAL',  spd: 0.85, dens: 0.80, rate: 0.80, lives: 3, bombs: 3, mul: 1.0 },
  { name: 'HARD',    spd: 1.00, dens: 1.00, rate: 1.00, lives: 3, bombs: 2, mul: 1.5 },
  { name: 'INFERNO', spd: 1.12, dens: 1.30, rate: 1.25, lives: 2, bombs: 2, mul: 2.5 },
];
let D = DIFFS[1], diffIdx = 1;
const N = n => Math.max(1, Math.round(n * D.dens));            // density-scaled count
const iv = n => Math.max(1, Math.round(n / D.rate));            // rate-scaled interval
const ev = (t, n) => t % iv(n) === 0;

const STAGES = [
  { name: '夜霧の雲海',     bg: 'bg1', tint: '#0a1830' },
  { name: '星雲の回廊',     bg: 'bg2', tint: '#1a0a30' },
  { name: '燃える機械都市', bg: 'bg3', tint: '#300a0a' },
  { name: '虹光の異界',     bg: 'bg4', tint: '#151530' },
];

// ---------------- images ----------------
const IMG = {};
const IMG_LIST = ['player', 'enemy', 'boss1', 'boss2', 'boss3', 'boss4', 'bg1', 'bg2', 'bg3', 'bg4', 'title'];
function keyOut(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  try {
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    // remove magenta (#FF00FF) chroma background if present
    if (p[3] > 250 && p[0] > 170 && p[2] > 170 && p[1] < 100) {
      for (let i = 0; i < p.length; i += 4) {
        const m = Math.min(p[i], p[i + 2]) - p[i + 1];
        if (m > 110) p[i + 3] = 0;
        else if (m > 50) { p[i + 3] = Math.round(255 * (110 - m) / 60); p[i] = p[i + 2] = Math.min(p[i], p[i + 2], p[i + 1] + 50); }
      }
    }
    // trim transparent margins
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (p[(y * c.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    g.putImageData(d, 0, 0);
    if (x1 > x0 && y1 > y0) {
      const t = document.createElement('canvas');
      t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
      t.getContext('2d').drawImage(c, -x0, -y0);
      return t;
    }
  } catch (e) { /* file:// taint - use as is */ }
  return c;
}
function loadImages() {
  return Promise.all(IMG_LIST.map(n => new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG[n] = (n.startsWith('bg') || n === 'title') ? im : keyOut(im); res(); };
    im.onerror = () => res();
    im.src = 'assets/' + n + '.png';
  })));
}
function drawSprite(name, x, y, size, rot = 0, alpha = 1) {
  const im = IMG[name];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (im) {
    const w = im.width || im.naturalWidth, h = im.height || im.naturalHeight;
    const s = size / Math.max(w, h);
    ctx.drawImage(im, -w * s / 2, -h * s / 2, w * s, h * s);
  } else fallbackSprite(name, size);
  ctx.restore();
}
function fallbackSprite(name, s) {
  const r = s / 2;
  ctx.beginPath();
  if (name === 'player') {
    ctx.fillStyle = '#8ff'; ctx.moveTo(0, -r); ctx.lineTo(r * .8, r); ctx.lineTo(0, r * .5); ctx.lineTo(-r * .8, r);
  } else if (name === 'enemy') {
    ctx.fillStyle = '#f84'; ctx.moveTo(0, r); ctx.lineTo(r, -r * .6); ctx.lineTo(-r, -r * .6);
  } else {
    const cols = { boss1: '#4f8', boss2: '#a6f', boss3: '#f44', boss4: '#eef' };
    ctx.fillStyle = cols[name] || '#fff';
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = i % 2 ? r * .55 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  }
  ctx.closePath(); ctx.fill();
}

// ---------------- bullet sprite cache ----------------
const COLS = ['#ff3b5c', '#ff9a1f', '#ffe23d', '#4dff6e', '#36f0ff', '#4d6dff', '#c24dff', '#ffffff'];
const BT = { // visual radius, hit radius
  small: { vr: 5, hr: 2.5 },
  orb:   { vr: 8, hr: 4 },
  big:   { vr: 15, hr: 8.5 },
  rice:  { vr: 8, hr: 3 },
};
const BSPR = {};
function buildBulletSprites() {
  for (const type in BT) {
    BSPR[type] = COLS.map(col => {
      const vr = BT[type].vr, pad = 4;
      const c = document.createElement('canvas');
      c.width = c.height = (vr + pad) * 2;
      const g = c.getContext('2d');
      g.translate(vr + pad, vr + pad);
      if (type === 'rice') g.scale(1, 0.5);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, vr + pad);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#fff');
      gr.addColorStop(0.62, col); gr.addColorStop(0.85, col + '88'); gr.addColorStop(1, col + '00');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, vr + pad, 0, TAU); g.fill();
      return c;
    });
  }
}

// ---------------- audio ----------------
const AU = { ctx: null, master: null, sfxG: null, bgmG: null, muted: lsGet('pb_mute', '0') === '1', noise: null, last: {} };
function initAudio() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)();
    AU.ctx = A;
    AU.master = A.createGain(); AU.master.gain.value = AU.muted ? 0 : 0.6; AU.master.connect(A.destination);
    AU.sfxG = A.createGain(); AU.sfxG.gain.value = 0.7; AU.sfxG.connect(AU.master);
    AU.bgmG = A.createGain(); AU.bgmG.gain.value = 0.32; AU.bgmG.connect(AU.master);
    const buf = A.createBuffer(1, A.sampleRate, A.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AU.noise = buf;
    setInterval(bgmTick, 25);
  } catch (e) { AU.ctx = null; }
}
function toggleMute() {
  AU.muted = !AU.muted; lsSet('pb_mute', AU.muted ? '1' : '0');
  if (AU.master) AU.master.gain.value = AU.muted ? 0 : 0.6;
}
function tone(type, f0, f1, dur, vol, dest, when) {
  const A = AU.ctx; if (!A) return;
  const t = when || A.currentTime;
  const o = A.createOscillator(), g = A.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || AU.sfxG); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq, dest, when) {
  const A = AU.ctx; if (!A) return;
  const t = when || A.currentTime;
  const s = A.createBufferSource(); s.buffer = AU.noise;
  const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = A.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || AU.sfxG); s.start(t); s.stop(t + dur);
}
function sfx(n) {
  if (!AU.ctx) return;
  const now = AU.ctx.currentTime, gap = { shot: 0.07, graze: 0.04, hit: 0.05, item: 0.05, eshot: 0.06 }[n] || 0;
  if (gap && AU.last[n] && now - AU.last[n] < gap) return;
  AU.last[n] = now;
  switch (n) {
    case 'shot': tone('square', 1200, 600, 0.04, 0.025); break;
    case 'hit': tone('triangle', 320, 160, 0.04, 0.05); break;
    case 'eshot': tone('sine', 700, 500, 0.05, 0.03); break;
    case 'graze': tone('sine', 2200, 1800, 0.03, 0.05); break;
    case 'item': tone('sine', 1300, 1700, 0.05, 0.05); break;
    case 'explode': noise(0.35, 0.35, 3000); break;
    case 'bigexplode': noise(1.2, 0.6, 5000); tone('sawtooth', 200, 30, 1, 0.2); break;
    case 'die': tone('sawtooth', 900, 60, 0.6, 0.25); noise(0.6, 0.4, 4000); break;
    case 'bomb': noise(1.5, 0.5, 6000); tone('sine', 80, 400, 1.2, 0.3); break;
    case 'spell': tone('sawtooth', 200, 1600, 0.5, 0.12); tone('square', 300, 2400, 0.5, 0.06); break;
    case 'extend': [880, 1109, 1319, 1760].forEach((f, i) => tone('square', f, f, 0.12, 0.08, null, now + i * 0.08)); break;
    case 'select': tone('square', 880, 1320, 0.06, 0.06); break;
    case 'bonus': [660, 880, 1320].forEach((f, i) => tone('triangle', f, f, 0.15, 0.12, null, now + i * 0.1)); break;
  }
}
// ---- procedural BGM ----
const SONGS = {
  title: { bpm: 92,  root: 57, prog: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], lead: 'triangle' },
  s0:    { bpm: 140, root: 57, prog: [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], lead: 'square' },
  s1:    { bpm: 148, root: 62, prog: [[0, 3, 7], [-4, 0, 3], [-5, -2, 2], [-2, 2, 5]], lead: 'square' },
  s2:    { bpm: 158, root: 52, prog: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 5]], lead: 'sawtooth' },
  s3:    { bpm: 150, root: 60, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], lead: 'square' },
  boss:  { bpm: 168, root: 55, prog: [[0, 3, 7], [1, 4, 8], [-2, 3, 5], [-1, 2, 6]], lead: 'sawtooth' },
  boss4: { bpm: 176, root: 59, prog: [[0, 3, 7], [-4, 0, 3], [1, 5, 8], [-1, 2, 7]], lead: 'sawtooth' },
};
const BGM = { song: null, next: 0, step: 0 };
function playBgm(name) {
  BGM.song = SONGS[name] || null; BGM.step = 0;
  if (AU.ctx) BGM.next = AU.ctx.currentTime + 0.1;
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function bgmTick() {
  const A = AU.ctx, s = BGM.song; if (!A || !s) return;
  if (BGM.next < A.currentTime) BGM.next = A.currentTime + 0.05;
  const stepDur = 60 / s.bpm / 4;
  while (BGM.next < A.currentTime + 0.12) {
    const st = BGM.step, bar = Math.floor(st / 16) % s.prog.length, ch = s.prog[bar], i = st % 16, t = BGM.next;
    if (i % 4 === 0 || i === 10) tone('triangle', mtof(s.root - 24 + ch[0] + (i === 8 ? 12 : 0)), mtof(s.root - 24 + ch[0]), stepDur * 3, 0.28, AU.bgmG, t);
    const arp = ch[[0, 1, 2, 1, 0, 2, 1, 2][i % 8]] + (i >= 8 ? 12 : 0);
    tone(s.lead, mtof(s.root + arp), mtof(s.root + arp), stepDur * 0.9, s.lead === 'triangle' ? 0.09 : 0.035, AU.bgmG, t);
    if (s.bpm > 100) {
      if (i % 2 === 1) noise(0.03, 0.06, 9000, AU.bgmG, t);
      if (i % 8 === 4) noise(0.12, 0.18, 2500, AU.bgmG, t);
    }
    BGM.next += stepDur; BGM.step++;
  }
}

// ---------------- input ----------------
const K = { up: 0, down: 0, left: 0, right: 0, slow: 0, bomb: 0 };
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', ShiftLeft: 'slow', ShiftRight: 'slow', KeyX: 'bomb', Space: 'bomb',
};
addEventListener('keydown', e => {
  initAudio();
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (state === 'play') {
    if (KEYMAP[e.code]) { K[KEYMAP[e.code]] = 1; e.preventDefault(); }
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
    return;
  }
  // menu navigation
  const ov = document.querySelector('.ov.show'); if (!ov) return;
  const btns = [...ov.querySelectorAll('button')];
  const i = btns.indexOf(document.activeElement);
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
    e.preventDefault();
    const n = e.code === 'ArrowDown' ? 1 : -1;
    btns[(i + n + btns.length) % btns.length].focus(); sfx('select');
  } else if (e.code === 'KeyZ' || e.code === 'Enter') {
    e.preventDefault(); (btns[i] || btns[0]).click();
  } else if (e.code === 'KeyX' || e.code === 'Escape') {
    const back = ov.querySelector('[data-act=back],[data-act=resume]'); if (back) back.click();
  }
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) K[KEYMAP[e.code]] = 0; });
addEventListener('blur', () => { for (const k in K) K[k] = 0; if (state === 'play') pause(); });

// touch drag
const touch = { id: null, lx: 0, ly: 0, dx: 0, dy: 0 };
// mouse: ship follows the cursor
const mouse = { active: false, x: 0, y: 0 };
const isSlow = () => K.slow;
function mouseToField(e) {
  const r = cv.getBoundingClientRect(), sc = CW / r.width;
  mouse.x = (e.clientX - r.left) * sc - FX; mouse.y = (e.clientY - r.top) * sc - FY;
}
cv.addEventListener('pointerdown', e => {
  initAudio();
  if (e.pointerType === 'mouse') {
    mouseToField(e); mouse.active = true;
    return;
  }
  document.body.classList.add('is-touch');
  touch.id = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY;
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { mouseToField(e); mouse.active = true; return; }
  if (e.pointerId !== touch.id) return;
  const sc = CW / cv.getBoundingClientRect().width;
  touch.dx += (e.clientX - touch.lx) * sc * 1.3; touch.dy += (e.clientY - touch.ly) * sc * 1.3;
  touch.lx = e.clientX; touch.ly = e.clientY;
});
const endTouch = e => { if (e.pointerId === touch.id) touch.id = null; };
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch);
document.getElementById('btn-bomb').addEventListener('pointerdown', e => { e.preventDefault(); K.bomb = 1; setTimeout(() => K.bomb = 0, 100); });
document.getElementById('btn-pause').addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play') pause(); });

// ---------------- game state ----------------
let state = 'title';
let mode = 'story';       // 'story' | 'practice'
let stageIdx = 0;
let frame = 0, stageT = 0;
let score = 0, hiscore = 0, graze = 0;
let P, shots, bullets, enemies, items, parts, texts, tasks, boss, events, evIdx, bombT, shake, flash;
let stageInfo, clearDelay, overDelay, bgY, continues;
let missesInStage, bombsInStage;

function resetWorld() {
  shots = []; bullets = []; enemies = []; items = []; parts = []; texts = []; tasks = [];
  boss = null; bombT = 0; shake = 0; flash = 0; bgY = 0; clearDelay = 0; overDelay = 0;
}
function newPlayer(power) {
  P = { x: W / 2, y: H - 90, r: 2.5, inv: 120, power, lives: D.lives - 1, bombs: D.bombs, dead: 0 };
}
function startGame(m, sIdx) {
  mode = m; stageIdx = sIdx; score = 0; graze = 0; continues = 0;
  hiscore = +lsGet('pb_hi_' + diffIdx, 0);
  newPlayer(4);
  startStage(sIdx);
}
function startStage(s) {
  stageIdx = s; resetWorld();
  events = buildStage(s); evIdx = 0; stageT = 0;
  missesInStage = 0; bombsInStage = 0;
  P.x = W / 2; P.y = H - 90; P.inv = 120; P.bombs = Math.max(P.bombs, D.bombs);
  stageInfo = 240;
  setState('play'); playBgm('s' + s);
}
function setState(s) {
  state = s;
  document.querySelectorAll('.ov').forEach(o => o.classList.remove('show'));
  document.body.classList.toggle('playing', s === 'play');
  const map = { title: 'ov-title', diff: 'ov-diff', stage: 'ov-stage', howto: 'ov-howto', pause: 'ov-pause', over: 'ov-over', clear: 'ov-clear', ending: 'ov-ending' };
  if (map[s]) {
    const ov = document.getElementById(map[s]); ov.classList.add('show');
    const b = ov.querySelector('button'); if (b) setTimeout(() => b.focus(), 30);
  }
  if (s === 'title') { updateTitleHi(); playBgm('title'); }
}
function pause() { for (const k in K) K[k] = 0; setState('pause'); }
function updateTitleHi() {
  document.getElementById('title-hi').textContent = 'HIGH SCORE\n' +
    DIFFS.map((d, i) => d.name.padEnd(8, ' ') + ' ' + String(lsGet('pb_hi_' + i, 0)).padStart(10, '0')).join('\n');
}

// ---------------- spawning helpers ----------------
function later(d, fn) { tasks.push({ t: stageT + d, fn }); }
function shoot(x, y, a, s, o = {}) {
  if (bullets.length > 2500) return null;
  const type = o.spr || 'orb';
  const b = {
    x, y, a, s: s * D.spd, type, col: o.col ?? 0, hr: BT[type].hr,
    acc: (o.acc || 0) * D.spd, min: (o.min ?? -99) * D.spd, max: (o.max ?? 99) * D.spd,
    t: 0, fn: o.fn, grazed: false, dead: false,
  };
  bullets.push(b); return b;
}
function ring(x, y, n, a0, s, o) { for (let i = 0; i < n; i++) shoot(x, y, a0 + i * TAU / n, s, o); }
function fan(x, y, n, a, spread, s, o) {
  for (let i = 0; i < n; i++) shoot(x, y, a + (n > 1 ? (i - (n - 1) / 2) * spread : 0), s, o);
}
const aim = (x, y) => Math.atan2(P.y - y, P.x - x);

function enemy(o) {
  const e = Object.assign({ x: 0, y: -20, hp: 4, size: 40, r: 16, t: 0, vx: 0, vy: 2, drop: { p: 1, s: 1 }, flashT: 0 }, o);
  e.maxhp = e.hp; enemies.push(e); return e;
}
function explode(x, y, n, col, spd = 4) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU), s = rnd(0.5, spd);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(20, 45), max: 45, col, size: rnd(2, 5) });
  }
}
function dropItems(x, y, d) {
  for (let i = 0; i < (d.p || 0); i++) items.push({ x: x + rnd(-20, 20), y: y + rnd(-20, 20), vy: -2.5, type: 'p', mag: false });
  for (let i = 0; i < (d.s || 0); i++) items.push({ x: x + rnd(-20, 20), y: y + rnd(-20, 20), vy: -2.5, type: 's', mag: false });
  if (d.b) items.push({ x, y, vy: -3, type: 'b', mag: false });
  if (d.l) items.push({ x, y, vy: -3, type: 'l', mag: false });
}
function cancelBullets(toItems) {
  for (const b of bullets) {
    if (toItems) items.push({ x: b.x, y: b.y, vy: 0, type: 'c', mag: true });
    parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 12, max: 12, col: COLS[b.col], size: 6 });
  }
  bullets.length = 0;
}
function popText(x, y, text, col = '#fff', life = 60, big = false) { texts.push({ x, y, text, col, life, max: life, big }); }

// ---------------- stage timeline (boss battle only) ----------------
function buildStage(s) {
  return [[200, () => 'boss']];
}

// ---------------- bosses (all bullets travel in straight lines) ----------------
function wander(b, t, every) {
  if (t % every === 0) { b.tx = clamp(b.x + rnd(-110, 110), 90, W - 90); b.ty = rnd(110, 190); }
}
function center(b) { b.tx = W / 2; b.ty = 170; }

const BOSSES = [
  { name: '翠晶獣 ヴェルディア', spr: 'boss1', col: 3, phases: [
    { hp: 600, time: 30, fn(b, t) {
      wander(b, t, 150);
      if (ev(t, 40)) { ring(b.x, b.y, N(18), t * 0.05, 2.2, { spr: 'orb', col: 3 }); sfx('eshot'); }
      if (ev(t, 90)) fan(b.x, b.y, N(5), aim(b.x, b.y), 0.2, 3, { spr: 'rice', col: 4 });
    } },
    { hp: 800, time: 40, spell: '結晶符「エメラルドレイン」', fn(b, t) {
      center(b);
      if (ev(t, 5)) { const n = Math.max(2, N(3)); for (let k = 0; k < n; k++) { shoot(b.x, b.y, t * 0.13 + k * TAU / n, 2.4, { spr: 'rice', col: 3 }); shoot(b.x, b.y, -t * 0.13 + k * TAU / n, 2.4, { spr: 'rice', col: 4 }); } }
      if (ev(t, 70)) { fan(b.x, b.y, 3, aim(b.x, b.y), 0.35, 2.6, { spr: 'big', col: 2 }); sfx('eshot'); }
    } },
    { hp: 700, time: 35, fn(b, t) {
      wander(b, t, 120);
      if (ev(t, 30)) { const a = aim(b.x, b.y); for (let k = 0; k < 4; k++) fan(b.x, b.y, N(7), a, 0.14, 2 + k * 0.6, { spr: 'small', col: 4 }); sfx('eshot'); }
    } },
    { hp: 900, time: 45, spell: '結晶符「フラクタルブルーム」', fn(b, t) {
      wander(b, t, 240);
      if (ev(t, 8)) { const n = N(5); for (let k = 0; k < n; k++) { shoot(b.x, b.y, t * 0.03 + k * TAU / n, 1.8, { spr: 'orb', col: 3 }); shoot(b.x, b.y, -t * 0.03 + k * TAU / n, 1.8, { spr: 'orb', col: 2 }); } }
      if (ev(t, 120)) { ring(b.x, b.y, N(24), rnd(0, TAU), 0.8, { spr: 'small', col: 7, acc: 0.025, max: 3 }); sfx('eshot'); }
    } },
  ] },
  { name: '紫金要塞 アルカディオ', spr: 'boss2', col: 6, phases: [
    { hp: 700, time: 30, fn(b, t) {
      wander(b, t, 180);
      if (ev(t, 25)) { fan(b.x, b.y, N(5), aim(b.x, b.y) + Math.sin(t / 40) * 0.6, 0.18, 3.2, { spr: 'rice', col: 6 }); sfx('eshot'); }
      if (ev(t, 80)) ring(b.x, b.y, N(20), rnd(0, TAU), 2, { spr: 'orb', col: 2 });
    } },
    { hp: 900, time: 45, spell: '要塞符「ギャラクシーアーム」', fn(b, t) {
      center(b);
      if (ev(t, 4)) {
        const n = Math.max(2, N(4)), sw = Math.sin(t / 50) * 1.5;
        for (let k = 0; k < n; k++) {
          shoot(b.x, b.y, t * 0.05 + sw + k * TAU / n, 2.2, { spr: 'orb', col: 6 });
          shoot(b.x, b.y, -t * 0.05 - sw + k * TAU / n, 1.7, { spr: 'small', col: 2 });
        }
      }
    } },
    { hp: 800, time: 35, fn(b, t) {
      wander(b, t, 100);
      if (ev(t, 6)) shoot(b.x, b.y, aim(b.x, b.y) + rnd(-0.5, 0.5), rnd(2.5, 4), { spr: 'rice', col: 2 });
      if (ev(t, 60)) { ring(b.x, b.y, N(32), rnd(0, TAU), 1.5, { spr: 'small', col: 6 }); sfx('eshot'); }
    } },
    { hp: 1000, time: 45, spell: '要塞符「ストップアンドゴー」', fn(b, t) {
      wander(b, t, 200);
      // rings that brake, hover, then accelerate again along the same straight line
      if (ev(t, 50)) {
        ring(b.x, b.y, N(28), rnd(0, TAU), 3.2, { spr: 'orb', col: 5, acc: -0.08, min: 0, fn: q => {
          if (q.t === 60) { q.acc = 0.05 * D.spd; q.max = 3.4 * D.spd; q.col = 0; }
        } });
        sfx('eshot');
      }
      if (ev(t, 35)) shoot(b.x, b.y, aim(b.x, b.y), 2.2, { spr: 'big', col: 2 });
    } },
  ] },
  { name: '紅蓮核艦 ザルグレイヴ', spr: 'boss3', col: 0, phases: [
    { hp: 800, time: 30, fn(b, t) {
      wander(b, t, 160);
      if (ev(t, 3) && Math.random() < 0.85) shoot(rnd(0, W), -8, Math.PI / 2 + rnd(-0.25, 0.25), rnd(1.4, 2.8), { spr: 'small', col: 0 });
      if (ev(t, 60)) { fan(b.x, b.y, 3, aim(b.x, b.y), 0.3, 2.6, { spr: 'big', col: 1 }); sfx('eshot'); }
    } },
    { hp: 1000, time: 45, spell: '紅核「ブラッドウェーブ」', fn(b, t) {
      wander(b, t, 220);
      if (ev(t, 14)) {
        const sg = (Math.floor(t / iv(14)) % 2) ? 1 : -1, n = N(22);
        ring(b.x, b.y, n, sg > 0 ? 0 : Math.PI / n, 2.4, { spr: 'rice', col: sg > 0 ? 0 : 1 });
        sfx('eshot');
      }
      if (ev(t, 45)) fan(b.x, b.y, 3, aim(b.x, b.y), 0.12, 3.4, { spr: 'orb', col: 7 });
    } },
    { hp: 1100, time: 45, spell: '紅核「スウィープストリーム」', fn(b, t) {
      center(b);
      if (ev(t, 3)) {
        const n = N(6), base = Math.PI / 2 + Math.sin(t / 70) * 1.2;
        for (let k = 0; k < n; k++) shoot(b.x, b.y, base + (k - (n - 1) / 2) * (2.6 / n), 4, { spr: 'small', col: 1 });
      }
      if (ev(t, 50)) { ring(b.x, b.y, N(16), rnd(0, TAU), 1.6, { spr: 'orb', col: 0 }); sfx('eshot'); }
    } },
    { hp: 1200, time: 50, spell: '紅核「メルトダウン」', fn(b, t) {
      wander(b, t, 200);
      if (ev(t, 6)) for (let k = 0; k < 2; k++) shoot(b.x, b.y, t * 0.09 + k * Math.PI, 2, { spr: 'orb', col: 0 });
      if (ev(t, 40)) {
        for (let k = 0; k < N(3); k++) {
          const sx = Math.random() < 0.5 ? 0 : W, sy = rnd(80, H - 160);
          shoot(sx, sy, aim(sx, sy), 2.2, { spr: 'rice', col: 1 });
        }
        sfx('eshot');
      }
    } },
  ] },
  { name: '虹輪天機 セラフィム', spr: 'boss4', col: 7, phases: [
    { hp: 900, time: 35, fn(b, t) {
      wander(b, t, 160);
      if (ev(t, 18)) { ring(b.x, b.y, N(20), t * 2.39996, 2.3, { spr: 'orb', col: (t / iv(18) | 0) % 7 }); sfx('eshot'); }
    } },
    { hp: 1100, time: 45, spell: '天輪「プリズムスプリット」', fn(b, t) {
      wander(b, t, 210);
      if (ev(t, 70)) {
        ring(b.x, b.y, N(10), rnd(0, TAU), 3, { spr: 'big', col: 7, acc: -0.05, min: 0.5, fn: q => {
          if (q.t === 55) { q.dead = true; ring(q.x, q.y, N(8), rnd(0, TAU), 1.8, { spr: 'small', col: (Math.random() * 7) | 0 }); }
        } });
        sfx('eshot');
      }
    } },
    { hp: 1200, time: 50, spell: '天輪「レインボーヘリックス」', fn(b, t) {
      center(b);
      if (ev(t, 5)) { const n = N(7); for (let k = 0; k < n; k++) shoot(b.x, b.y, t * 0.045 + k * TAU / n, 1.1, { spr: 'rice', col: k % 7, acc: 0.03, max: 3.4 }); }
      if (ev(t, 9)) { const n = N(5); for (let k = 0; k < n; k++) shoot(b.x, b.y, -t * 0.03 + k * TAU / n, 1.8, { spr: 'small', col: 7 }); }
    } },
    { hp: 1300, time: 50, spell: '天輪「クロスレイン」', fn(b, t) {
      wander(b, t, 180);
      if (ev(t, 4)) { const x = rnd(0, W); shoot(x, -8, Math.PI / 2 + 0.35, 2.4, { spr: 'rice', col: 4 }); shoot(W - x, -8, Math.PI / 2 - 0.35, 2.4, { spr: 'rice', col: 6 }); }
      if (ev(t, 40)) { fan(b.x, b.y, N(3), aim(b.x, b.y), 0.25, 2.8, { spr: 'big', col: 2 }); sfx('eshot'); }
    } },
    { hp: 1500, time: 60, spell: '終天「ラストジャッジメント」', fn(b, t) {
      wander(b, t, 240);
      if (ev(t, 30)) { ring(b.x, b.y, N(30), rnd(0, TAU), 2, { spr: 'orb', col: (t / 30 | 0) % 7 }); sfx('eshot'); }
      if (ev(t, 22)) fan(b.x, b.y, N(5), aim(b.x, b.y), 0.15, 3.5, { spr: 'rice', col: 7 });
      if (ev(t, 90)) ring(b.x, b.y, N(16), rnd(0, TAU), 1.2, { spr: 'big', col: 6 });
    } },
  ] },
];

function startBoss(s) {
  const def = BOSSES[s];
  boss = { def, x: W / 2, y: -120, tx: W / 2, ty: 160, pi: -1, hp: 1, maxhp: 1, pt: 0, time: 0, wait: 0, bonus: true, dying: 0, hitT: 0 };
  popText(W / 2, 260, def.name, COLS[def.col], 150, true);
  playBgm(s === 3 ? 'boss4' : 'boss');
  nextPhase();
}
function nextPhase() {
  const b = boss;
  if (b.pi >= 0) {
    const ph = b.def.phases[b.pi];
    if (ph.spell) {
      if (b.bonus && b.time > 0) {
        const bonus = Math.round((ph.hp * 50 + b.time * 20) * D.mul / 10) * 10;
        score += bonus; popText(W / 2, 200, 'SPELL BONUS  +' + bonus, '#ff8', 120, true); sfx('bonus');
      } else popText(W / 2, 200, 'BONUS FAILED', '#f88', 90);
    }
    cancelBullets(true);
    dropItems(b.x, b.y, { p: 6, s: 6 });
  }
  b.pi++;
  if (b.pi >= b.def.phases.length) {
    b.dying = 1; sfx('bigexplode'); flash = 30; shake = 30;
    explode(b.x, b.y, 120, COLS[b.def.col], 8);
    dropItems(b.x, b.y, { p: 10, s: 16, b: 1, l: (stageIdx === 1 || stageIdx === 2) ? 1 : 0 });
    score += Math.round(1000000 * (stageIdx + 1) * D.mul / 10) * 10;
    return;
  }
  const ph = b.def.phases[b.pi];
  b.hp = b.maxhp = ph.hp; b.pt = 0; b.time = ph.time * 60; b.wait = 70; b.bonus = true;
  b.tx = W / 2; b.ty = 160;
  b.cutin = 0;
  if (ph.spell) { sfx('spell'); flash = 10; b.cutin = 100; }
}
function updateBoss() {
  const b = boss;
  if (b.dying) {
    b.dying++;
    if (b.dying % 6 === 0 && b.dying < 90) explode(b.x + rnd(-50, 50), b.y + rnd(-50, 50), 20, COLS[b.def.col], 5);
    if (b.dying === 90) { boss = null; clearDelay = 180; }
    return;
  }
  b.x += (b.tx - b.x) * 0.04; b.y += (b.ty - b.y) * 0.04;
  if (b.hitT > 0) b.hitT--;
  if (b.cutin > 0) b.cutin--;
  if (b.wait > 0) { b.wait--; return; }
  b.pt++; b.time--;
  b.def.phases[b.pi].fn(b, b.pt);
  if (b.time <= 0) { b.bonus = false; b.time = 0; nextPhase(); }
}

// ---------------- player ----------------
function updatePlayer() {
  if (P.dead > 0) {
    P.dead--;
    if (P.dead === 0) {
      if (P.lives < 0) { overDelay = 1; return; }
      P.x = W / 2; P.y = H - 90; P.inv = 200;
    }
    return;
  }
  let dx = K.right - K.left, dy = K.down - K.up;
  if (dx || dy) mouse.active = false;           // keyboard takes over until the mouse moves again
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  const sp = isSlow() ? 1.9 : 4.4;
  P.x += dx * sp + touch.dx; P.y += dy * sp + touch.dy;
  if (mouse.active) {
    // move toward the cursor, capped per frame (fast normally, precise while focused)
    const mx = mouse.x - P.x, my = mouse.y - P.y, d = Math.hypot(mx, my), cap = isSlow() ? 2.5 : 9;
    if (d > 0.5) { const k = Math.min(1, cap / d); P.x += mx * k; P.y += my * k; }
  }
  touch.dx = touch.dy = 0;
  P.x = clamp(P.x, 12, W - 12); P.y = clamp(P.y, 24, H - 20);
  if (P.inv > 0) P.inv--;

  // fire
  // single straight stream from the ship's nose; power raises damage, not shot count
  if (frame % 3 === 0) {
    shots.push({ x: P.x, y: P.y - 18, vx: 0, vy: -16, dmg: 1.5 * P.power });
    sfx('shot');
  }
  // bomb
  if (K.bomb && bombT <= 0 && P.bombs > 0) {
    K.bomb = 0; P.bombs--; bombsInStage++; bombT = 160; P.inv = Math.max(P.inv, 200);
    if (boss) boss.bonus = false;
    sfx('bomb'); flash = 20; shake = 20;
  }
}
function killPlayer() {
  sfx('die'); explode(P.x, P.y, 60, '#8ff', 6); shake = 20;
  P.dead = 50; P.lives--; missesInStage++;
  if (boss) boss.bonus = false;
  const lost = Math.min(P.power - 1, 0.6);
  P.power -= lost;
  for (let i = 0; i < 5; i++) items.push({ x: P.x + rnd(-40, 40), y: P.y - rnd(20, 60), vy: -4, type: 'p', mag: false });
  P.bombs = Math.max(P.bombs, D.bombs);
  cancelBullets(false);
}

// ---------------- main update ----------------
function update() {
  frame++;
  if (stageInfo > 0) stageInfo--;
  if (shake > 0) shake--;
  if (flash > 0) flash--;
  bgY += boss ? 0.6 : 1.2;

  // stage timeline
  stageT++;
  while (evIdx < events.length && events[evIdx][0] <= stageT) {
    const r = events[evIdx][1]();
    if (r === 'boss') { if (enemies.length > 0 && stageT < events[evIdx][0] + 400) break; startBoss(stageIdx); }
    evIdx++;
  }
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].t <= stageT) { const f = tasks[i].fn; tasks.splice(i, 1); f(); }

  updatePlayer();
  if (overDelay) return gameOver();

  // shots
  for (const s of shots) {
    s.x += s.vx; s.y += s.vy;
    if (s.y < -20 || s.x < -20 || s.x > W + 20 || s.y > H + 20) s.dead = true;
  }
  // enemies
  for (const e of enemies) {
    e.t++; if (e.flashT > 0) e.flashT--;
    if (e.move) e.move(e); else { e.x += e.vx; e.y += e.vy; }
    if (e.fire && P.dead === 0 && bombT <= 0) e.fire(e);
    if (e.t > 30 && (e.y > H + 50 || e.y < -80 || e.x < -60 || e.x > W + 60)) e.gone = true;
  }
  // shot collisions
  for (const s of shots) {
    if (s.dead) continue;
    for (const e of enemies) {
      if (e.hp <= 0 || e.y < -10) continue;
      const dx = s.x - e.x, dy = s.y - e.y;
      if (dx * dx + dy * dy < (e.r + 6) * (e.r + 6)) { s.dead = true; e.hp -= s.dmg; e.flashT = 3; sfx('hit'); break; }
    }
    if (!s.dead && boss && !boss.dying && boss.wait <= 0 && boss.y > 0) {
      const dx = s.x - boss.x, dy = s.y - boss.y;
      if (dx * dx + dy * dy < 50 * 50) { s.dead = true; boss.hp -= s.dmg; boss.hitT = 3; score += 10; sfx('hit'); }
    }
  }
  if (bombT > 0) {
    bombT--;
    for (const e of enemies) e.hp -= 1.5;
    if (boss && !boss.dying && boss.wait <= 0) boss.hp -= 1.4;
    cancelBullets(true);
  }
  for (const e of enemies) {
    if (e.hp <= 0 && !e.gone) {
      e.gone = true; score += e.maxhp * 100; sfx('explode');
      explode(e.x, e.y, e.maxhp > 30 ? 40 : 14, '#fa6', e.maxhp > 30 ? 6 : 3);
      dropItems(e.x, e.y, e.drop);
    }
  }
  if (boss) { if (!boss.dying && boss.hp <= 0) nextPhase(); updateBoss(); }

  // bullets
  const pr = P.r;
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (b.dead) continue;
    b.t++;
    b.s += b.acc; if (b.s < b.min) b.s = b.min; if (b.s > b.max) b.s = b.max;
    b.x += Math.cos(b.a) * b.s; b.y += Math.sin(b.a) * b.s;
    if (b.fn) b.fn(b);
    if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.dead = true; continue; }
    if (P.dead === 0) {
      const dx = b.x - P.x, dy = b.y - P.y, d2 = dx * dx + dy * dy;
      const hr = b.hr + pr;
      if (d2 < hr * hr) {
        if (P.inv <= 0) { killPlayer(); break; }
      } else if (!b.grazed && d2 < (hr + 16) * (hr + 16)) {
        b.grazed = true; graze++; score += 500; sfx('graze');
        parts.push({ x: (b.x + P.x) / 2, y: (b.y + P.y) / 2, vx: rnd(-2, 2), vy: rnd(-2, 2), life: 12, max: 12, col: '#fff', size: 2 });
      }
    }
  }
  // items
  const poc = P.y < 200 && P.dead === 0;
  for (const it of items) {
    if (poc || bombT > 0) it.mag = true;
    if (it.mag && P.dead === 0) {
      const a = Math.atan2(P.y - it.y, P.x - it.x);
      it.x += Math.cos(a) * 9; it.y += Math.sin(a) * 9;
    } else { it.vy = Math.min(it.vy + 0.06, 2.2); it.y += it.vy; }
    const dx = it.x - P.x, dy = it.y - P.y;
    if (P.dead === 0 && dx * dx + dy * dy < 30 * 30) { it.got = true; collect(it, poc); }
    if (it.y > H + 20) it.got = true;
  }
  // particles / texts
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life--; }
  for (const t of texts) { t.life--; t.y -= t.big ? 0 : 0.5; }

  shots = shots.filter(s => !s.dead);
  enemies = enemies.filter(e => !e.gone);
  bullets = bullets.filter(b => !b.dead);
  items = items.filter(i => !i.got);
  parts = parts.filter(p => p.life > 0);
  texts = texts.filter(t => t.life > 0);
  if (score > hiscore) hiscore = score;

  if (clearDelay > 0 && --clearDelay === 0) stageClear();
}
function collect(it, poc) {
  switch (it.type) {
    case 'p': if (P.power < 4) { P.power = Math.min(4, P.power + 0.05); if (P.power >= 4) { popText(P.x, P.y - 30, 'FULL POWER', '#ff8'); cancelBullets(true); } } score += 100; break;
    case 's': { const v = poc ? 10000 : Math.round(clamp(10000 - (it.y - 200) * 15, 1000, 10000) / 10) * 10; score += v; if (v >= 10000) popText(it.x, it.y, '10000', '#ff8', 30); break; }
    case 'c': score += 100; break;
    case 'b': P.bombs = Math.min(8, P.bombs + 1); popText(P.x, P.y - 30, 'BOMB +1', '#8f8'); sfx('extend'); break;
    case 'l': P.lives = Math.min(8, P.lives + 1); popText(P.x, P.y - 30, 'EXTEND!', '#f8f'); sfx('extend'); break;
  }
  if (it.type !== 'c') sfx('item');
}

function saveHi() { if (score > +lsGet('pb_hi_' + diffIdx, 0)) lsSet('pb_hi_' + diffIdx, score); }
function stageClear() {
  const clearBonus = Math.round((stageIdx + 1) * 500000 * D.mul / 10) * 10;
  const nomiss = missesInStage === 0 ? Math.round(2000000 * D.mul / 10) * 10 : 0;
  const nobomb = bombsInStage === 0 ? Math.round(1000000 * D.mul / 10) * 10 : 0;
  score += clearBonus + nomiss + nobomb;
  saveHi();
  const lines = [
    `STAGE ${stageIdx + 1}  ${STAGES[stageIdx].name}`, '',
    `クリアボーナス   ${clearBonus.toLocaleString()}`,
    `ノーミス         ${nomiss ? nomiss.toLocaleString() : '-'}`,
    `ノーボム         ${nobomb ? nobomb.toLocaleString() : '-'}`,
    `グレイズ累計     ${graze}`, '',
    `SCORE  ${score.toLocaleString()}`,
  ];
  if (mode === 'story' && stageIdx === STAGES.length - 1) {
    document.getElementById('ending-text').textContent =
      `難易度 ${D.name}\n全4ステージ制覇！\n\nFINAL SCORE\n${score.toLocaleString()}\nコンティニュー ${continues} 回\n\nHIGH SCORE ${(+lsGet('pb_hi_' + diffIdx, 0)).toLocaleString()}`;
    setState('ending'); playBgm('title'); return;
  }
  document.getElementById('clear-text').textContent = lines.join('\n');
  document.getElementById('clear-btn').textContent = mode === 'story' ? '次のステージへ' : 'タイトルへ';
  setState('clear'); playBgm(null);
}
function gameOver() {
  overDelay = 0; saveHi();
  document.getElementById('over-text').textContent = `難易度 ${D.name}\nSTAGE ${stageIdx + 1} で力尽きた…\n\nSCORE ${score.toLocaleString()}\n\n※コンティニューするとスコアは 0 に戻ります`;
  setState('over'); playBgm(null);
}

// ---------------- rendering ----------------
let starfield = null;
function drawBg() {
  const st = STAGES[stageIdx], im = IMG[st.bg];
  if (im) {
    const h = W * im.naturalHeight / im.naturalWidth;
    // tile pairs (normal + vertically mirrored) so the seam is always continuous
    for (let y = (bgY % (h * 2)) - h * 2; y - h < H; y += h * 2) {
      ctx.drawImage(im, 0, y, W, h);
      ctx.save(); ctx.translate(0, y); ctx.scale(1, -1); ctx.drawImage(im, 0, 0, W, h); ctx.restore();
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, st.tint); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // stars parallax
  if (!starfield) starfield = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, H), z: rnd(0.3, 1.6) }));
  ctx.fillStyle = '#fff';
  for (const s of starfield) {
    const y = (s.y + bgY * s.z * 1.5) % H;
    ctx.globalAlpha = 0.25 * s.z; ctx.fillRect(s.x, y, s.z * 1.5, s.z * 3);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,10,0.35)'; ctx.fillRect(0, 0, W, H);
}
let OX = FX, OY = FY;
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawPanel();
  OX = FX + (shake > 0 ? rnd(-shake, shake) * 0.25 : 0);
  OY = FY + (shake > 0 ? rnd(-shake, shake) * 0.25 : 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(FX, FY, W, H); ctx.clip();
  ctx.setTransform(1, 0, 0, 1, OX, OY);
  drawBg();
  if (boss && !boss.dying && boss.def.phases[boss.pi].spell) drawSpellBg();

  // items
  for (const it of items) {
    const c = { p: '#f44', s: '#48f', c: '#9ff', b: '#4f4', l: '#f4f' }[it.type];
    if (it.type === 'c') { ctx.fillStyle = c; ctx.fillRect(it.x - 2, it.y - 2, 4, 4); continue; }
    ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.fillRect(it.x - 7, it.y - 7, 14, 14); ctx.strokeRect(it.x - 7, it.y - 7, 14, 14);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText({ p: 'P', s: '点', b: 'B', l: '1UP' }[it.type], it.x, it.y + 1);
  }
  // enemies
  for (const e of enemies) {
    drawSprite('enemy', e.x, e.y, e.size, Math.sin(e.t / 10) * 0.1);
    if (e.flashT > 0) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); }
  }
  // boss
  if (boss && boss.dying < 60) {
    const b = boss, ph = b.def.phases[Math.min(b.pi, b.def.phases.length - 1)];
    if (ph && ph.spell && !b.dying) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(frame * 0.01);
      ctx.strokeStyle = COLS[b.def.col] + '88'; ctx.lineWidth = 2;
      for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(0, 0, 95 + k * 14 + Math.sin(frame / 20) * 5, 0, TAU); ctx.stroke(); }
      for (let k = 0; k < 6; k++) { ctx.rotate(TAU / 6); ctx.strokeRect(-60, -60, 120, 120); }
      ctx.restore();
    }
    drawSprite(b.def.spr, b.x, b.y + Math.sin(frame / 30) * 4, 150, 0, b.dying ? 1 - b.dying / 60 : 1);
    if (b.hitT > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(b.x, b.y, 60, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
    // circular HP gauge around the boss
    if (!b.dying && b.pi >= 0) {
      const rr = 82, k = b.wait > 0 ? 1 - b.wait / 70 : clamp(b.hp / b.maxhp, 0, 1);
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, TAU); ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = ph.spell ? '#ff6aa8' : '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    }
  }
  // spell card cut-in
  if (boss && boss.cutin > 0) {
    const c = boss.cutin, p = 1 - c / 100;
    ctx.globalAlpha = Math.min(1, c / 20, (100 - c) / 15) * 0.55;
    drawSprite(boss.def.spr, W * 1.1 - p * W * 0.9, H * 0.25 + p * H * 0.35, 380);
    ctx.globalAlpha = 1;
  }
  // shots
  ctx.globalCompositeOperation = 'lighter';
  // thin, semi-transparent stream so it never hides enemy bullets
  ctx.fillStyle = 'rgba(120,255,255,.45)';
  for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 12, 3, 24);
  ctx.globalCompositeOperation = 'source-over';
  // player
  if (P.dead === 0 && !(P.inv > 0 && frame % 6 < 3)) drawSprite('player', P.x, P.y, 46);
  // bullets
  for (const b of bullets) {
    const sp = BSPR[b.type][b.col], hw = sp.width / 2;
    if (b.type === 'rice') {
      const c = Math.cos(b.a), s = Math.sin(b.a);
      ctx.setTransform(c, s, -s, c, b.x + OX, b.y + OY);
      ctx.drawImage(sp, -hw, -hw);
      ctx.setTransform(1, 0, 0, 1, OX, OY);
    } else ctx.drawImage(sp, b.x - hw, b.y - hw);
  }
  // hitbox
  if (P.dead === 0 && isSlow()) {
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(frame * 0.05);
    ctx.strokeStyle = '#fffa'; ctx.lineWidth = 1.5; ctx.strokeRect(-14, -14, 28, 28); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#f04'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(P.x, P.y, 4, 0, TAU); ctx.fill(); ctx.stroke();
  }
  // particles
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.col;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  // bomb fx
  if (bombT > 0) {
    const k = 160 - bombT;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `hsla(${(frame * 6 + i * 90) % 360},100%,70%,${bombT / 160})`;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(P.x, P.y, (k * 8 + i * 60) % 700, 0, TAU); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash / 40})`; ctx.fillRect(0, 0, W, H); }
  ctx.setTransform(1, 0, 0, 1, FX, FY);
  drawHud();
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
function drawSpellBg() {
  // darkened field with a slowly rotating hexagram lattice in the boss colour
  const col = COLS[boss.def.col];
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.translate(W / 2, H / 2); ctx.rotate(frame * 0.002);
  for (let r = 60; r < 700; r += 70) {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) { const a = i / 6 * TAU + r * 0.01; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 800, Math.sin(a) * 800); ctx.stroke(); }
  ctx.restore();
}
function drawPanel() {
  // outer frame / side panel (classic vertical-shmup layout)
  const g = ctx.createLinearGradient(0, 0, CW, CH);
  g.addColorStop(0, '#140d2e'); g.addColorStop(0.5, '#0c0820'); g.addColorStop(1, '#1d0f2a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  ctx.save(); ctx.globalAlpha = 0.08; ctx.strokeStyle = '#c9b8ff';
  for (let i = -CH; i < CW; i += 22) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CH, CH); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#8a78d8'; ctx.lineWidth = 2; ctx.strokeRect(FX - 3, FY - 3, W + 6, H + 6);
  ctx.strokeStyle = '#3a2f70'; ctx.lineWidth = 1; ctx.strokeRect(FX - 7, FY - 7, W + 14, H + 14);

  const x = FX + W + 26, x2 = CW - 20;
  const row = (y, label, val, col = '#fff', vcol) => {
    txt(label, x, y, col, 15);
    txt(val, x2, y, vcol || '#fff', 17, 'right');
  };
  txt(D.name, (x + x2) / 2, 62, ['#7fe', '#8cf', '#fb6', '#f5a'][diffIdx], 26, 'center');
  ctx.fillStyle = '#ffffff22'; ctx.fillRect(x, 78, x2 - x, 1);
  row(116, 'HiScore', String(hiscore).padStart(10, '0'), '#b9b2e8');
  row(146, 'Score', String(score).padStart(10, '0'), '#fff');
  row(206, 'Player', '', '#f9c');
  txt('★'.repeat(Math.max(0, P.lives)) || '-', x2, 206, '#ff6fb4', 20, 'right');
  row(236, 'Bomb', '', '#9f9');
  txt('★'.repeat(P.bombs) || '-', x2, 236, '#6fe08a', 20, 'right');
  row(296, 'Power', P.power >= 4 ? 'MAX' : P.power.toFixed(2) + '/4.00', '#fc8', '#ffd27a');
  row(326, 'Graze', String(graze), '#aef');
  ctx.fillStyle = '#ffffff22'; ctx.fillRect(x, 350, x2 - x, 1);
  txt('STAGE ' + (stageIdx + 1), x, 384, '#9ef', 15);
  txt(STAGES[stageIdx].name, x, 408, '#dde', 14, 'left', false);
  if (boss && !boss.dying) txt(boss.def.name, x, 432, COLS[boss.def.col], 14, 'left', false);
  // logo
  ctx.save();
  const lg = ctx.createLinearGradient(x, 0, x2, 0);
  lg.addColorStop(0, '#7ff'); lg.addColorStop(0.5, '#c9f'); lg.addColorStop(1, '#ff9');
  ctx.font = '900 34px "Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = lg;
  ctx.shadowColor = '#88f'; ctx.shadowBlur = 16;
  ctx.fillText('PRISM', (x + x2) / 2, CH - 120); ctx.fillText('BARRAGE', (x + x2) / 2, CH - 82);
  ctx.restore();
  txt('弾幕シューティング', (x + x2) / 2, CH - 52, '#99a', 12, 'center', false);
  if (AU.muted) txt('MUTE (M)', x2, CH - 24, '#888', 11, 'right');
}
function txt(s, x, y, col = '#fff', size = 14, align = 'left', bold = true) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px "Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function drawHud() {
  if (boss && !boss.dying) {
    const b = boss, ph = b.def.phases[b.pi];
    const remain = b.def.phases.slice(b.pi + 1).filter(p => p.spell).length;
    txt('BOSS', 8, 20, '#f9c', 13);
    txt('★'.repeat(remain), 50, 20, COLS[b.def.col], 13);
    txt(String(Math.ceil(b.time / 60)).padStart(2, '0'), W / 2, 26, b.time < 600 ? '#f66' : '#fff', 22, 'center');
    if (ph.spell) {
      // spell name slides up into the top-right corner after declaration
      const k = clamp((b.cutin || 0) / 100, 0, 1), y = 52 + k * 260;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.font = 'bold 16px "Segoe UI",sans-serif';
      const tw = ctx.measureText(ph.spell).width;
      ctx.fillRect(W - tw - 22, y - 18, tw + 18, 24);
      ctx.fillStyle = COLS[b.def.col]; ctx.fillRect(W - tw - 22, y + 5, tw + 18, 2);
      txt(ph.spell, W - 12, y, '#fff', 16, 'right');
      txt(b.bonus ? 'Bonus ' + Math.round((ph.hp * 50 + b.time * 20) * D.mul / 10) * 10 : 'Bonus Failed', W - 12, y + 22, b.bonus ? '#ffd27a' : '#f88', 11, 'right');
    }
    // enemy position marker under the field
    ctx.fillStyle = '#f48'; ctx.fillRect(b.x - 22, H - 5, 44, 5);
    txt('ENEMY', b.x, H - 8, '#f9c', 9, 'center');
  }
  // stage intro
  if (stageInfo > 0) {
    const a = Math.min(1, stageInfo / 40, (240 - stageInfo) / 30);
    ctx.globalAlpha = a;
    txt('STAGE ' + (stageIdx + 1), W / 2, H / 2 - 20, '#9ef', 36, 'center');
    txt(STAGES[stageIdx].name, W / 2, H / 2 + 18, '#fff', 20, 'center');
    ctx.globalAlpha = 1;
  }
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, t.life / 20);
    txt(t.text, t.x, t.y, t.col, t.big ? 20 : 13, 'center');
  }
  ctx.globalAlpha = 1;
}
function renderTitleBg() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05040c'; ctx.fillRect(0, 0, CW, CH);
}

// ---------------- menu wiring ----------------
let pendingMode = 'story', pendingStage = 0;
document.querySelectorAll('.ov button').forEach(btn => btn.addEventListener('click', () => {
  initAudio(); sfx('select');
  const act = btn.dataset.act;
  if (btn.dataset.diff != null) {
    diffIdx = +btn.dataset.diff; D = DIFFS[diffIdx];
    if (pendingMode === 'practice') setState('stage'); else startGame('story', 0);
    return;
  }
  if (btn.dataset.stage != null) { startGame('practice', +btn.dataset.stage); return; }
  switch (act) {
    case 'story': pendingMode = 'story'; setState('diff'); break;
    case 'practice': pendingMode = 'practice'; setState('diff'); break;
    case 'howto': setState('howto'); break;
    case 'back':
      if (state === 'stage') setState('diff'); else setState('title');
      break;
    case 'resume': setState('play'); break;
    case 'retry': startGame(mode, mode === 'practice' ? stageIdx : 0); break;
    case 'totitle': saveHi(); setState('title'); break;
    case 'continue': {
      continues++; score = 0;
      const pw = P.power; newPlayer(pw); P.inv = 200;
      setState('play'); playBgm(boss ? (stageIdx === 3 ? 'boss4' : 'boss') : 's' + stageIdx);
      break;
    }
    case 'next':
      if (mode === 'story') startStage(stageIdx + 1); else setState('title');
      break;
  }
}));

// ---------------- loop ----------------
let acc = 0, lastT = performance.now();
function loop(now) {
  const dt = Math.min(100, now - lastT); lastT = now;
  if (state === 'play') {
    acc += dt;
    let n = 0;
    while (acc >= 1000 / 60 && n < 4) { update(); acc -= 1000 / 60; n++; if (state !== 'play') break; }
    if (n === 4) acc = 0;
    render();
  } else if (['pause', 'over', 'clear', 'ending'].includes(state) && P) {
    acc = 0;
  } else { acc = 0; renderTitleBg(); }
  requestAnimationFrame(loop);
}

buildBulletSprites();
loadImages().then(() => { setState('title'); requestAnimationFrame(loop); });
