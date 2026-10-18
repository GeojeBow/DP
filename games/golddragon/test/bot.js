'use strict';
// A simple autopilot used by tests: plays every hero until the game is won.
const G = require('../game');

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const ATTACK_PREF = ['magicMissile', 'longsword', 'mace', 'shortsword', 'firebolt', 'shortbow', 'javelin', 'sacredFlame'];

function tryAttack(state, rng, pid, hero) {
  const v = G.view(state, pid).controls[hero.id];
  if (!v) return false;
  const heal = v.abilities.find((a) => (a.id === 'healingWord' || a.id === 'potion') && !a.blocked && a.targets.some((id) => { const h = state.heroes.find((x) => x.id === id); return h && h.down; }));
  if (heal) {
    const id = heal.targets.find((t) => state.heroes.find((x) => x.id === t).down);
    return !G.act(state, rng, pid, { type: 'ability', heroId: hero.id, ability: heal.id, target: { id } });
  }
  for (const id of ATTACK_PREF) {
    const a = v.abilities.find((x) => x.id === id && !x.blocked);
    if (!a || !a.targets.length) continue;
    if (id === 'firebolt' && a.targets.every((t) => state.monsters.find((m) => m.id === t).kind === 'dragon')) continue;
    const target = a.targets.map((t) => state.monsters.find((m) => m.id === t)).sort((p, q) => dist(p, hero) - dist(q, hero))[0];
    return !G.act(state, rng, pid, { type: 'ability', heroId: hero.id, ability: id, target: { id: target.id } });
  }
  return false;
}

function stepToward(state, rng, pid, hero, goal) {
  const v = G.view(state, pid).controls[hero.id];
  if (!v || !v.reach.length) return false;
  const best = v.reach.slice().sort((p, q) => dist({ x: p[0], y: p[1] }, goal) - dist({ x: q[0], y: q[1] }, goal))[0];
  if (dist({ x: best[0], y: best[1] }, goal) >= dist(hero, goal)) return false;
  return !G.act(state, rng, pid, { type: 'move', heroId: hero.id, x: best[0], y: best[1] });
}

function stairs(state) {
  for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) if (state.map.tiles[y][x] === '>') return { x, y };
  return null;
}

// Advance the game by one decision. Returns false when nothing is left to do.
function botStep(state, rng, pid) {
  if (state.phase !== 'playing') return false;
  if (G.needsAuto(state)) return G.autoStep(state, rng);
  if (state.combat) {
    const hero = G.current(state);
    const targets = state.monsters.filter((m) => !m.dead && m.awake);
    const goal = targets.sort((a, b) => dist(a, hero) - dist(b, hero))[0];
    if (!tryAttack(state, rng, pid, hero) && goal) {
      stepToward(state, rng, pid, hero, goal);
      if (state.combat && state.combat.turn.id === hero.id) tryAttack(state, rng, pid, hero);
    }
    if (state.combat && state.combat.turn.id === hero.id) G.act(state, rng, pid, { type: 'endTurn' });
    return true;
  }
  if (!state.shortRestUsed && state.heroes.some((h) => h.hp < h.maxHp / 2)) return !G.act(state, rng, pid, { type: 'shortRest' });
  const lead = state.heroes[0];
  const alive = state.monsters.filter((m) => !m.dead).sort((a, b) => dist(a, lead) - dist(b, lead));
  if (alive.length) {
    for (const h of state.heroes) if (!state.combat) stepToward(state, rng, pid, h, alive[0]);
    if (!state.combat) {
      // nobody noticed us yet: attack from where we stand or walk right next to the monster
      if (!tryAttack(state, rng, pid, lead)) {
        const m = alive[0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          if (!G.act(state, rng, pid, { type: 'move', heroId: lead.id, x: m.x + dx, y: m.y + dy })) break;
        }
      }
    }
    return true;
  }
  const s = stairs(state);
  if (s) {
    if (G.act(state, rng, pid, { type: 'descend' })) G.act(state, rng, pid, { type: 'move', heroId: lead.id, x: s.x, y: s.y });
    return true;
  }
  return false;
}

module.exports = { botStep };
