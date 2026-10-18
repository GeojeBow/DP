'use strict';
// Game data: classes, abilities, monsters and floors.
// Numbers follow the System Reference Document 5.1 (CC-BY-4.0, Wizards of the Coast),
// with a few family-friendly tweaks noted inline.

// dice are [count, sides, flat]; flat may be 'level'
const ABILITIES = {
  // ---- shared by every hero ----
  dash: { name: '질주', icon: '👟', cost: 'action', target: 'self', type: 'dash', desc: '이번 턴 이동력을 한 번 더 얻습니다.' },
  dodge: { name: '회피', icon: '🌀', cost: 'action', target: 'self', type: 'dodge', desc: '다음 내 턴까지 나를 노리는 공격이 불리해집니다.' },
  help: { name: '돕기', icon: '🤝', cost: 'action', target: 'enemy', range: 1, type: 'help', desc: '옆의 적을 방해해서, 다음에 그 적을 치는 동료가 유리해집니다.' },
  potion: { name: '치유 물약', icon: '🧪', cost: 'bonus', target: 'ally', range: 1, type: 'potion', heal: [2, 4, 2], desc: '나 또는 옆의 동료가 2d4+2 회복. 쓰러진 동료도 일으킵니다.' },
  revive: { name: '일으켜 세우기', icon: '✋', cost: 'action', target: 'allyDown', range: 1, type: 'revive', desc: '옆에 쓰러진 동료를 HP 1로 일으킵니다.' },

  // ---- fighter ----
  longsword: { name: '롱소드', icon: '⚔️', cost: 'action', target: 'enemy', range: 1, type: 'attack', bonus: 5, dmg: [1, 8, 3], dmgType: 'slashing', weapon: true, desc: '근접 공격 +5, 1d8+3 베기.' },
  javelin: { name: '투창', icon: '🔱', cost: 'action', target: 'enemy', range: 6, ranged: true, type: 'attack', bonus: 5, dmg: [1, 6, 3], dmgType: 'piercing', weapon: true, desc: '6칸 원거리 공격 +5, 1d6+3.' },
  secondWind: { name: '재정비', icon: '💪', cost: 'bonus', target: 'self', type: 'heal', heal: [1, 10, 'level'], uses: 'secondWind', desc: '스스로 1d10+레벨 회복 (휴식마다 1번).' },
  actionSurge: { name: '기세 폭발', icon: '⚡', cost: 'free', target: 'self', type: 'surge', uses: 'actionSurge', minLevel: 2, desc: '이번 턴 행동을 하나 더 얻습니다 (휴식마다 1번).' },

  // ---- wizard ----
  firebolt: { name: '화염 화살', icon: '🔥', cost: 'action', target: 'enemy', range: 12, ranged: true, type: 'attack', bonus: 5, dmg: [1, 10, 0], dmgType: 'fire', desc: '주문 공격 +5, 1d10 화염. 몇 번이든 쓸 수 있어요.' },
  magicMissile: { name: '마법 화살', icon: '✨', cost: 'action', target: 'enemy', range: 12, slot: true, type: 'missile', darts: 3, dmg: [1, 4, 1], dmgType: 'force', desc: '빗나가지 않는 화살 3발, 각 1d4+1. 주문 슬롯 1개.' },
  thunderwave: { name: '천둥파', icon: '💥', cost: 'action', target: 'self', slot: true, type: 'burst', radius: 1, save: 'con', dc: 13, dmg: [2, 8, 0], half: true, dmgType: 'thunder', desc: '나를 둘러싼 적 모두 2d8 (건강 내성 성공 시 절반). 주문 슬롯 1개.' },
  sleep: { name: '잠재우기', icon: '💤', cost: 'action', target: 'point', range: 12, slot: true, type: 'sleep', radius: 2, pool: [5, 8, 0], desc: '고른 지점 2칸 안의 적을 HP가 낮은 순서대로 5d8만큼 재웁니다. 주문 슬롯 1개.' },

  // ---- cleric ----
  mace: { name: '철퇴', icon: '🔨', cost: 'action', target: 'enemy', range: 1, type: 'attack', bonus: 4, dmg: [1, 6, 2], dmgType: 'bludgeoning', weapon: true, desc: '근접 공격 +4, 1d6+2 타격. 해골에게 두 배!' },
  sacredFlame: { name: '성스러운 불꽃', icon: '🌟', cost: 'action', target: 'enemy', range: 12, type: 'save', save: 'dex', dc: 13, dmg: [1, 8, 0], dmgType: 'radiant', desc: '적이 민첩 내성에 실패하면 1d8 광휘. 몇 번이든 쓸 수 있어요.' },
  cureWounds: { name: '상처 치료', icon: '💚', cost: 'action', target: 'ally', range: 1, slot: true, type: 'heal', heal: [2, 8, 3], desc: '옆의 동료(또는 나) 2d8+3 회복. 주문 슬롯 1개.' },
  healingWord: { name: '치유의 말씀', icon: '💬', cost: 'bonus', target: 'ally', range: 12, slot: true, type: 'heal', heal: [2, 4, 3], desc: '멀리 있는 동료 2d4+3 회복 (보조 행동). 주문 슬롯 1개.' },
  turnUndead: { name: '언데드 퇴치', icon: '☀️', cost: 'action', target: 'self', type: 'turn', radius: 6, save: 'wis', dc: 13, uses: 'turnUndead', minLevel: 2, desc: '6칸 안의 언데드가 지혜 내성에 실패하면 겁에 질려 3턴 동안 움직이지 못합니다.' },

  // ---- rogue ----
  shortsword: { name: '단검', icon: '🗡️', cost: 'action', target: 'enemy', range: 1, type: 'attack', bonus: 5, dmg: [1, 6, 3], dmgType: 'piercing', weapon: true, sneak: true, desc: '근접 공격 +5, 1d6+3. 기습 공격 가능.' },
  shortbow: { name: '단궁', icon: '🏹', cost: 'action', target: 'enemy', range: 16, ranged: true, type: 'attack', bonus: 5, dmg: [1, 6, 3], dmgType: 'piercing', weapon: true, sneak: true, desc: '16칸 원거리 공격 +5, 1d6+3. 기습 공격 가능.' },
  cunningDash: { name: '재빠른 질주', icon: '💨', cost: 'bonus', target: 'self', type: 'dash', minLevel: 2, desc: '보조 행동으로 질주합니다.' },
  hide: { name: '숨기', icon: '🫥', cost: 'bonus', target: 'self', type: 'hide', minLevel: 2, desc: '은신 굴림 성공 시 다음 공격이 유리해집니다 (보조 행동).' },
};

