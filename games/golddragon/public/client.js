'use strict';
// Browser client: draws the shared game and sends this player's choices to the host.
const $ = (id) => document.getElementById(id);

// Each browser keeps its own player id; ?p=2 makes a second player in another tab of the same PC.
const pid = (() => {
  const extra = new URLSearchParams(location.search).get('p') || '';
  let base = '';
  try { base = localStorage.getItem('gd_pid') || ''; } catch { /* private mode */ }
  if (!base) {
    base = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('gd_pid', base); } catch { /* ignore */ }
  }
  return base + extra;
})();

let S = null; // latest state from the host
let selHero = null;
let selAbility = null;
let joinOpen = false;
let pickedClass = 'fighter';
let fullMap = false;
let hoverTile = null;
let lastLog = 0;
let lastFx = 0;
let lastTurnKey = '';
const fxs = [];
const disp = {}; // smoothed draw positions
const cam = { x: 0, y: 0 };
let geo = { ts: 32, cw: 0, ch: 0, zoomed: false };

// ---------- network ----------
async function api(type, data = {}) {
  try {
    const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid, type, ...data }) });
    const j = await r.json();
    if (j.error) toast(j.error);
    return j;
  } catch {
    toast('호스트 PC에 연결할 수 없어요');
    return { error: 'offline' };
  }
}
function connect() {
  const es = new EventSource('/events?pid=' + encodeURIComponent(pid));
  es.onmessage = (e) => { S = JSON.parse(e.data); render(); };
  es.onerror = () => { $('viewers').textContent = '⚠️ 연결 끊김, 다시 연결 중…'; };
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
let bannerTimer;
function banner(text, mine) {
  const b = $('banner');
  b.textContent = text;
  b.className = 'banner show' + (mine ? ' my' : '');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, mine ? 2200 : 3200);
}
function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    [523, 784].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'triangle';
      g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
  } catch { /* no audio */ }
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const myHeroes = () => (S ? S.heroes.filter((h) => h.mine) : []);
const heroById = (id) => S.heroes.find((h) => h.id === id);
const entityAt = (x, y) => S.heroes.find((h) => h.x === x && h.y === y) || (S.monsters || []).find((m) => m.x === x && m.y === y);
const ctl = () => (S && selHero && S.controls ? S.controls[selHero] : null);
const currentEntity = () => (S.combat ? heroById(S.combat.current) || S.monsters.find((m) => m.id === S.combat.current) : null);

// ---------- render: screens ----------
function render() {
  const phase = S.phase;
  const showLobby = phase === 'lobby' || (joinOpen && phase === 'playing');
  $('lobby').classList.toggle('hidden', !showLobby);
  $('game').classList.toggle('hidden', showLobby || phase !== 'playing');
  $('won').classList.toggle('hidden', phase !== 'won');
  if (showLobby) renderLobby();
  if (phase === 'won') {
    $('wonStats').textContent = `모은 골드 ${S.gold} · 영웅 ${S.heroes.map((h) => h.icon + h.name).join(', ')}`;
  }
  if (phase === 'playing') renderGame();
}

