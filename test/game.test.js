const test = require('node:test');
const assert = require('node:assert');
const { Room, PHASE, NEED_ROOSTERS, MAX_CANDLES } = require('../src/game');

// Очень длинные таймеры: в тестах фазы двигаются только вручную
const SLOW = { intro: 1e9, omen: 1e9, talk: 1e9, offer: 1e9, reveal: 1e9 };

function makeRoom(n) {
  const room = new Room('TEST', { durations: SLOW });
  for (let i = 0; i < n; i++) room.addPlayer(`Игрок${i}`);
  return room;
}

function toOffer(room) {
  if (room.phase === PHASE.INTRO || room.phase === PHASE.REVEAL) room.next();
  assert.strictEqual(room.phase, PHASE.OMEN);
  room.next();
  room.next();
  assert.strictEqual(room.phase, PHASE.OFFER);
}

test('роли распределяются по числу игроков', () => {
  for (const [n, dead, zalozhny] of [[2, 1, 0], [5, 1, 0], [8, 2, 1], [20, 5, 1]]) {
    const room = makeRoom(n);
    room.start();
    assert.strictEqual(room.dead().length, dead, `n=${n}`);
    assert.strictEqual(room.dead().filter((p) => p.zalozhny).length, zalozhny, `n=${n}`);
    room.destroy();
  }
});

test('нужно хотя бы двое, не больше двадцати и без повторов имён', () => {
  const room = makeRoom(1);
  assert.ok(room.start().error);
  assert.ok(room.addPlayer('игрок0').error);
  for (let i = 1; i < 20; i++) room.addPlayer(`P${i}`);
  assert.ok(room.addPlayer('Лишний').error);
  room.destroy();
});

test('угадали всё — петух, три петуха — рассвет', () => {
  const room = makeRoom(4);
  room.start();
  for (let r = 0; r < NEED_ROOSTERS; r++) {
    toOffer(room);
    for (const p of room.living()) room.vote(p.id, room.wish.item, room.wish.rite);
    assert.strictEqual(room.phase, PHASE.REVEAL, 'все проголосовали — сразу вскрытие');
    assert.strictEqual(room.reveal.result, 'blessed');
  }
  assert.strictEqual(room.outcome, 'dawn');
  room.next();
  assert.strictEqual(room.phase, PHASE.END);
  room.destroy();
});

test('промах уводит худшего живого к мёртвым и гасит свечу', () => {
  const room = makeRoom(4);
  room.start();
  toOffer(room);
  const wrongItem = room.table.items.find((i) => i.id !== room.wish.item).id;
  const wrongRite = room.table.rites.find((r) => r.id !== room.wish.rite).id;
  const [a, b, c] = room.living();
  room.vote(a.id, wrongItem, wrongRite);
  room.vote(b.id, wrongItem, wrongRite);
  room.vote(c.id, room.wish.item, wrongRite);
  assert.strictEqual(room.reveal.result, 'wrath');
  assert.strictEqual(room.candles, MAX_CANDLES - 1);
  assert.notStrictEqual(room.reveal.takenId, c.id, 'угадавший наполовину в безопасности');
  assert.strictEqual(room.players.get(room.reveal.takenId).role, 'dead');
  room.destroy();
});

test('предок стучит только в свою фазу и в пределах запаса', () => {
  const room = makeRoom(4);
  room.start();
  const [dead] = room.dead();
  const [living] = room.living();
  room.next(); // omen
  room.knock(dead.id, 'yes');
  assert.strictEqual(room.signals.length, 0);
  room.next(); // talk
  room.knock(living.id, 'yes');
  assert.strictEqual(room.signals.length, 0, 'живые не стучат');
  const budget = dead.knocksLeft;
  for (let i = 0; i < budget + 3; i++) room.knock(dead.id, 'no');
  assert.strictEqual(room.signals.length, budget);
  room.word(dead.id, 'несуществующее');
  room.word(dead.id, dead.hand[0]);
  assert.strictEqual(room.signals.length, budget + 1);
  room.destroy();
});

test('живые не видят желания, предки видят', () => {
  const room = makeRoom(4);
  room.start();
  room.next();
  const [dead] = room.dead();
  const [living] = room.living();
  assert.ok(room.playerView(dead.id).me.wish);
  assert.strictEqual(room.playerView(living.id).me.wish, null);
  assert.ok(!JSON.stringify(room.publicView()).includes('"wish"'));
  room.destroy();
});

test('свечи кончились — ночь победила', () => {
  const room = makeRoom(8);
  room.start();
  for (let r = 0; r < MAX_CANDLES; r++) {
    toOffer(room);
    const item = room.table.items.find((i) => i.id !== room.wish.item).id;
    for (const p of room.living()) room.vote(p.id, item, room.wish.rite);
    assert.strictEqual(room.reveal.result, 'grumble');
  }
  assert.strictEqual(room.outcome, 'night');
  room.destroy();
});