const COMMON = ['dash', 'dodge', 'help', 'potion', 'revive'];

const CLASSES = {
  fighter: {
    name: '전사', icon: '🛡️', color: '#e0533d', hp: [12, 20, 28], ac: 16, speed: 6, init: 1,
    abilities: ['longsword', 'javelin', 'secondWind', 'actionSurge'],
    desc: '튼튼한 갑옷과 롱소드. 앞에서 동료를 지켜요.',
    levelUp: ['', '기세 폭발: 한 턴에 두 번 행동!', '치명타 범위 확장: 19~20이 나와도 치명타!'],
  },
  wizard: {
    name: '마법사', icon: '🧙', color: '#7a5cff', hp: [8, 13, 18], ac: 13, speed: 6, init: 2, slots: [2, 3, 4],
    abilities: ['firebolt', 'magicMissile', 'thunderwave', 'sleep'],
    desc: '몸은 약하지만 강력한 주문. 잠재우기로 적을 한꺼번에!',
    levelUp: ['', '주문 슬롯 +1', '주문 슬롯 +1'],
  },
  cleric: {
    name: '성직자', icon: '⛪', color: '#e8b923', hp: [10, 17, 24], ac: 18, speed: 6, init: 0, slots: [2, 3, 4],
    abilities: ['mace', 'sacredFlame', 'cureWounds', 'healingWord', 'turnUndead'],
    desc: '동료를 치유하고 언데드를 물리쳐요.',
    levelUp: ['', '언데드 퇴치 + 주문 슬롯 +1', '주문 슬롯 +1'],
  },
  rogue: {
    name: '도적', icon: '🗝️', color: '#2bb673', hp: [10, 16, 22], ac: 14, speed: 6, init: 3,
    abilities: ['shortsword', 'shortbow', 'cunningDash', 'hide'],
    desc: '동료 옆의 적을 노리면 기습 공격으로 큰 피해!',
    levelUp: ['', '교활한 행동: 보조 행동으로 질주·숨기', '기습 공격 2d6'],
  },
};

