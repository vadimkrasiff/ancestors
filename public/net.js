// Связь через WebRTC (PeerJS): вкладка ведущего — сервер, телефоны подключаются к ней напрямую.
// По умолчанию используется бесплатный облачный брокер PeerJS; ?peer=host:port — свой (для разработки).
const PEER_PREFIX = 'dedy-izba-';

function customPeer() {
  return new URLSearchParams(location.search).get('peer');
}

function peerOptions() {
  const custom = customPeer();
  if (!custom) return { debug: 1 };
  const u = new URL(custom.includes('://') ? custom : `http://${custom}`);
  const secure = u.protocol === 'https:';
  return { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: '/', secure, debug: 1 };
}

// Телефоны должны ходить через тот же брокер, что и ведущий
function peerParam() {
  const custom = customPeer();
  return custom ? `&peer=${encodeURIComponent(custom)}` : '';
}