function renderLobby() {
  const ul = $('lobbyHeroes');
  ul.innerHTML = S.heroes.length
    ? S.heroes.map((h) => `<li style="--c:${h.color}"><span style="font-size:22px">${h.icon}</span><span><b>${esc(h.name)}</b><br><small>${h.clsName}${h.mine ? ' · 나' : ''}</small></span>${h.mine && S.phase === 'lobby' ? `<button class="x" data-leave="${h.id}" title="빼기">✕</button>` : ''}</li>`).join('')
    : '<li class="empty">아직 아무도 없어요. 아래에서 영웅을 만들어 주세요!</li>';
  ul.querySelectorAll('[data-leave]').forEach((b) => (b.onclick = () => api('leave', { heroId: b.dataset.leave })));
  const picker = $('classPicker');
  if (!picker.dataset.built) {
    picker.dataset.built = 1;
    picker.innerHTML = Object.entries(S.classes).map(([k, c]) =>
      `<button type="button" class="class-card" data-cls="${k}" style="--c:${c.color}"><span class="ci">${c.icon}</span><b>${c.name}</b><small>${c.desc}</small><div class="st">❤️ HP ${c.hp} · 🛡️ 방어도 ${c.ac}</div></button>`).join('');
    picker.querySelectorAll('.class-card').forEach((b) => (b.onclick = () => { pickedClass = b.dataset.cls; markClass(); }));
  }
  markClass();
  const full = S.heroes.length >= S.maxHeroes;
  $('joinForm').classList.toggle('hidden', full);
  $('startBtn').classList.toggle('hidden', S.phase !== 'lobby');
  $('startBtn').disabled = !S.heroes.length;
  $('lobbyHint').innerHTML = S.phase === 'playing'
    ? '모험이 이미 진행 중이에요. 참가하면 동료 옆에서 시작해요. <a href="#" id="backToGame" style="color:var(--gold)">← 게임 화면으로</a>'
    : `PC·핸드폰 모두 같은 주소로 접속하면 함께할 수 있어요 (최대 ${S.maxHeroes}명). 한 기기로 영웅 두 명을 움직여도 돼요.`;
  const back = $('backToGame');
  if (back) back.onclick = (e) => { e.preventDefault(); joinOpen = false; render(); };
}
function markClass() {
  document.querySelectorAll('.class-card').forEach((b) => b.classList.toggle('sel', b.dataset.cls === pickedClass));
}
$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('heroName').value.trim();
  if (!name) return;
  const r = await api('join', { name, cls: pickedClass });
  if (!r.error) { $('heroName').value = ''; joinOpen = false; if (S) render(); }
};
$('startBtn').onclick = () => api('start');
$('restartBtn').onclick = () => api('restart');
$('zoomBtn').onclick = () => { fullMap = !fullMap; };

function renderGame() {
  $('floorName').textContent = S.floor ? `${S.floor.name}  (${S.floor.idx + 1}/${S.floor.count})` : '';
  $('gold').textContent = S.gold;
  $('potions').textContent = S.potions;
  $('viewers').textContent = `👀 ${S.viewers}`;

  // keep a sensible selected hero
  const mine = myHeroes();
  const cur = S.combat && heroById(S.combat.current);
  if (cur && cur.mine) selHero = cur.id;
  else if (!mine.some((h) => h.id === selHero)) selHero = mine[0] ? mine[0].id : null;
  if (selAbility && !(ctl() && ctl().abilities.some((a) => a.id === selAbility && !a.blocked))) selAbility = null;

  // turn order
  $('order').innerHTML = S.combat
    ? `<span class="round">⚔️ ${S.combat.round}라운드</span>` + S.combat.order.map((o) =>
      `<span class="o ${o.hero ? 'hero' : ''} ${o.id === S.combat.current ? 'cur' : ''} ${o.down ? 'down' : ''}">${o.icon} ${esc(o.name)} <small>${o.init}</small></span>`).join('')
    : '';

  // my-turn alert
  const key = S.combat ? S.combat.current + ':' + S.combat.round : '';
  if (key !== lastTurnKey) {
    lastTurnKey = key;
    if (cur && cur.mine && !cur.down) { banner(`⚔️ ${cur.name}의 차례!`, true); beep(); }
  }

  renderParty();
  renderControls();
  renderLog();
  for (const f of S.fx) if (f.id > lastFx) { fxs.push({ ...f, t: performance.now() }); }
  if (S.fx.length) lastFx = Math.max(lastFx, S.fx[S.fx.length - 1].id);
}