const MONSTERS = {
  rat: { name: '거대 쥐', icon: '🐀', ac: 12, hp: 7, speed: 6, init: 2, pack: true,
    attacks: [{ name: '물기', bonus: 4, dmg: [1, 4, 2], dmgType: 'piercing', range: 1 }], saves: { dex: 2, con: 0, wis: 0 } },
  kobold: { name: '코볼트', icon: '🦎', ac: 12, hp: 5, speed: 6, init: 2, pack: true,
    attacks: [{ name: '단도', bonus: 4, dmg: [1, 4, 2], dmgType: 'piercing', range: 1 }, { name: '투석구', bonus: 4, dmg: [1, 4, 2], dmgType: 'bludgeoning', range: 6, ranged: true }],
    saves: { dex: 2, con: -1, wis: -2 } },
  goblin: { name: '고블린', icon: '👺', ac: 15, hp: 7, speed: 6, init: 2,
    attacks: [{ name: '시미터', bonus: 4, dmg: [1, 6, 2], dmgType: 'slashing', range: 1 }, { name: '단궁', bonus: 4, dmg: [1, 6, 2], dmgType: 'piercing', range: 16, ranged: true }],
    saves: { dex: 2, con: 0, wis: -1 } },
  goblinArcher: { name: '고블린 궁수', icon: '🏹', ac: 13, hp: 7, speed: 6, init: 2, prefersRanged: true,
    attacks: [{ name: '시미터', bonus: 4, dmg: [1, 6, 2], dmgType: 'slashing', range: 1 }, { name: '단궁', bonus: 4, dmg: [1, 6, 2], dmgType: 'piercing', range: 16, ranged: true }],
    saves: { dex: 2, con: 0, wis: -1 } },
  goblinBoss: { name: '고블린 두목', icon: '👹', ac: 16, hp: 18, speed: 6, init: 2, multi: 2, boss: true,
    attacks: [{ name: '시미터', bonus: 4, dmg: [1, 6, 2], dmgType: 'slashing', range: 1 }], saves: { dex: 2, con: 0, wis: -1 } },
  skeleton: { name: '해골 병사', icon: '💀', ac: 13, hp: 13, speed: 6, init: 2, undead: true, vuln: ['bludgeoning'],
    attacks: [{ name: '단검', bonus: 4, dmg: [1, 6, 2], dmgType: 'piercing', range: 1 }, { name: '단궁', bonus: 4, dmg: [1, 6, 2], dmgType: 'piercing', range: 16, ranged: true }],
    saves: { dex: 2, con: 2, wis: -1 } },
  zombie: { name: '좀비', icon: '🧟', ac: 8, hp: 22, speed: 4, init: -2, undead: true, fortitude: true,
    attacks: [{ name: '후려치기', bonus: 3, dmg: [1, 6, 1], dmgType: 'bludgeoning', range: 1 }], saves: { dex: -2, con: 3, wis: -2 } },
  // Red dragon wyrmling with HP and breath trimmed for a level-3 party of three.
  dragon: { name: '붉은 용 (새끼)', icon: '🐉', ac: 17, hp: 50, speed: 6, init: 0, boss: true, final: true, immune: ['fire'],
    attacks: [{ name: '물기', bonus: 6, dmg: [1, 10, 4], dmgType: 'piercing', range: 1, extra: [1, 6, 0, 'fire'] }],
    breath: { name: '불꽃 숨결', radius: 3, save: 'dex', dc: 13, dmg: [4, 6, 0], dmgType: 'fire' },
    saves: { dex: 2, con: 5, wis: 2 } },
};

