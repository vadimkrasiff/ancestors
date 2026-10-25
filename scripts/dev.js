// Локальный запуск без интернета: раздаёт public/ и поднимает свой брокер PeerJS.
// На GitHub Pages всё это не нужно — там используется облачный брокер.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PeerServer } = require('peer');

const PORT = Number(process.env.PORT) || 8080;
const PEER_PORT = Number(process.env.PEER_PORT) || 9000;
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url.endsWith('/') ? `${url}index.html` : url);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
      res.end(data);
    });
  })
  .listen(PORT);

PeerServer({ port: PEER_PORT, path: '/', host: '0.0.0.0' });

const ip = lanAddress();
console.log(`Деды: экран ведущего — http://${ip}:${PORT}/host.html?peer=${ip}:${PEER_PORT}`);
console.log('Телефоны в той же сети подключаются по QR-коду с экрана.');