function renderParty() {
  $('party').innerHTML = S.heroes.map((h) => {
    const pct = Math.max(0, (h.hp / h.maxHp) * 100);
    const status = h.out ? '깊이 기절' : h.stable ? '안정됨' : h.down ? `쓰러짐 (성공 ${h.saves.s}/3 · 실패 ${h.saves.f}/3)` : `HP ${h.hp}/${h.maxHp}`;
    const slots = h.maxSlots ? ` · 🔮${h.slots}/${h.maxSlots}` : '';
    const tags = (h.dodging ? ' 🌀' : '') + (h.hidden ? ' 🫥' : '') + h.items.map((i) => ' ' + i.icon).join('');
    return `<div class="pc ${h.mine ? 'mine' : ''} ${h.id === selHero ? 'sel' : ''} ${h.down ? 'down' : ''}" style="--c:${h.color}" data-id="${h.id}" title="${h.items.map((i) => i.name + ': ' + i.desc).join('\n')}">
      <div class="ic">${h.down ? '😵' : h.icon}</div>
      <div><div class="nm"><b>${esc(h.name)}</b> <small>${h.clsName} Lv${h.level}${h.mine ? ' · 나' : ''}</small><span class="dot ${h.online ? 'on' : ''}"></span>${tags}</div>
      <div class="hpbar"><i style="width:${pct}%"></i></div></div>
      <div class="meta">${status}<br>🛡️${h.ac}${slots}</div></div>`;
  }).join('');
  $('party').querySelectorAll('.pc').forEach((el) => (el.onclick = () => {
    const h = heroById(el.dataset.id);
    if (h.mine) { selHero = h.id; selAbility = null; renderGame(); }
  }));
}

function renderControls() {
  const box = $('controls');
  const mine = myHeroes();
  if (!mine.length) {
    box.innerHTML = `<div class="waiting">👀 구경하는 중이에요.</div><div class="row"><button class="btn primary" id="joinBtn" ${S.combat ? 'disabled' : ''}>영웅으로 참가하기</button></div>${S.combat ? '<div class="help-text">전투가 끝나면 참가할 수 있어요.</div>' : ''}`;
    $('joinBtn').onclick = () => { joinOpen = true; render(); };
    return;
  }
  const h = heroById(selHero);
  const c = ctl();
  let html = `<div class="who" style="--c:${h.color}"><span style="font-size:24px">${h.icon}</span><b>${esc(h.name)}</b><span>${h.clsName} Lv${h.level}</span></div>`;
  if (S.combat && !c.myTurn) {
    const cur = currentEntity();
    html += `<div class="waiting">⏳ ${cur ? esc(cur.name) : ''}의 차례를 기다리는 중…</div>`;
    if (cur && cur.id[0] === 'h' && !cur.mine && !cur.online && !cur.down) html += `<div class="row"><button class="btn" id="forceEnd">${esc(cur.name)}의 턴 대신 넘기기</button></div>`;
    box.innerHTML = html;
    const f = $('forceEnd');
    if (f) f.onclick = () => api('endTurn', { force: true });
    return;
  }
  if (h.down) {
    box.innerHTML = html + '<div class="waiting">😵 쓰러져 있어요. 동료가 치유하거나 일으켜 줄 때까지 기다려요.</div>';
    return;
  }
  if (S.combat) {
    const t = S.combat.turn;
    html += `<div class="pips"><span class="pip ${t.action > 0 ? '' : 'off'}">⚔️ 행동${t.action > 1 ? ' ×' + t.action : ''}</span><span class="pip ${t.bonus > 0 ? '' : 'off'}">✳️ 보조 행동</span><span class="pip ${t.moveLeft > 0 ? '' : 'off'}">👟 이동 ${t.moveLeft}칸</span></div>`;
  }
  const abs = c.abilities.filter((a) => S.combat || !a.combatOnly);
  html += '<div class="abilities">' + abs.map((a) => {
    const cost = a.cost === 'bonus' ? '보조' : a.cost === 'free' ? '무료' : '';
    return `<button class="ab ${a.cost === 'bonus' ? 'bonus' : ''} ${selAbility === a.id ? 'sel' : ''}" data-ab="${a.id}" ${a.blocked ? 'disabled' : ''} title="${esc(a.name + ': ' + a.desc + (a.blocked ? '\n(' + a.blocked + ')' : ''))}"><span class="cost">${cost}${a.slot ? ' 🔮' : ''}</span><span class="i">${a.icon}</span>${a.name}</button>`;
  }).join('') + '</div>';
  html += '<div class="row">';
  if (S.combat) html += '<button class="btn gold" id="endTurn">✅ 턴 끝내기</button>';
  else {
    html += `<button class="btn" id="rest" ${S.shortRestUsed ? 'disabled' : ''} title="층마다 한 번: 모두 최대 HP 절반 회복">🏕️ 짧은 휴식${S.shortRestUsed ? ' (사용함)' : ''}</button>`;
    if (S.canDescend) html += '<button class="btn gold" id="descend">⬇️ 다음 층으로</button>';
  }
  html += '</div>';
  const sel = selAbility && c.abilities.find((a) => a.id === selAbility);
  html += `<div class="help-text">${sel ? `${sel.icon} ${sel.name}: 지도에서 ${sel.target === 'point' ? '지점' : '빛나는 대상'}을 누르세요 (취소: 버튼 다시 누르기)` : S.combat ? '파란 칸을 눌러 이동하고, 능력을 골라 행동하세요.' : '지도를 눌러 이동하세요. 숨은 적에게 먼저 공격하면 기습!'}</div>`;
  box.innerHTML = html;
  box.querySelectorAll('[data-ab]').forEach((b) => (b.onclick = () => {
    const a = c.abilities.find((x) => x.id === b.dataset.ab);
    if (a.blocked) return toast(a.blocked);
    if (a.target === 'self') { selAbility = null; api('ability', { heroId: h.id, ability: a.id }); return; }
    selAbility = selAbility === a.id ? null : a.id;
    renderControls();
  }));
  const et = $('endTurn');
  if (et) et.onclick = () => { selAbility = null; api('endTurn'); };
  const r = $('rest');
  if (r) r.onclick = () => api('shortRest');
  const dsc = $('descend');
  if (dsc) dsc.onclick = () => api('descend');
}

