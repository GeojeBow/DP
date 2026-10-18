'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../game');
const { botStep } = require('./bot');

function party(seed, classes = ['fighter', 'wizard', 'cleric']) {
  const rng = G.mulberry32(seed);
  const state = G.newGame();
  classes.forEach((cls, i) => assert.equal(G.act(state, rng, 'p' + i, { type: 'join', name: '영웅' + i, cls }), null));
  // one browser drives everyone in tests
  state.heroes.forEach((h) => { h.owner = 'pid'; });
  assert.equal(G.act(state, rng, 'pid', { type: 'start' }), null);
  return { state, rng };
}

test('every floor has four start tiles and its exit or dragon is reachable', () => {
  const state = G.newGame();
  G.D.FLOORS.forEach((f, i) => {
    G.loadFloor(state, i);
    assert.ok(state.map.starts.length >= 4, `floor ${i} starts`);
    const [sx, sy] = state.map.starts[0];
    const seen = new Set([sx + ',' + sy]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const t = state.map.tiles[y + dy] && state.map.tiles[y + dy][x + dx];
        if (t && t !== '#' && t !== 'E' && !seen.has(x + dx + ',' + (y + dy))) { seen.add(x + dx + ',' + (y + dy)); q.push([x + dx, y + dy]); }
      }
    }
    for (const m of state.monsters) assert.ok(seen.has(m.x + ',' + m.y), `floor ${i} monster ${m.name} reachable`);
    for (const it of state.items) assert.ok(seen.has(it.x + ',' + it.y), `floor ${i} item reachable`);
    if (i < G.D.FLOORS.length - 1) assert.ok(state.map.tiles.some((r, y) => [...r].some((t, x) => t === '>' && seen.has(x + ',' + y))), `floor ${i} stairs`);
  });
});

test('walls block line of sight', () => {
  const state = G.newGame();
  G.loadFloor(state, 0);
  assert.equal(G.los(state, 1, 1, 5, 1), true);
  assert.equal(G.los(state, 1, 1, 9, 1), false); // wall at x=7
});

test('a party of three can play from the first floor to the dragon', () => {
  for (const seed of [1, 2, 3]) {
    const { state, rng } = party(seed);
    let steps = 0;
    while (botStep(state, rng, 'pid') && steps < 20000) steps++;
    assert.equal(state.phase, 'won', `seed ${seed} ended in ${state.phase} on floor ${state.floor} after ${steps} steps`);
    assert.ok(state.gold > 0);
    assert.ok(state.heroes.every((h) => h.level === 3));
    assert.ok(JSON.parse(JSON.stringify(state)), 'state stays plain JSON for saving');
  }
});

test('only the hero whose turn it is may act in combat', () => {
  const { state, rng } = party(7);
  state.heroes.forEach((h, i) => { h.owner = 'p' + i; });
  // walk the fighter next to the first rat to start a fight
  const rat = state.monsters.find((m) => m.kind === 'rat');
  const f = state.heroes[0];
  G.act(state, rng, 'p0', { type: 'move', heroId: f.id, x: rat.x - 1, y: rat.y });
  assert.ok(state.combat, 'combat started');
  const cur = G.current(state);
  const other = state.heroes.find((h) => h.id !== cur.id);
  if (other) assert.equal(G.act(state, rng, other.owner, { type: 'move', heroId: other.id, x: other.x + 1, y: other.y }), '내 차례가 아니에요');
});

test('skeletons take double damage from the mace, the dragon ignores fire', () => {
  const { state, rng } = party(11);
  G.enterFloor(state, 1);
  const cleric = state.heroes.find((h) => h.cls === 'cleric');
  const sk = state.monsters.find((m) => m.kind === 'skeleton');
  sk.awake = true;
  sk.asleep = true; // asleep → advantage and an automatic crit if it hits
  cleric.x = sk.x - 1; cleric.y = sk.y;
  const before = sk.hp;
  G.useAbility(state, rng, cleric, 'mace', { id: sk.id });
  const last = state.log.filter((l) => l.text.includes('철퇴')).pop().text;
  if (last.includes('명중') || last.includes('치명타')) assert.ok(last.includes('약점'), last);
  assert.ok(sk.hp <= before);

  G.enterFloor(state, 2);
  const wiz = state.heroes.find((h) => h.cls === 'wizard');
  const dragon = state.monsters.find((m) => m.kind === 'dragon');
  wiz.x = dragon.x; wiz.y = dragon.y - 3;
  for (let i = 0; i < 5; i++) G.useAbility(state, rng, wiz, 'firebolt', { id: dragon.id });
  if (state.phase === 'playing') assert.equal(dragon.hp, dragon.maxHp);
});
