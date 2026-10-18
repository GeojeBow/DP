'use strict';
// Rules engine. Pure functions over a plain-JSON state object so the host can save it to disk.
const D = require('./data');

const VISION = 8; // tiles a hero can see
const WAKE = 7; // monsters notice heroes this close (with line of sight)
const GROUP = 5; // a monster that notices wakes friends this close
const MAX_HEROES = 4;
const DMG_KO = { slashing: '베기', piercing: '찌르기', bludgeoning: '타격', fire: '화염', force: '역장', thunder: '천둥', radiant: '광휘' };

// ---------- dice ----------
function d(rng, sides) { return 1 + Math.floor(rng() * sides); }
function rollDice(rng, dice, level, crit) {
  const [n, sides, flatRaw] = dice;
  const flat = flatRaw === 'level' ? level : flatRaw || 0;
  const count = crit ? n * 2 : n;
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(d(rng, sides));
  const total = rolls.reduce((a, b) => a + b, 0) + flat;
  return { total, text: `${count}d${sides}[${rolls.join('+')}]${flat ? (flat > 0 ? '+' : '') + flat : ''}` };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const josa = (word, a, b) => {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + a;
  return word + ((c - 0xac00) % 28 ? a : b);
};
// 이/가, 을/를, 은/는 helpers
const iga = (w) => josa(w, '이', '가');
const eul = (w) => josa(w, '을', '를');
const eun = (w) => josa(w, '은', '는');

// ---------- state ----------
function newGame() {
  return {
    version: 1, phase: 'lobby', floor: 0, map: null, seen: '', heroes: [], monsters: [], items: [],
    gold: 0, potions: 3, combat: null, log: [], fx: [], seq: 0, nextId: 1, shortRestUsed: false, snapshot: null,
  };
}

function log(state, text, kind = 'info') {
  state.seq++;
  state.log.push({ id: state.seq, text, kind });
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}
function fx(state, e) {
  state.seq++;
  state.fx.push({ id: state.seq, ...e });
  if (state.fx.length > 30) state.fx.splice(0, state.fx.length - 30);
}

function loadFloor(state, idx) {
  const f = D.FLOORS[idx];
  const w = Math.max(...f.map.map((r) => r.length));
  const h = f.map.length;
  const rows = [];
  const starts = [];
  state.monsters = [];
  state.items = [];
  let chest = 0;
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const ch = f.map[y][x] || '#';
      let tile = '.';
      if (ch === '#') tile = '#';
      else if (ch === '>') tile = '>';
      else if (ch === 'E') tile = 'E';
      else if (ch === 'S') starts.push([x, y]);
      else if (ch === 'C') state.items.push({ id: 'i' + state.nextId++, kind: 'chest', x, y, ...(f.chests[chest++] || { gold: 10 }) });
      else if (ch === 'p') state.items.push({ id: 'i' + state.nextId++, kind: 'potion', x, y });
      else if (D.MONSTER_LETTERS[ch]) state.monsters.push(makeMonster(state, D.MONSTER_LETTERS[ch], x, y));
      row += tile;
    }
    rows.push(row);
  }
  state.floor = idx;
  state.map = { w, h, tiles: rows, starts };
  state.seen = '0'.repeat(w * h);
  state.combat = null;
  state.shortRestUsed = false;
  state.heroes.forEach((hero, i) => {
    const s = starts[i] || freeTileNear(state, starts[0][0], starts[0][1]);
    hero.x = s[0];
    hero.y = s[1];
  });
  updateSeen(state);
}

function makeMonster(state, kind, x, y) {
  const m = D.MONSTERS[kind];
  return { id: 'm' + state.nextId++, kind, name: m.name, icon: m.icon, x, y, hp: m.hp, maxHp: m.hp, ac: m.ac,
    awake: false, asleep: false, turned: 0, helped: false, breathReady: true, dead: false };
}

function makeHero(state, owner, name, cls) {
  const c = D.CLASSES[cls];
  const hero = { id: 'h' + state.nextId++, owner, name, cls, icon: c.icon, color: c.color, level: 1, x: 0, y: 0,
    hp: 0, maxHp: 0, baseAc: c.ac, slots: 0, maxSlots: 0, uses: {}, down: false, stable: false, out: false,
    saves: { s: 0, f: 0 }, dodging: false, hidden: false, items: [], weaponBonus: 0, acBonus: 0, hpBonus: 0 };
  setLevel(hero, 1);
  return hero;
}

function setLevel(hero, level) {
  const c = D.CLASSES[hero.cls];
  hero.level = level;
  hero.maxHp = c.hp[level - 1] + hero.hpBonus;
  hero.maxSlots = c.slots ? c.slots[level - 1] : 0;
  fullRest(hero);
}
function fullRest(hero) {
  hero.hp = hero.maxHp;
  hero.slots = hero.maxSlots;
  hero.uses = { secondWind: 1, actionSurge: 1, turnUndead: 1 };
  hero.down = hero.stable = hero.out = hero.dodging = hero.hidden = false;
  hero.saves = { s: 0, f: 0 };
}
const heroAc = (h) => h.baseAc + h.acBonus;

// ---------- geometry ----------
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function tileAt(state, x, y) {
  const m = state.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return '#';
  return m.tiles[y][x];
}
const isWall = (state, x, y) => tileAt(state, x, y) === '#';
const walkable = (state, x, y) => { const t = tileAt(state, x, y); return t === '.' || t === '>'; };
const blocksSight = (state, x, y) => isWall(state, x, y);

function los(state, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    if (blocksSight(state, x, y)) return false;
  }
  return true;
}
const sees = (state, a, b, range) => dist(a, b) <= range && los(state, a.x, a.y, b.x, b.y);

const aliveMonsters = (state) => state.monsters.filter((m) => !m.dead);
const monsterAt = (state, x, y) => state.monsters.find((m) => !m.dead && m.x === x && m.y === y);
const heroAt = (state, x, y) => state.heroes.find((h) => h.x === x && h.y === y);
const standing = (state) => state.heroes.filter((h) => !h.down);