function renderLog() {
  const el = $('log');
  const first = S.log[0];
  if (first && first.id > lastLog + 60) { el.innerHTML = ''; }
  if (S.log.length && S.log[S.log.length - 1].id < lastLog) { el.innerHTML = ''; lastLog = 0; }
  let newest = null;
  for (const l of S.log) {
    if (l.id <= lastLog) continue;
    const d = document.createElement('div');
    d.className = l.kind;
    d.textContent = l.text;
    el.appendChild(d);
    if (['hit', 'crit', 'miss', 'heal', 'bad', 'good'].includes(l.kind)) newest = l;
  }
  while (el.children.length > 120) el.removeChild(el.firstChild);
  if (S.log.length) lastLog = S.log[S.log.length - 1].id;
  if (newest && !$('banner').classList.contains('my')) banner(newest.text.length > 110 ? newest.text.slice(0, 108) + '…' : newest.text);
  el.scrollTop = el.scrollHeight;
}

// ---------- map drawing ----------
const canvas = $('map');
const g = canvas.getContext('2d');

function layout() {
  const b = $('board').getBoundingClientRect();
  const W = S.map.w, H = S.map.h;
  const fit = Math.max(6, Math.floor(Math.min(b.width / W, b.height / H)));
  const zoomed = !fullMap && fit < 24;
  const ts = zoomed ? 30 : fit;
  const cw = zoomed ? b.width : W * ts, ch = zoomed ? b.height : H * ts;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
  }
  $('zoomBtn').classList.toggle('hidden', !(fit < 24 || fullMap));
  geo = { ts, cw, ch, zoomed, dpr };
}

function focusPoint() {
  const cur = S.combat && currentEntity();
  const h = (cur && (cur.id[0] === 'm' ? cur : cur)) || (selHero && heroById(selHero)) || S.heroes[0];
  if (!h) return { x: S.map.w / 2, y: S.map.h / 2 };
  const p = disp[h.id] || h;
  return { x: p.x, y: p.y };
}

