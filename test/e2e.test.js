// Полная ночь через настоящий сервер и сокеты: ведущий + 6 телефонов.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 3917;
const URL = `http://localhost:${PORT}`;

const once = (socket, event, pred = () => true) =>
  new Promise((resolve) => {
    const h = (data) => {
      if (pred(data)) {
        socket.off(event, h);
        resolve(data);
      }
    };
    socket.on(event, h);
  });

const emit = (socket, event, data) => new Promise((resolve) => socket.emit(event, data, resolve));

test('ночь от входа до рассвета', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT, FAST: '1' },
  });
  t.after(() => server.kill());
  await new Promise((r) => server.stdout.once('data', r));

  const host = io(URL);
  t.after(() => host.close());
  const room = await emit(host, 'host:create', { origin: URL });
  assert.match(room.code, /^[A-Z]{4}$/);
  assert.match(room.qr, /^data:image\/png/);

  const phones = [];
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const s = io(URL);
    t.after(() => s.close());
    const res = await emit(s, 'player:join', { code: room.code, name: `Гость${i}` });
    assert.ok(res.playerId, res.error);
    phones.push(s);
    ids.push(res.playerId);
  }
  const dup = io(URL);
  t.after(() => dup.close());
  assert.ok((await emit(dup, 'player:join', { code: room.code, name: 'гость0' })).error);

  const starting = once(host, 'state', (s) => s.phase === 'intro');
  assert.deepStrictEqual(await emit(host, 'host:start'), {});
  const intro = await starting;
  assert.strictEqual(intro.players.filter((p) => p.role === 'dead').length, 1);

  // Предок подсказывает, живые голосуют ровно за желание
  for (let r = 1; r <= 3; r++) {
    const states = await Promise.all(phones.map((s) => once(s, 'state', (st) => st.phase === 'talk' && st.round === r)));
    const deadIdx = states.findIndex((st) => st.me.role === 'dead');
    const wish = states[deadIdx].me.wish;
    assert.ok(wish);
    const fx = once(host, 'fx');
    phones[deadIdx].emit('player:knock', 'yes');
    assert.strictEqual((await fx).value, 'yes');

    await once(host, 'state', (s) => s.phase === 'offer');
    const reveal = once(host, 'state', (s) => s.phase === 'reveal' && s.round === r);
    states.forEach((st, i) => st.me.role === 'living' && phones[i].emit('player:vote', wish));
    assert.strictEqual((await reveal).reveal.result, 'blessed');
  }

  const end = await once(host, 'state', (s) => s.phase === 'end');
  assert.strictEqual(end.outcome, 'dawn');

  // Телефон переподключается под тем же игроком
  phones[0].close();
  const again = io(URL);
  t.after(() => again.close());
  const back = await emit(again, 'player:join', { code: room.code, playerId: ids[0] });
  assert.strictEqual(back.playerId, ids[0]);
});