function visibleSet(state) {
  const vis = new Uint8Array(state.map.w * state.map.h);
  for (const h of state.heroes) {
    for (let y = h.y - VISION; y <= h.y + VISION; y++) {
      for (let x = h.x - VISION; x <= h.x + VISION; x++) {
        if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) continue;
        if (los(state, h.x, h.y, x, y)) vis[y * state.map.w + x] = 1;
      }
    }
  }
  return vis;
}
function updateSeen(state) {
  const vis = visibleSet(state);
  let s = '';
  for (let i = 0; i < vis.length; i++) s += vis[i] || state.seen[i] === '1' ? '1' : '0';
  state.seen = s;
  return vis;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Breadth-first search over 8 directions; diagonals can't cut wall corners.
function bfs(state, sx, sy, passable, maxDist = Infinity) {
  const w = state.map.w;
  const out = new Map([[sy * w + sx, { d: 0, prev: -1 }]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    const cur = out.get(y * w + x);
    if (cur.d >= maxDist) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (dx && dy && (isWall(state, x + dx, y) || isWall(state, x, y + dy))) continue;
      const k = ny * w + nx;
      if (out.has(k) || !passable(nx, ny)) continue;
      out.set(k, { d: cur.d + 1, prev: y * w + x });
      q.push([nx, ny]);
    }
  }
  return out;
}
function pathTo(state, map, x, y) {
  const w = state.map.w;
  const path = [];
  let k = y * w + x;
  while (map.has(k) && map.get(k).prev !== -1) {
    path.unshift([k % w, Math.floor(k / w)]);
    k = map.get(k).prev;
  }
  return path;
}
function freeTileNear(state, x, y) {
  const map = bfs(state, x, y, (nx, ny) => walkable(state, nx, ny));
  for (const k of map.keys()) {
    const tx = k % state.map.w, ty = Math.floor(k / state.map.w);
    if (walkable(state, tx, ty) && !heroAt(state, tx, ty) && !monsterAt(state, tx, ty)) return [tx, ty];
  }
  return [x, y];
}
const heroPassable = (state) => (x, y) => walkable(state, x, y) && !monsterAt(state, x, y);

function reachable(state, hero) {
  const turn = state.combat && state.combat.turn;
  const max = turn ? turn.moveLeft : Infinity;
  const map = bfs(state, hero.x, hero.y, heroPassable(state), max);
  const tiles = [];
  for (const k of map.keys()) {
    const x = k % state.map.w, y = Math.floor(k / state.map.w);
    if ((x !== hero.x || y !== hero.y) && !heroAt(state, x, y)) tiles.push([x, y]);
  }
  return { map, tiles };
}

// ---------- waking & combat flow ----------
// A monster that notices the heroes shouts to friends in the same room (close and in sight), no chain reaction.
function wakeGroup(state, m, woke) {
  if (m.dead) return;
  const alert = (o) => { if (!o.awake) { o.awake = true; woke.push(o); } };
  alert(m);
  for (const o of aliveMonsters(state)) if (!o.awake && sees(state, m, o, GROUP)) alert(o);
}
function checkWake(state) {
  const woke = [];
  for (const m of aliveMonsters(state)) {
    if (m.awake || m.asleep) continue;
    if (standing(state).some((h) => sees(state, m, h, WAKE))) wakeGroup(state, m, woke);
  }
  return woke;
}
function handleWoke(state, rng, woke) {
  if (!woke.length) return;
  const names = [...new Set(woke.map((m) => m.name))].join(', ');
  if (!state.combat) {
    log(state, `⚠️ ${names}${woke.length > 1 ? ' 무리' : ''}에게 들켰습니다! 전투 시작!`, 'bad');
    startCombat(state, rng);
  } else {
    log(state, `⚠️ ${names}${woke.length > 1 ? ' 무리가' : '(이)가'} 전투에 끼어듭니다!`, 'bad');
    for (const m of woke) state.combat.order.push({ id: m.id, init: d(rng, 20) + D.MONSTERS[m.kind].init });
  }
}

function startCombat(state, rng) {
  const order = [];
  for (const h of state.heroes) order.push({ id: h.id, init: d(rng, 20) + D.CLASSES[h.cls].init, hero: 1 });
  for (const m of aliveMonsters(state)) if (m.awake) order.push({ id: m.id, init: d(rng, 20) + D.MONSTERS[m.kind].init, hero: 0 });
  order.sort((a, b) => b.init - a.init || b.hero - a.hero);
  state.combat = { order: order.map(({ id, init }) => ({ id, init })), idx: 0, round: 1, turn: null };
  log(state, '🎲 우선권: ' + order.map((o) => `${entity(state, o.id).name}(${o.init})`).join(' → '), 'dice');
  beginTurn(state);
}
function entity(state, id) {
  return state.heroes.find((h) => h.id === id) || state.monsters.find((m) => m.id === id);
}
function current(state) {
  return state.combat ? entity(state, state.combat.order[state.combat.idx].id) : null;
}
function beginTurn(state) {
  const c = state.combat;
  const e = current(state);
  if (e.id[0] === 'h') {
    e.dodging = false;
    c.turn = { id: e.id, moveLeft: D.CLASSES[e.cls].speed, action: 1, bonus: 1, sneakUsed: false };
    if (!e.down) log(state, `▶ ${e.name}의 차례 (${c.round}라운드)`, 'turn');
  } else {
    c.turn = { id: e.id };
  }
}
function endTurn(state) {
  const c = state.combat;
  if (!c) return;
  c.order = c.order.filter((o, i) => { const e = entity(state, o.id); const keep = e && !e.dead; if (!keep && i < c.idx) c.idx--; return keep; });
  c.idx++;
  if (c.idx >= c.order.length) { c.idx = 0; c.round++; }
  beginTurn(state);
}
function needsAuto(state) {
  if (state.phase !== 'playing' || !state.combat) return false;
  const e = current(state);
  return e.id[0] === 'm' || e.down;
}

function checkEnd(state, rng) {
  if (state.phase !== 'playing') return;
  const final = state.monsters.find((m) => D.MONSTERS[m.kind].final);
  if (final && final.dead) {
    state.phase = 'won';
    state.combat = null;
    state.heroes.forEach((h) => { if (h.down) { h.down = false; h.hp = 1; } });
    log(state, '🏆 붉은 용을 물리치고 황금 용의 알을 되찾았습니다! 모험 성공!', 'good');
    return;
  }
  if (state.heroes.length && state.heroes.every((h) => h.down)) {
    log(state, '😵 파티가 모두 쓰러졌습니다… 황금 용의 가호로 이 층 입구에서 다시 깨어납니다.', 'bad');
    const snap = state.snapshot || { gold: state.gold, potions: state.potions };
    state.gold = snap.gold;
    state.potions = snap.potions;
    state.heroes.forEach(fullRest);
    loadFloor(state, state.floor);
    return;
  }
  if (state.combat && !aliveMonsters(state).some((m) => m.awake)) endCombat(state);
}
function endCombat(state) {
  state.combat = null;
  for (const h of state.heroes) {
    if (h.down) { h.down = h.stable = h.out = false; h.hp = 1; h.saves = { s: 0, f: 0 }; log(state, `${iga(h.name)} 정신을 차렸습니다 (HP 1).`, 'heal'); }
    h.dodging = h.hidden = false;
  }
  log(state, '🎉 전투 승리! 자유롭게 움직일 수 있어요.', 'good');
}

// ---------- damage & healing ----------
function applyDamage(state, rng, tgt, amount, type, opts = {}) {
  if (tgt.id[0] === 'm') {
    const def = D.MONSTERS[tgt.kind];
    let note = '';
    if (def.immune && def.immune.includes(type)) { amount = 0; note = ' (면역!)'; }
    else if (def.vuln && def.vuln.includes(type)) { amount *= 2; note = ' (약점! ×2)'; }
    tgt.hp -= amount;
    if (amount > 0) { tgt.asleep = false; tgt.turned = 0; fx(state, { type: 'dmg', x: tgt.x, y: tgt.y, amount }); }
    let text = `${amount} ${DMG_KO[type] || ''} 피해${note}`;
    if (tgt.hp <= 0) {
      if (def.fortitude && type !== 'radiant' && !opts.crit) {
        const save = d(rng, 20) + def.saves.con;
        if (save >= 5 + amount) { tgt.hp = 1; return text + ` → 🧟 좀비의 끈기! 건강 내성 ${save} 성공, HP 1로 버팁니다`; }
      }
      tgt.hp = 0;
      tgt.dead = true;
      const loot = def.boss ? 25 : 5;
      state.gold += loot;
      fx(state, { type: 'ko', x: tgt.x, y: tgt.y });
      text += ` → 💥 ${tgt.name} 쓰러짐! (+${loot}G)`;
    }
    return text;
  }
  // hero
  if (amount > 0) fx(state, { type: 'dmg', x: tgt.x, y: tgt.y, amount, hero: true });
  if (tgt.down) {
    tgt.saves.f += opts.crit ? 2 : 1;
    if (tgt.saves.f >= 3) { tgt.out = true; tgt.stable = false; return `${amount} 피해 → ${tgt.name} 깊이 기절 (전투가 끝나야 깨어나요)`; }
    return `${amount} 피해 → 쓰러진 ${tgt.name}의 죽음 내성 실패 ${tgt.saves.f}/3`;
  }
  tgt.hp -= amount;
  let text = `${amount} ${DMG_KO[type] || ''} 피해`;
  if (tgt.hp <= 0) {
    tgt.hp = 0;
    tgt.down = true;
    tgt.stable = false;
    tgt.dodging = tgt.hidden = false;
    tgt.saves = { s: 0, f: 0 };
    text += ` → 😵 ${tgt.name} 쓰러짐! 동료가 일으켜 줘야 해요`;
  }
  return text;
}
function heal(state, hero, amount) {
  if (hero.out) return `${eun(hero.name)} 너무 깊이 기절해서 전투 중엔 깨울 수 없어요`;
  fx(state, { type: 'heal', x: hero.x, y: hero.y, amount });
  if (hero.down) {
    hero.down = hero.stable = false;
    hero.saves = { s: 0, f: 0 };
    hero.hp = Math.min(hero.maxHp, amount);
    return `${hero.name} 다시 일어남! HP ${hero.hp}`;
  }
  const before = hero.hp;
  hero.hp = Math.min(hero.maxHp, hero.hp + amount);
  return `${hero.name} HP +${hero.hp - before} (${hero.hp}/${hero.maxHp})`;
}

const enemiesOf = (state, e) => (e.id[0] === 'h' ? aliveMonsters(state).filter((m) => m.awake && !m.asleep) : standing(state));
const adjacentEnemy = (state, e) => enemiesOf(state, e).some((o) => dist(o, e) <= 1);

// Shared attack roll for heroes and monsters (SRD: d20 + bonus vs AC, nat 20 crit, nat 1 miss).
function resolveAttack(state, rng, att, tgt, o) {
  let adv = [], dis = [];
  const isHero = att.id[0] === 'h';
  if (tgt.asleep) adv.push('잠듦');
  if (tgt.id[0] === 'm' && !tgt.awake) adv.push('기습');
  if (tgt.dodging) dis.push('회피 중');
  if (att.hidden) { adv.push('숨어 있음'); att.hidden = false; }
  if (isHero && tgt.helped) { adv.push('동료의 도움'); tgt.helped = false; }
  if (o.ranged && adjacentEnemy(state, att)) dis.push('바로 옆에 적');
  if (!isHero && D.MONSTERS[att.kind].pack && aliveMonsters(state).some((m) => m !== att && m.awake && !m.asleep && dist(m, tgt) <= 1)) adv.push('무리 전술');
  const a = d(rng, 20), b = d(rng, 20);
  let nat = a, rollText = `d20[${a}]`;
  if (adv.length && !dis.length) { nat = Math.max(a, b); rollText = `유리 d20[${a},${b}]`; }
  else if (dis.length && !adv.length) { nat = Math.min(a, b); rollText = `불리 d20[${a},${b}]`; }
  const why = [...adv.map((x) => '+' + x), ...dis.map((x) => '-' + x)].join(' ');
  const total = nat + o.bonus;
  const ac = tgt.id[0] === 'h' ? heroAc(tgt) : tgt.ac;
  let crit = nat >= (o.critRange || 20);
  if (tgt.asleep && !o.ranged && dist(att, tgt) <= 1 && nat !== 1 && total >= ac) crit = true;
  const hit = nat !== 1 && (crit || total >= ac);
  let line = `${att.name}의 ${o.label} → ${tgt.name}: ${rollText}+${o.bonus}=${total} vs AC ${ac}${why ? ' (' + why + ')' : ''}`;
  if (!hit) {
    log(state, line + (nat === 1 ? ' 💨 대실패!' : ' 빗나감'), 'miss');
    fx(state, { type: 'miss', x: tgt.x, y: tgt.y });
    return { hit: false };
  }
  const dmg = rollDice(rng, o.dmg, att.level, crit);
  let total2 = dmg.total + (o.dmgBonus || 0);
  let dtext = dmg.text + (o.dmgBonus ? `+${o.dmgBonus}` : '');
  let sneak = false;
  if (o.sneakDice && !dis.length) {
    const allyNear = state.heroes.some((h) => h !== att && !h.down && dist(h, tgt) <= 1);
    if (adv.length || allyNear) {
      const s = rollDice(rng, [o.sneakDice, 6, 0], 0, crit);
      total2 += s.total;
      dtext += ` +기습${s.text}`;
      sneak = true;
    }
  }
  let res = applyDamage(state, rng, tgt, total2, o.dmgType, { crit });
  if (o.extra && !tgt.dead) {
    const ex = rollDice(rng, o.extra, 0, crit);
    res += ', ' + applyDamage(state, rng, tgt, ex.total, o.extra[3], { crit });
  }
  log(state, `${line} ${crit ? '💥 치명타!' : '명중!'} ${dtext} = ${res}`, crit ? 'crit' : 'hit');
  return { hit: true, sneak };
}

function savingThrow(rng, mon, ability, dc) {
  const r = d(rng, 20);
  const bonus = D.MONSTERS[mon.kind].saves[ability] || 0;
  return { ok: r + bonus >= dc, text: `d20[${r}]${bonus >= 0 ? '+' : ''}${bonus}=${r + bonus} vs ${dc}` };
}
const SAVE_KO = { dex: '민첩', con: '건강', wis: '지혜' };

// ---------- hero abilities ----------
const COMBAT_ONLY = new Set(['dash', 'dodge', 'help', 'revive', 'surge', 'hide']);

function heroAbilities(hero) {
  return [...D.CLASSES[hero.cls].abilities, ...D.COMMON].filter((id) => !(D.ABILITIES[id].minLevel > hero.level));
}

function validTargets(state, hero, ab) {
  const range = ab.range || 0;
  if (ab.target === 'enemy') {
    return aliveMonsters(state).filter((m) => sees(state, hero, m, Math.max(range, 1)) && sees(state, hero, m, VISION)).map((m) => m.id);
  }
  if (ab.target === 'ally') return state.heroes.filter((h) => !h.out && sees(state, hero, h, range)).map((h) => h.id);
  if (ab.target === 'allyDown') return state.heroes.filter((h) => h.down && !h.out && dist(hero, h) <= range).map((h) => h.id);
  return [];
}

// Why an ability can't be used right now (or null if it can).
function blockReason(state, hero, id) {
  const ab = D.ABILITIES[id];
  if (hero.down) return '쓰러져 있어요';
  const c = state.combat;
  if (c) {
    if (c.turn.id !== hero.id) return '내 차례가 아니에요';
    if (ab.cost === 'action' && c.turn.action < 1) return '행동을 이미 썼어요';
    if (ab.cost === 'bonus' && c.turn.bonus < 1) return '보조 행동을 이미 썼어요';
  } else if (COMBAT_ONLY.has(ab.type)) return '전투 중에만 써요';
  if (ab.slot && hero.slots < 1) return '주문 슬롯이 없어요';
  if (ab.uses && hero.uses[ab.uses] < 1) return '휴식 후 다시 쓸 수 있어요';
  if (ab.type === 'potion' && state.potions < 1) return '물약이 없어요';
  if (['enemy', 'ally', 'allyDown'].includes(ab.target) && !validTargets(state, hero, ab).length) return '대상이 없어요';
  return null;
}

function useAbility(state, rng, hero, id, target = {}) {
  if (!heroAbilities(hero).includes(id)) return '쓸 수 없는 능력이에요';
  const ab = D.ABILITIES[id];
  const why = blockReason(state, hero, id);
  if (why) return why;
  let tgt = null;
  if (['enemy', 'ally', 'allyDown'].includes(ab.target)) {
    if (!validTargets(state, hero, ab).includes(target.id)) return '그 대상은 사거리 밖이거나 보이지 않아요';
    tgt = entity(state, target.id);
  }
  if (ab.target === 'point') {
    const p = { x: target.x | 0, y: target.y | 0 };
    if (!sees(state, hero, p, ab.range)) return '그 지점은 사거리 밖이거나 보이지 않아요';
    tgt = p;
  }
  const turn = state.combat && state.combat.turn;
  if (turn) {
    if (ab.cost === 'action') turn.action--;
    if (ab.cost === 'bonus') turn.bonus--;
  }
  if (ab.slot) hero.slots--;
  if (ab.uses) hero.uses[ab.uses]--;
  const touched = [];

  switch (ab.type) {
    case 'attack': {
      const r = resolveAttack(state, rng, hero, tgt, {
        label: ab.name, bonus: ab.bonus + (ab.weapon ? hero.weaponBonus : 0), dmg: ab.dmg, dmgBonus: ab.weapon ? hero.weaponBonus : 0,
        dmgType: ab.dmgType, ranged: ab.ranged, critRange: hero.cls === 'fighter' && hero.level >= 3 ? 19 : 20,
        sneakDice: ab.sneak && !(turn && turn.sneakUsed) ? (hero.level >= 3 ? 2 : 1) : 0,
      });
      if (r.sneak && turn) turn.sneakUsed = true;
      touched.push(tgt);
      break;
    }
    case 'missile': {
      const parts = [];
      for (let i = 0; i < ab.darts && !tgt.dead; i++) {
        const r = rollDice(rng, ab.dmg, 0);
        parts.push(`${r.text}: ${applyDamage(state, rng, tgt, r.total, ab.dmgType)}`);
      }
      log(state, `${hero.name}의 ${ab.name} → ${tgt.name}: ${parts.join(' / ')}`, 'hit');
      touched.push(tgt);
      break;
    }
    case 'save': {
      const s = savingThrow(rng, tgt, ab.save, ab.dc);
      if (s.ok) log(state, `${hero.name}의 ${ab.name} → ${tgt.name} ${SAVE_KO[ab.save]} 내성 ${s.text} 성공, 피했어요`, 'miss');
      else { const r = rollDice(rng, ab.dmg, 0); log(state, `${hero.name}의 ${ab.name} → ${tgt.name} ${SAVE_KO[ab.save]} 내성 ${s.text} 실패! ${r.text} = ${applyDamage(state, rng, tgt, r.total, ab.dmgType)}`, 'hit'); }
      touched.push(tgt);
      break;
    }
    case 'burst': {
      const hit = aliveMonsters(state).filter((m) => dist(m, hero) <= ab.radius);
      const r = rollDice(rng, ab.dmg, 0);
      const parts = hit.map((m) => {
        const s = savingThrow(rng, m, ab.save, ab.dc);
        const amt = s.ok ? Math.floor(r.total / 2) : r.total;
        touched.push(m);
        return `${m.name} ${s.ok ? '성공(절반)' : '실패'}: ${applyDamage(state, rng, m, amt, ab.dmgType)}`;
      });
      fx(state, { type: 'burst', x: hero.x, y: hero.y, r: ab.radius });
      log(state, `${hero.name}의 ${ab.name}! ${r.text}=${r.total} → ${parts.join(' / ') || '주변에 적이 없었어요'}`, 'hit');
      break;
    }
    case 'sleep': {
      const pool0 = rollDice(rng, ab.pool, 0);
      let pool = pool0.total;
      const cands = aliveMonsters(state)
        .filter((m) => dist(m, tgt) <= ab.radius && !m.asleep && !D.MONSTERS[m.kind].undead)
        .sort((a, b) => a.hp - b.hp);
      const slept = [];
      for (const m of cands) { if (m.hp > pool) break; pool -= m.hp; m.asleep = true; slept.push(m.name); }
      fx(state, { type: 'burst', x: tgt.x, y: tgt.y, r: ab.radius, sleep: true });
      log(state, `${hero.name}의 ${ab.name} ${pool0.text}=${pool0.total} → ${slept.length ? slept.join(', ') + ' 💤 잠들었어요!' : '아무도 잠들지 않았어요 (언데드는 잠들지 않아요)'}`, 'good');
      break;
    }
    case 'heal': case 'potion': {
      const t = ab.target === 'self' ? hero : tgt;
      if (ab.type === 'potion') state.potions--;
      const r = rollDice(rng, ab.heal, hero.level);
      log(state, `${hero.name}의 ${ab.name} ${r.text} → ${heal(state, t, r.total)}`, 'heal');
      break;
    }
    case 'revive':
      log(state, `${iga(hero.name)} ${eul(tgt.name)} 일으켜 세웁니다 → ${heal(state, tgt, 1)}`, 'heal');
      break;
    case 'dash':
      turn.moveLeft += D.CLASSES[hero.cls].speed;
      log(state, `${hero.name} ${ab.name}! 이동력 +${D.CLASSES[hero.cls].speed}`, 'info');
      break;
    case 'dodge':
      hero.dodging = true;
      log(state, `${hero.name} 회피 자세! 다음 차례까지 공격받기 어려워요`, 'info');
      break;
    case 'help':
      tgt.helped = true;
      log(state, `${iga(hero.name)} ${eul(tgt.name)} 방해합니다. 다음 동료 공격이 유리!`, 'info');
      break;
    case 'surge':
      turn.action++;
      log(state, `${hero.name}의 ⚡기세 폭발! 행동을 한 번 더 할 수 있어요`, 'good');
      break;
    case 'hide': {
      const r = d(rng, 20);
      hero.hidden = r + 7 >= 12;
      log(state, `${hero.name} 숨기 시도: d20[${r}]+7=${r + 7} vs 12 → ${hero.hidden ? '성공! 다음 공격 유리' : '들켰어요'}`, hero.hidden ? 'good' : 'miss');
      break;
    }
    case 'turn': {
      const und = aliveMonsters(state).filter((m) => D.MONSTERS[m.kind].undead && sees(state, hero, m, ab.radius));
      const parts = und.map((m) => {
        const s = savingThrow(rng, m, ab.save, ab.dc);
        if (!s.ok) { m.turned = 3; if (!m.awake) touched.push(m); }
        return `${m.name} ${s.text} ${s.ok ? '버팀' : '겁에 질림!'}`;
      });
      log(state, `${hero.name}의 ☀️${ab.name}! ${parts.join(' / ') || '주변에 언데드가 없어요'}`, 'good');
      break;
    }
    default:
      break;
  }

  // Attacking a monster alerts it and its friends.
  const woke = [];
  for (const m of touched) if (m && m.id && m.id[0] === 'm' && !m.dead) wakeGroup(state, m, woke);
  handleWoke(state, rng, woke);
  checkEnd(state, rng);
  return null;
}

// ---------- hero movement ----------
function pickup(state, hero) {
  const it = state.items.find((i) => i.x === hero.x && i.y === hero.y);
  if (!it) return;
  state.items = state.items.filter((i) => i !== it);
  if (it.kind === 'potion') { state.potions++; log(state, `🧪 ${iga(hero.name)} 치유 물약을 주웠어요! (파티 물약 ${state.potions}개)`, 'good'); return; }
  const parts = [];
  if (it.gold) { state.gold += it.gold; parts.push(`💰 ${it.gold}골드`); }
  if (it.potions) { state.potions += it.potions; parts.push(`🧪 물약 ${it.potions}개`); }
  if (it.item) {
    const item = D.ITEMS[it.item];
    hero.items.push(it.item);
    if (it.item === 'weapon') hero.weaponBonus++;
    if (it.item === 'cloak') hero.acBonus++;
    if (it.item === 'amulet') { hero.hpBonus += 5; hero.maxHp += 5; hero.hp += 5; }
    parts.push(`${item.icon} ${item.name} (${item.desc})`);
  }
  fx(state, { type: 'chest', x: hero.x, y: hero.y });
  log(state, `🎁 ${iga(hero.name)} 보물상자를 열었어요: ${parts.join(', ')}`, 'good');
}

function moveHero(state, rng, hero, tx, ty) {
  if (hero.down) return '쓰러져 있어요';
  const c = state.combat;
  if (c && c.turn.id !== hero.id) return '내 차례가 아니에요';
  if (!walkable(state, tx, ty)) return '갈 수 없는 곳이에요';
  if (heroAt(state, tx, ty) || monsterAt(state, tx, ty)) return '이미 누가 있어요';
  const { map } = reachable(state, hero);
  if (!map.has(ty * state.map.w + tx)) return c ? '이동력이 모자라요' : '길이 막혀 있어요';
  const path = pathTo(state, map, tx, ty);
  let woke = [];
  for (const [x, y] of path) {
    hero.x = x;
    hero.y = y;
    if (c) c.turn.moveLeft--;
    pickup(state, hero);
    updateSeen(state);
    woke = woke.concat(checkWake(state));
    // stop when spotted, but never on top of a friend we were passing through
    if (woke.length && !state.heroes.some((h) => h !== hero && h.x === x && h.y === y)) break;
  }
  handleWoke(state, rng, woke);
  return null;
}

// ---------- monster AI ----------
function monsterTurn(state, rng, m) {
  const def = D.MONSTERS[m.kind];
  if (m.asleep) { log(state, `💤 ${eun(m.name)} 쿨쿨 자고 있어요.`, 'info'); return; }
  if (m.turned > 0) { m.turned--; log(state, `😱 ${iga(m.name)} 겁에 질려 웅크리고 있어요.`, 'info'); return; }
  let targets = standing(state);
  if (!targets.length) return;
  const melee = def.attacks.find((a) => !a.ranged);
  const ranged = def.attacks.find((a) => a.ranged);
  const atk = (a, t) => resolveAttack(state, rng, m, t, { label: a.name, bonus: a.bonus, dmg: a.dmg, dmgType: a.dmgType, ranged: a.ranged, extra: a.extra });

  if (def.breath) {
    if (!m.breathReady) {
      const r = d(rng, 6);
      if (r >= 5) { m.breathReady = true; log(state, `🔥 ${m.name}의 목구멍에서 불꽃이 다시 차오릅니다! (d6[${r}])`, 'bad'); }
    }
    const inRange = targets.filter((h) => sees(state, m, h, def.breath.radius));
    if (m.breathReady && inRange.length && (inRange.length >= 2 || rng() < 0.5)) {
      m.breathReady = false;
      const r = rollDice(rng, def.breath.dmg, 0);
      fx(state, { type: 'burst', x: m.x, y: m.y, r: def.breath.radius, fire: true });
      const parts = inRange.map((h) => {
        const roll = d(rng, 20);
        const bonus = h.cls === 'rogue' ? 3 : h.cls === 'wizard' ? 2 : 1;
        const ok = roll + bonus >= def.breath.dc;
        return `${h.name} 민첩 d20[${roll}]+${bonus} ${ok ? '성공(절반)' : '실패'}: ${applyDamage(state, rng, h, ok ? Math.floor(r.total / 2) : r.total, def.breath.dmgType)}`;
      });
      log(state, `🔥🔥 ${m.name}의 ${def.breath.name}! ${r.text}=${r.total} → ${parts.join(' / ')}`, 'bad');
      return;
    }
  }

  const attackAdjacent = () => {
    for (let i = 0; i < (def.multi || 1); i++) {
      const adj = standing(state).filter((h) => dist(h, m) <= 1).sort((a, b) => a.hp - b.hp);
      if (!adj.length) return i > 0;
      atk(melee, adj[0]);
    }
    return true;
  };
  const shoot = () => {
    if (!ranged) return false;
    const vis = standing(state).filter((h) => sees(state, m, h, ranged.range)).sort((a, b) => dist(a, m) - dist(b, m));
    if (!vis.length) return false;
    atk(ranged, vis[0]);
    return true;
  };

  if (standing(state).some((h) => dist(h, m) <= 1)) { attackAdjacent(); return; }
  if (def.prefersRanged && shoot()) return;

  // Walk toward the closest free tile next to a standing hero.
  // Monsters may step over fallen heroes and squeeze past each other, but never stop on anyone.
  const passable = (x, y) => walkable(state, x, y) && !state.heroes.some((h) => !h.down && h.x === x && h.y === y);
  const taken = (x, y) => (monsterAt(state, x, y) && (x !== m.x || y !== m.y)) || heroAt(state, x, y);
  const map = bfs(state, m.x, m.y, passable);
  const nearest = (x, y) => Math.min(...targets.map((h) => Math.max(Math.abs(h.x - x), Math.abs(h.y - y))));
  let best = null;
  for (const [k, v] of map) {
    const x = k % state.map.w, y = Math.floor(k / state.map.w);
    if (taken(x, y)) continue;
    if (nearest(x, y) <= 1 && (!best || v.d < best.d)) best = { x, y, d: v.d };
  }
  const speed = D.MONSTERS[m.kind].speed;
  if (!best) {
    // nobody reachable right now: get as close as possible this turn
    for (const [k, v] of map) {
      const x = k % state.map.w, y = Math.floor(k / state.map.w);
      if (v.d > speed || taken(x, y)) continue;
      if (!best || nearest(x, y) < nearest(best.x, best.y)) best = { x, y, d: v.d };
    }
    if (best && nearest(best.x, best.y) >= nearest(m.x, m.y)) best = null;
  }
  if (best) {
    const path = pathTo(state, map, best.x, best.y).slice(0, speed);
    while (path.length && taken(path[path.length - 1][0], path[path.length - 1][1])) path.pop();
    if (path.length) { const [x, y] = path[path.length - 1]; m.x = x; m.y = y; }
  }
  if (standing(state).some((h) => dist(h, m) <= 1)) { attackAdjacent(); return; }
  if (!shoot() && !best) log(state, `${iga(m.name)} 길을 찾지 못해 서성입니다.`, 'info');
}

function deathSave(state, rng, hero) {
  if (hero.out || hero.stable) return;
  const r = d(rng, 20);
  if (r === 20) { hero.down = false; hero.hp = 1; hero.saves = { s: 0, f: 0 }; log(state, `✨ ${hero.name} 죽음 내성 d20[20]! 기적처럼 일어납니다 (HP 1)`, 'good'); return; }
  if (r === 1) hero.saves.f += 2;
  else if (r >= 10) hero.saves.s++;
  else hero.saves.f++;
  if (hero.saves.s >= 3) { hero.stable = true; log(state, `${hero.name} 죽음 내성 d20[${r}] 성공 3번 → 안정됨 (전투 후 깨어나요)`, 'info'); return; }
  if (hero.saves.f >= 3) { hero.out = true; log(state, `${hero.name} 죽음 내성 d20[${r}] 실패 3번 → 깊이 기절 (전투 후 깨어나요)`, 'bad'); return; }
  log(state, `${hero.name} 죽음 내성 d20[${r}] → 성공 ${hero.saves.s}/3, 실패 ${hero.saves.f}/3`, r >= 10 ? 'info' : 'bad');
}

// One automatic step: a monster's whole turn or a downed hero's death save.
function autoStep(state, rng) {
  if (!needsAuto(state)) return false;
  const e = current(state);
  if (e.id[0] === 'm') monsterTurn(state, rng, e);
  else deathSave(state, rng, e);
  checkEnd(state, rng);
  if (state.combat) endTurn(state);
  return true;
}

// ---------- player actions ----------
function act(state, rng, pid, a) {
  const mine = (id) => { const h = state.heroes.find((x) => x.id === id); return h && h.owner === pid ? h : null; };
  switch (a.type) {
    case 'join': {
      const name = String(a.name || '').trim().slice(0, 10);
      if (!name) return '이름을 입력해 주세요';
      if (!D.CLASSES[a.cls]) return '직업을 골라 주세요';
      if (state.heroes.length >= MAX_HEROES) return `영웅은 최대 ${MAX_HEROES}명까지예요`;
      if (state.phase === 'playing' && state.combat) return '전투가 끝나면 들어올 수 있어요';
      if (state.phase === 'won') return '새 모험을 시작한 뒤 들어와 주세요';
      const hero = makeHero(state, pid, name, a.cls);
      state.heroes.push(hero);
      if (state.phase === 'playing') {
        setLevel(hero, state.floor + 1);
        const anchor = state.heroes[0];
        [hero.x, hero.y] = freeTileNear(state, anchor.x, anchor.y);
        updateSeen(state);
      }
      log(state, `${hero.icon} ${hero.name}(${D.CLASSES[a.cls].name}) 님이 모험에 합류했어요!`, 'good');
      return null;
    }
    case 'leave': {
      const h = mine(a.heroId);
      if (!h) return '내 영웅이 아니에요';
      if (state.phase === 'playing' && state.combat) return '전투 중엔 나갈 수 없어요';
      state.heroes = state.heroes.filter((x) => x !== h);
      log(state, `${iga(h.name)} 모험을 떠났어요.`, 'info');
      return null;
    }
    case 'start': {
      if (state.phase !== 'lobby') return '이미 시작했어요';
      if (!state.heroes.length) return '영웅이 한 명 이상 필요해요';
      state.phase = 'playing';
      state.gold = 0;
      state.potions = 3;
      state.heroes.forEach((h) => { h.items = []; h.weaponBonus = h.acBonus = h.hpBonus = 0; setLevel(h, 1); });
      enterFloor(state, 0);
      return null;
    }
    case 'restart': {
      const keep = state.heroes;
      Object.assign(state, newGame(), { heroes: keep, seq: state.seq, nextId: state.nextId });
      log(state, '🔄 새 모험을 준비합니다. 모두 준비되면 "모험 시작"을 눌러 주세요.', 'info');
      return null;
    }
  }
  if (state.phase !== 'playing') return '게임이 진행 중이 아니에요';
  switch (a.type) {
    case 'move': {
      const h = mine(a.heroId);
      if (!h) return '내 영웅이 아니에요';
      return moveHero(state, rng, h, a.x | 0, a.y | 0);
    }
    case 'ability': {
      const h = mine(a.heroId);
      if (!h) return '내 영웅이 아니에요';
      return useAbility(state, rng, h, a.ability, a.target || {});
    }
    case 'endTurn': {
      const c = state.combat;
      if (!c) return '전투 중이 아니에요';
      const h = entity(state, c.turn.id);
      if (h.owner !== pid && !a.force) return '내 차례가 아니에요';
      log(state, `${h.name} 턴 종료${h.owner !== pid ? ' (대신 넘김)' : ''}`, 'info');
      endTurn(state);
      return null;
    }
    case 'shortRest': {
      if (state.combat) return '전투 중엔 쉴 수 없어요';
      if (state.shortRestUsed) return '이 층에서는 이미 쉬었어요';
      state.shortRestUsed = true;
      for (const h of state.heroes) {
        h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp / 2));
        h.uses.secondWind = 1;
        h.uses.actionSurge = 1;
        if (h.cls === 'wizard') h.slots = Math.min(h.maxSlots, h.slots + 1);
      }
      log(state, '🏕️ 짧은 휴식: 모두 최대 HP의 절반을 회복하고, 전사 능력이 돌아오고, 마법사는 주문 슬롯 1개를 되찾았어요.', 'heal');
      return null;
    }
    case 'descend': {
      if (state.combat) return '전투 중이에요';
      if (!state.heroes.some((h) => tileAt(state, h.x, h.y) === '>')) return '계단 위에 영웅이 있어야 해요';
      if (state.floor + 1 >= D.FLOORS.length) return '더 내려갈 곳이 없어요';
      enterFloor(state, state.floor + 1);
      return null;
    }
  }
  return '알 수 없는 행동이에요';
}