function draw(now) {
  requestAnimationFrame(draw);
  if (!S || S.phase !== 'playing' || !S.map || $('game').classList.contains('hidden')) return;
  layout();
  const { ts, cw, ch, zoomed, dpr } = geo;
  const W = S.map.w, H = S.map.h;
  // smooth positions
  for (const e of [...S.heroes, ...S.monsters]) {
    const p = disp[e.id] || (disp[e.id] = { x: e.x, y: e.y });
    p.x += (e.x - p.x) * 0.25; p.y += (e.y - p.y) * 0.25;
    if (Math.abs(e.x - p.x) < 0.01) p.x = e.x;
    if (Math.abs(e.y - p.y) < 0.01) p.y = e.y;
  }
  if (zoomed) {
    const f = focusPoint();
    const tx = Math.max(0, Math.min(W * ts - cw, f.x * ts + ts / 2 - cw / 2));
    const ty = Math.max(0, Math.min(H * ts - ch, f.y * ts + ts / 2 - ch / 2));
    cam.x += ((W * ts < cw ? (W * ts - cw) / 2 : tx) - cam.x) * 0.15;
    cam.y += ((H * ts < ch ? (H * ts - ch) / 2 : ty) - cam.y) * 0.15;
  } else { cam.x = 0; cam.y = 0; }

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0a0807';
  g.fillRect(0, 0, cw, ch);
  g.translate(-Math.round(cam.x), -Math.round(cam.y));

  const seen = S.seen, vis = S.visible;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seen[i] !== '1') continue;
      const lit = vis[i] === '1';
      const t = S.map.tiles[y][x];
      const px = x * ts, py = y * ts;
      if (t === '#') {
        g.fillStyle = lit ? '#5d4a3c' : '#2a221c';
        g.fillRect(px, py, ts, ts);
        if (S.map.tiles[y + 1] && S.map.tiles[y + 1][x] !== '#') { g.fillStyle = lit ? '#3e3128' : '#1d1814'; g.fillRect(px, py + ts * 0.7, ts, ts * 0.3); }
        g.fillStyle = lit ? '#6f5a49' : '#30271f';
        g.fillRect(px, py, ts, Math.max(1, ts * 0.12));
      } else {
        g.fillStyle = lit ? ((x + y) % 2 ? '#3b322b' : '#362e27') : '#1c1814';
        g.fillRect(px, py, ts, ts);
        g.strokeStyle = '#0000001f';
        g.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
        if (t === '>') {
          for (let k = 0; k < 4; k++) { g.fillStyle = lit ? `hsl(35, 30%, ${60 - k * 12}%)` : '#2d2620'; g.fillRect(px + ts * 0.15, py + ts * (0.15 + k * 0.18), ts * 0.7, ts * 0.14); }
        }
        if (t === 'E') {
          const gl = g.createRadialGradient(px + ts / 2, py + ts / 2, 1, px + ts / 2, py + ts / 2, ts);
          gl.addColorStop(0, '#ffd76688'); gl.addColorStop(1, '#ffd76600');
          g.fillStyle = gl; g.fillRect(px - ts / 2, py - ts / 2, ts * 2, ts * 2);
          emoji('🥚', px + ts / 2, py + ts / 2, ts * 0.7);
        }
      }
    }
  }
  // items
  for (const it of S.items) emoji(it.kind === 'chest' ? '🎁' : '🧪', it.x * ts + ts / 2, it.y * ts + ts / 2, ts * 0.62);

  // movement & targeting overlays
  const c = ctl();
  const sel = selAbility && c && c.abilities.find((a) => a.id === selAbility);
  if (c && c.myTurn && !sel && S.combat) {
    g.fillStyle = 'rgba(90,169,255,0.22)';
    for (const [x, y] of c.reach) g.fillRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);
  }
  const me = selHero && heroById(selHero);
  if (sel && sel.target === 'point' && me) {
    g.fillStyle = 'rgba(242,193,78,0.10)';
    for (let y = me.y - sel.range; y <= me.y + sel.range; y++) for (let x = me.x - sel.range; x <= me.x + sel.range; x++) if (vis[y * W + x] === '1') g.fillRect(x * ts, y * ts, ts, ts);
    if (hoverTile) {
      g.fillStyle = 'rgba(165,139,255,0.35)';
      for (let y = hoverTile.y - sel.radius; y <= hoverTile.y + sel.radius; y++) for (let x = hoverTile.x - sel.radius; x <= hoverTile.x + sel.radius; x++) g.fillRect(x * ts, y * ts, ts, ts);
    }
  }
  if (sel && sel.target === 'self' && me && sel.radius) {
    g.fillStyle = 'rgba(165,139,255,0.25)';
    g.fillRect((me.x - sel.radius) * ts, (me.y - sel.radius) * ts, (sel.radius * 2 + 1) * ts, (sel.radius * 2 + 1) * ts);
  }
  const targets = new Set(sel ? sel.targets : []);
  const pulse = 0.5 + 0.5 * Math.sin(now / 250);

  // monsters
  for (const m of S.monsters) {
    const p = disp[m.id];
    const cx = p.x * ts + ts / 2, cy = p.y * ts + ts / 2, r = ts * (m.boss ? 0.48 : 0.42);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = m.awake ? '#5a1d1b' : '#3a2a26'; g.fill();
    g.lineWidth = Math.max(1.5, ts * 0.06);
    g.strokeStyle = m.boss ? '#ffb347' : '#c0443d'; g.stroke();
    emoji(m.icon, cx, cy + ts * 0.02, ts * (m.boss ? 0.68 : 0.58));
    hpBar(cx, cy + r + 2, ts * 0.8, m.hp / m.maxHp, '#e5554f');
    if (m.asleep) emoji('💤', cx + r * 0.8, cy - r * 0.8, ts * 0.35);
    if (m.turned) emoji('😱', cx + r * 0.8, cy - r * 0.8, ts * 0.35);
    if (!m.awake && !m.asleep) emoji('❔', cx + r * 0.8, cy - r * 0.8, ts * 0.3);
    if (m.helped) emoji('🎯', cx - r * 0.8, cy - r * 0.8, ts * 0.3);
    if (targets.has(m.id)) ring(cx, cy, r + 3 + pulse * 3, '#f2c14e');
    if (S.combat && S.combat.current === m.id) ring(cx, cy, r + 4, '#ff6b5e', true);
  }
  // heroes
  for (const h of S.heroes) {
    const p = disp[h.id];
    const cx = p.x * ts + ts / 2, cy = p.y * ts + ts / 2, r = ts * 0.42;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = h.down ? '#555' : h.color; g.fill();
    g.lineWidth = Math.max(1.5, ts * 0.06); g.strokeStyle = '#fff8'; g.stroke();
    emoji(h.down ? '😵' : h.icon, cx, cy + ts * 0.02, ts * 0.56);
    hpBar(cx, cy + r + 2, ts * 0.8, h.hp / h.maxHp, '#4fcf7f');
    if (ts >= 20) {
      g.font = `bold ${Math.max(10, ts * 0.32)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.lineWidth = 3; g.strokeStyle = '#000c'; g.strokeText(h.name, cx, cy - r - 1);
      g.fillStyle = '#fff'; g.fillText(h.name, cx, cy - r - 1);
    }
    if (h.dodging) emoji('🌀', cx + r * 0.8, cy + r * 0.6, ts * 0.3);
    if (h.hidden) emoji('🫥', cx - r * 0.8, cy + r * 0.6, ts * 0.3);
    if (targets.has(h.id)) ring(cx, cy, r + 3 + pulse * 3, '#4fcf7f');
    if (S.combat && S.combat.current === h.id) ring(cx, cy, r + 4 + pulse * 2, '#f2c14e', true);
    else if (h.id === selHero && h.mine) ring(cx, cy, r + 3, '#ffffffaa', true);
  }
  // hover outline
  if (hoverTile) { g.strokeStyle = '#ffffff55'; g.lineWidth = 1.5; g.strokeRect(hoverTile.x * ts + 1, hoverTile.y * ts + 1, ts - 2, ts - 2); }

  // effects
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i];
    const age = (now - f.t) / 1000;
    if (age > 1.4) { fxs.splice(i, 1); continue; }
    const cx = f.x * ts + ts / 2, cy = f.y * ts + ts / 2;
    g.globalAlpha = Math.max(0, 1 - age / 1.4);
    if (f.type === 'burst') {
      g.beginPath(); g.arc(cx, cy, (f.r + 0.5) * ts * Math.min(1, age * 2.5), 0, Math.PI * 2);
      g.fillStyle = f.fire ? '#ff6a0055' : f.sleep ? '#a58bff44' : '#9fd3ff44'; g.fill();
    } else {
      const text = f.type === 'dmg' ? '-' + f.amount : f.type === 'heal' ? '+' + f.amount : f.type === 'miss' ? '빗나감' : f.type === 'ko' ? '💥' : f.type === 'chest' ? '✨' : '';
      g.font = `bold ${Math.max(14, ts * 0.55)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = '#000';
      const yy = cy - ts * 0.5 - age * ts * 0.9;
      g.strokeText(text, cx, yy);
      g.fillStyle = f.type === 'heal' ? '#7dffa8' : f.type === 'miss' ? '#ddd' : '#ffdf6b';
      g.fillText(text, cx, yy);
    }
    g.globalAlpha = 1;
  }
}