const MONSTER_LETTERS = { r: 'rat', k: 'kobold', g: 'goblin', a: 'goblinArcher', B: 'goblinBoss', s: 'skeleton', z: 'zombie', D: 'dragon' };

const ITEMS = {
  weapon: { name: '+1 마법 무기', icon: '🗡️', desc: '무기 공격 명중과 피해 +1' },
  cloak: { name: '보호의 망토', icon: '🧥', desc: '방어도(AC) +1' },
  amulet: { name: '건강의 부적', icon: '📿', desc: '최대 HP +5' },
};

// Map legend: # wall, . floor, S start, > stairs, C chest, p potion, E dragon egg (goal decor)
// Lowercase/uppercase letters are monsters (see MONSTER_LETTERS). Short rows are padded with walls.
const FLOORS = [
  {
    name: '1층 · 고블린 소굴',
    intro: '마을의 황금 용이 도둑맞은 알을 찾아 달라고 부탁했습니다. 발자국은 고블린 소굴로 이어져 있어요.',
    chests: [{ gold: 30, potions: 1 }, { gold: 50, item: 'weapon' }],
    map: [
      '############################',
      '#SS....#........#.........C#',
      '#SS....#...r....#..........#',
      '#..........................#',
      '#......#...r....#....g.g...#',
      '#..p...#........#.........##',
      '###.#############.....######',
      '###.###########.........####',
      '#.......#######...B.......>#',
      '#.......#######........g...#',
      '#.......................C..#',
      '#....g..####################',
      '########',
    ],
  },
  {
    name: '2층 · 망자의 지하묘지',
    intro: '고블린들은 알을 지하묘지의 누군가에게 넘겼다고 해요. 차가운 바람과 함께 뼈 부딪히는 소리가 들립니다.',
    chests: [{ gold: 40, potions: 1 }, { gold: 30, item: 'cloak' }, { gold: 60, potions: 2 }],
    map: [
      '##############################',
      '#SS..#..........#.....z......#',
      '#SS..#..s....s..#............#',
      '#...........................#',
      '#....#..........#.....s......#',
      '#.p..#....C.....######.#######',
      '##.###########.......#.#.....#',
      '#.....z......#...z...#.#..C..#',
      '#............................#',
      '#..s.....z...#...s...#...s...#',
      '#............#########..##.###',
      '#####.########...........#...#',
      '#.................ss.....>...#',
      '#..C.........#...........#...#',
      '##############################',
    ],
  },
  {
    name: '3층 · 붉은 용의 둥지',
    intro: '뜨거운 열기! 황금 용의 알을 훔친 범인은 어린 붉은 용이었습니다. 코볼트들이 둥지를 지키고 있어요.',
    chests: [{ gold: 80, item: 'amulet' }, { gold: 100, potions: 2 }],
    map: [
      '##############################',
      '#SS...#..........#...........#',
      '#SS...#...k..k...#...k...k...#',
      '#............................#',
      '#.....#....k.....#...........#',
      '#..p..#######.####.....C.....#',
      '###.#########.############.###',
      '###.#########.############.###',
      '#............................#',
      '#..k..k......................#',
      '#.........#.........#........#',
      '#.........#....D....#...k.k..#',
      '#.........#....E....#........#',
      '#.........#.........#........#',
      '#.....C...#.........#........#',
      '##############################',
    ],
  },
];

module.exports = { ABILITIES, COMMON, CLASSES, MONSTERS, MONSTER_LETTERS, ITEMS, FLOORS };