function enterFloor(state, idx) {
  if (idx > 0) {
    for (const h of state.heroes) {
      setLevel(h, Math.min(3, idx + 1));
      const msg = D.CLASSES[h.cls].levelUp[h.level - 1];
      log(state, `⬆️ ${h.name} 레벨 ${h.level}! 최대 HP ${h.maxHp}${msg ? ', ' + msg : ''}`, 'good');
    }
  }
  loadFloor(state, idx);
  state.snapshot = { gold: state.gold, potions: state.potions };
  log(state, `🗺️ ${D.FLOORS[idx].name}`, 'turn');
  log(state, D.FLOORS[idx].intro, 'info');
}

// ---------- what each browser sees ----------
function view(state, pid) {
  const out = { phase: state.phase, gold: state.gold, potions: state.potions, log: state.log.slice(-50), fx: state.fx,
    shortRestUsed: state.shortRestUsed, maxHeroes: MAX_HEROES };
  out.classes = Object.fromEntries(Object.entries(D.CLASSES).map(([k, c]) => [k, { name: c.name, icon: c.icon, color: c.color, desc: c.desc, hp: c.hp[0], ac: c.ac }]));
  out.heroes = state.heroes.map((h) => ({
    id: h.id, name: h.name, cls: h.cls, clsName: D.CLASSES[h.cls].name, icon: h.icon, color: h.color, level: h.level, x: h.x, y: h.y,
    hp: h.hp, maxHp: h.maxHp, ac: heroAc(h), slots: h.slots, maxSlots: h.maxSlots, down: h.down, stable: h.stable, out: h.out,
    saves: h.saves, dodging: h.dodging, hidden: h.hidden, items: h.items.map((i) => D.ITEMS[i]), mine: h.owner === pid,
  }));
  if (!state.map) return out;
  const vis = visibleSet(state);
  const w = state.map.w;
  out.floor = { idx: state.floor, name: D.FLOORS[state.floor].name, count: D.FLOORS.length };
  out.map = { w, h: state.map.h, tiles: state.map.tiles };
  out.seen = state.seen;
  out.visible = Array.from(vis).join('');
  const inOrder = new Set(state.combat ? state.combat.order.map((o) => o.id) : []);
  out.monsters = aliveMonsters(state)
    .filter((m) => vis[m.y * w + m.x] || inOrder.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, icon: m.icon, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, ac: m.ac,
      awake: m.awake, asleep: m.asleep, turned: m.turned > 0, helped: m.helped, boss: !!D.MONSTERS[m.kind].boss }));
  out.items = state.items.filter((i) => state.seen[i.y * w + i.x] === '1').map((i) => ({ id: i.id, kind: i.kind, x: i.x, y: i.y }));
  out.canDescend = !state.combat && state.floor + 1 < D.FLOORS.length && state.heroes.some((h) => tileAt(state, h.x, h.y) === '>');
  if (state.combat) {
    const c = state.combat;
    out.combat = { round: c.round, current: c.turn.id, turn: c.turn,
      order: c.order.map((o) => { const e = entity(state, o.id); return { id: o.id, name: e.name, icon: e.icon, init: o.init, hero: o.id[0] === 'h', down: !!e.down }; }) };
  }
  out.controls = {};
  for (const h of state.heroes) {
    if (h.owner !== pid || state.phase !== 'playing') continue;
    const myTurn = !state.combat || state.combat.turn.id === h.id;
    out.controls[h.id] = {
      myTurn,
      reach: myTurn && !h.down ? reachable(state, h).tiles : [],
      abilities: heroAbilities(h).map((id) => {
        const ab = D.ABILITIES[id];
        const blocked = blockReason(state, h, id);
        return { id, name: ab.name, icon: ab.icon, cost: ab.cost, desc: ab.desc, target: ab.target, range: ab.range || 0, radius: ab.radius || 0,
          slot: !!ab.slot, blocked, targets: blocked ? [] : validTargets(state, h, ab), combatOnly: COMBAT_ONLY.has(ab.type) };
      }),
    };
  }
  return out;
}

module.exports = { newGame, act, autoStep, needsAuto, view, mulberry32, loadFloor, makeHero, setLevel, enterFloor, useAbility, moveHero, los, dist, current, D, classes: () => D.CLASSES };