function emoji(ch, x, y, size) {
  g.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, x, y);
}
function hpBar(cx, y, w, frac, color) {
  g.fillStyle = '#000a'; g.fillRect(cx - w / 2, y, w, 4);
  g.fillStyle = color; g.fillRect(cx - w / 2, y, w * Math.max(0, frac), 4);
}
function ring(cx, cy, r, color, dashed) {
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.lineWidth = 2.5; g.strokeStyle = color;
  g.setLineDash(dashed ? [5, 4] : []); g.stroke(); g.setLineDash([]);
}

// ---------- map input ----------
function tileFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left + cam.x) / geo.ts);
  const y = Math.floor((e.clientY - rect.top + cam.y) / geo.ts);
  if (!S || !S.map || x < 0 || y < 0 || x >= S.map.w || y >= S.map.h) return null;
  return { x, y };
}
canvas.addEventListener('mousemove', (e) => {
  hoverTile = tileFromEvent(e);
  const tip = $('tooltip');
  const ent = hoverTile && S.visible[hoverTile.y * S.map.w + hoverTile.x] === '1' && entityAt(hoverTile.x, hoverTile.y);
  if (!ent) { tip.classList.add('hidden'); return; }
  const isM = ent.id[0] === 'm';
  tip.innerHTML = isM
    ? `<b>${ent.icon} ${esc(ent.name)}</b><br>HP ${ent.hp}/${ent.maxHp} · 방어도 ${ent.ac}${ent.asleep ? '<br>💤 잠듦 (공격이 유리, 옆에서 맞히면 치명타)' : ''}${!ent.awake ? '<br>❔ 아직 우리를 못 봤어요 (기습 가능)' : ''}${ent.helped ? '<br>🎯 동료가 방해 중 (다음 공격 유리)' : ''}`
    : `<b>${ent.icon} ${esc(ent.name)}</b> ${ent.clsName} Lv${ent.level}<br>HP ${ent.hp}/${ent.maxHp} · 방어도 ${ent.ac}`;
  const b = $('board').getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 200) + 'px';
  tip.style.top = (e.clientY - b.top + 14) + 'px';
  tip.classList.remove('hidden');
});
canvas.addEventListener('mouseleave', () => { hoverTile = null; $('tooltip').classList.add('hidden'); });
canvas.addEventListener('click', (e) => {
  const t = tileFromEvent(e);
  if (!t || !S || S.phase !== 'playing') return;
  const c = ctl();
  const ent = entityAt(t.x, t.y);
  if (selAbility && c) {
    const a = c.abilities.find((x) => x.id === selAbility);
    if (a.target === 'point') api('ability', { heroId: selHero, ability: a.id, target: t });
    else if (ent && a.targets.includes(ent.id)) api('ability', { heroId: selHero, ability: a.id, target: { id: ent.id } });
    else return toast('빛나는 대상 중에서 골라 주세요');
    selAbility = null;
    renderControls();
    return;
  }
  if (ent && ent.id[0] === 'h' && ent.mine) { selHero = ent.id; selAbility = null; renderGame(); return; }
  if (!c) return;
  if (S.combat && !c.myTurn) return toast('내 차례가 아니에요');
  if (S.seen[t.y * S.map.w + t.x] !== '1') return;
  if (ent) return;
  api('move', { heroId: selHero, x: t.x, y: t.y });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selAbility) { selAbility = null; renderControls(); }
});
window.addEventListener('resize', () => { if (S) layout(); });

connect();
requestAnimationFrame(draw);
