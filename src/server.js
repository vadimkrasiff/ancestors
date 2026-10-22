const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Room } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
// FAST=1 ужимает таймеры — удобно для проверки на одном компьютере
const DURATIONS = process.env.FAST
  ? { intro: 3000, omen: 2000, talk: 15000, offer: 10000, reveal: 4000 }
  : undefined;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host.html')));

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

// Адрес, который увидят телефоны: localhost с них недоступен, подменяем на адрес в сети
function joinBase(origin) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  try {
    const u = new URL(origin);
    if (['localhost', '127.0.0.1', '::1'].includes(u.hostname)) u.hostname = lanAddress();
    return u.origin;
  } catch {
    return `http://${lanAddress()}:${PORT}`;
  }
}

// code -> { room, hostToken, sockets: Map<playerId, socketId>, touched }
const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcast(entry) {
  const { room } = entry;
  entry.touched = Date.now();
  io.to(`host:${room.code}`).emit('state', room.publicView());
  for (const [pid, sid] of entry.sockets) {
    io.to(sid).emit('state', room.playerView(pid));
  }
}

function createRoom() {
  const code = newCode();
  const entry = { hostToken: Math.random().toString(36).slice(2), sockets: new Map(), touched: Date.now() };
  entry.room = new Room(code, {
    durations: DURATIONS,
    onChange: () => broadcast(entry),
    onFx: (s) => io.to(`room:${code}`).emit('fx', s),
  });
  rooms.set(code, entry);
  return entry;
}

setInterval(() => {
  for (const [code, entry] of rooms) {
    if (Date.now() - entry.touched > ROOM_TTL_MS) {
      entry.room.destroy();
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

io.on('connection', (socket) => {
  let entry = null;
  let playerId = null;
  let isHost = false;

  const attachHost = (e, origin, ack) => {
    entry = e;
    isHost = true;
    socket.join(`host:${e.room.code}`);
    socket.join(`room:${e.room.code}`);
    const base = joinBase(origin);
    QRCode.toDataURL(`${base}/?room=${e.room.code}`, { margin: 1, width: 360 })
      .then((qr) => {
        ack({ code: e.room.code, hostToken: e.hostToken, qr, joinUrl: base });
        socket.emit('state', e.room.publicView());
      });
  };

  socket.on('host:create', ({ origin } = {}, ack = () => {}) => attachHost(createRoom(), origin, ack));

  socket.on('host:resume', ({ code, hostToken, origin } = {}, ack = () => {}) => {
    const e = rooms.get(String(code || '').toUpperCase());
    if (!e || e.hostToken !== hostToken) return ack({ error: 'Комната не найдена' });
    attachHost(e, origin, ack);
  });

  socket.on('host:start', (_, ack = () => {}) => {
    if (isHost) ack(entry.room.start());
  });
  socket.on('host:next', () => isHost && entry.room.next());
  socket.on('host:restart', () => {
    if (!isHost) return;
    entry.room.reset();
    entry.room.changed();
  });

  socket.on('player:join', ({ code, name, playerId: resumeId } = {}, ack = () => {}) => {
    const e = rooms.get(String(code || '').trim().toUpperCase());
    if (!e) return ack({ error: 'Нет такой избы. Проверь код' });
    let p = resumeId && e.room.players.get(resumeId);
    if (!p) {
      const res = e.room.addPlayer(name);
      if (res.error) return ack(res);
      p = res.player;
    }
    entry = e;
    playerId = p.id;
    e.sockets.set(p.id, socket.id);
    socket.join(`room:${e.room.code}`);
    e.room.setConnected(p.id, true);
    ack({ playerId: p.id, code: e.room.code });
  });

  socket.on('player:knock', (kind) => playerId && entry.room.knock(playerId, kind));
  socket.on('player:word', (word) => playerId && entry.room.word(playerId, word));
  socket.on('player:vote', ({ item, rite } = {}) => playerId && entry.room.vote(playerId, item, rite));

  socket.on('disconnect', () => {
    if (!entry || !playerId) return;
    // Если игрок уже переподключился с другого сокета, ничего не трогаем
    if (entry.sockets.get(playerId) !== socket.id) return;
    entry.sockets.delete(playerId);
    entry.room.setConnected(playerId, false);
  });
});

server.listen(PORT, () => {
  console.log(`Деды: экран ведущего — http://localhost:${PORT}/host`);
  console.log(`Телефоны подключаются к http://${lanAddress()}:${PORT}`);
});
