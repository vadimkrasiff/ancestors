// Страница ведущего и есть сервер: здесь живёт комната, телефоны подключаются по WebRTC.
let state = null;
let room = null; // { code, qr, joinUrl }
let game = null;
let lastPhaseKey = null;
let netError = '';
const conns = new Map(); // playerId -> соединение

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

function openRoom(code) {
  const peer = new Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => {
    netError = '';
    if (!game) createGame(code);
  });
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => onMessage(conn, msg));
    conn.on('close', () => onClose(conn));
  });
  peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
  peer.on('error', (err) => {
    // Код занят (например, старая вкладка ещё не отпустила его) — берём другой
    if (err.type === 'unavailable-id' && !game) {
      peer.destroy();
      return openRoom(newCode());
    }
    if (err.type === 'peer-unavailable') return;
    netError = `Связь с духами прервалась (${err.type}). Проверь интернет и обнови страницу.`;
    render();
  });
}

function createGame(code) {
  const joinUrl = new URL(`./?room=${code}${peerParam()}`, location.href).href;
  const qr = qrcode(0, 'M');
  qr.addData(joinUrl);
  qr.make();
  room = { code, joinUrl, qr: qr.createDataURL(8, 2) };
  game = new Dedy.Room(code, { onChange: broadcast, onFx: fx });
  store.set('dedy-host-code', code);
  broadcast();
}

function send(conn, msg) {
  if (conn && conn.open) conn.send(msg);
}

function broadcast() {
  state = game.publicView();
  trackDeadline(state);
  for (const [pid, conn] of conns) send(conn, { t: 'state', state: game.playerView(pid) });
  render();
}

function onMessage(conn, msg) {
  if (!game || !msg || typeof msg !== 'object') return;
  if (msg.t === 'join') {
    let p = msg.playerId && game.players.get(msg.playerId);
    if (!p) {
      const res = game.addPlayer(msg.name);
      if (res.error) return send(conn, { t: 'error', error: res.error });
      p = res.player;
    }
    const old = conns.get(p.id);
    if (old && old !== conn) old.close();
    conn.playerId = p.id;
    conns.set(p.id, conn);
    send(conn, { t: 'joined', playerId: p.id, code: game.code });
    game.setConnected(p.id, true);
    return;
  }
  const pid = conn.playerId;
  if (!pid) return;
  if (msg.t === 'knock') game.knock(pid, msg.kind);
  else if (msg.t === 'word') game.word(pid, msg.word);
  else if (msg.t === 'vote') game.vote(pid, msg.item, msg.rite);
}

function onClose(conn) {
  const pid = conn.playerId;
  if (!pid || conns.get(pid) !== conn) return;
  conns.delete(pid);
  game.setConnected(pid, false);
}

function fx(s) {
  for (const conn of conns.values()) send(conn, { t: 'fx', fx: s });
  if (s.type === 'knock') Sound.knock(s.value);
  else Sound.whisper(s.value);
  const el = document.querySelector(`[data-ancestor="${s.pid}"]`);
  if (el) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }
  if (s.type === 'knock') {
    const main = $('main');
    main.classList.remove('shake');
    void main.offsetWidth;
    main.classList.add('shake');
  }
}

const hostNext = () => game && game.next();

// Состояние ночи живёт только в этой вкладке — предупреждаем перед закрытием
window.addEventListener('beforeunload', (e) => {
  if (game && game.phase !== 'lobby') e.preventDefault();
});

openRoom(store.get('dedy-host-code') || newCode());

$('#soundBtn').onclick = () => {
  Sound.enable();
  $('#soundBtn').textContent = '🔊 Звук';
};
$('#nextBtn').onclick = hostNext;

setInterval(() => {
  const s = secondsLeft();
  $('#timer').textContent = fmtTime(s);
  $('#timer').classList.toggle('low', s != null && s <= 10);
}, 250);

function render() {
  if (!state || !room) {
    $('#overlayBox').innerHTML = `<div class="big-title">Деды</div>
      <p class="lore">${esc(netError || 'Зажигаем лампаду… подключаемся к миру духов')}</p>`;
    return;
  }
  const phaseKey = `${state.phase}:${state.round}`;
  if (phaseKey !== lastPhaseKey && state.phase === 'reveal' && state.reveal) Sound.verdict(state.reveal.result);
  lastPhaseKey = phaseKey;

  const living = state.players.filter((p) => p.role === 'living');
  const dead = state.players.filter((p) => p.role === 'dead');

  $('#round').textContent = state.round ? `Час ${state.round}` : '';
  $('#roosters').innerHTML = Array.from({ length: state.needRoosters }, (_, i) =>
    `<span class="rooster ${i < state.roosters ? '' : 'off'}">🐓</span>`).join('');
  $('#candles').innerHTML = Array.from({ length: state.maxCandles }, (_, i) =>
    `<span class="flame ${i < state.candles ? '' : 'out'}">🕯️</span>`).join('');

  $('#living').innerHTML = living.map((p) => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="flame">🕯️</span>${esc(p.name)}
      ${state.phase === 'offer' && p.voted ? '<span class="tick">✓</span>' : ''}
    </li>`).join('');

  $('#ancestors').innerHTML = dead.map((p) => {
    const sigs = state.signals.filter((s) => s.pid === p.id).map((s) =>
      s.type === 'knock'
        ? `<span class="k ${s.value}">${s.value === 'yes' ? 'тук' : 'тук-тук'}</span>`
        : `<span class="ghost-word">«${esc(s.value)}»</span>`).join('');
    return `
      <div class="ancestor" data-ancestor="${p.id}">
        <div class="who">👤 ${esc(p.name)}${p.connected ? '' : ' <span class="muted">(ушёл)</span>'}</div>
        <div class="sig">${sigs}</div>
      </div>`;
  }).join('') || '<p class="muted">Пока никого…</p>';

  const pt = PHASE_TEXT[state.phase];
  $('#phaseTitle').textContent = pt ? pt.title : '';
  $('#phaseHint').textContent = pt ? pt.hint : '';
  const t = state.table;
  $('#items').innerHTML = t ? t.items.map((o) => card(o)).join('') : '';
  $('#rites').innerHTML = t ? t.rites.map((o) => card(o)).join('') : '';

  $('#nextBtn').classList.toggle('hidden', ['lobby', 'end'].includes(state.phase));
  renderOverlay(living, dead);
}

// Оверлей закрывает нижнюю панель, поэтому у него своя кнопка «Дальше»
const nextButton = () => `<div style="margin-top:2rem"><button id="overlayNext">Дальше ⏭</button></div>`;
const bindNext = () => ($('#overlayNext').onclick = hostNext);

function renderOverlay(living, dead) {
  const box = $('#overlayBox');
  const show = (html) => {
    $('#overlay').classList.remove('hidden');
    box.innerHTML = html;
  };

  if (state.phase === 'lobby') {
    const names = state.players.map((p) => `<span class="chip">${esc(p.name)}</span>`).join('');
    show(`
      <div class="lobby">
        <img class="qr" src="${room.qr}" alt="QR-код для входа">
        <div>
          <h1>Деды</h1>
          <div class="sub">Поминальная ночь. Предки придут к столу.</div>
          <div class="muted">Сканируй QR или открой</div>
          <div class="url">${esc(room.joinUrl)}</div>
          <div class="code">${esc(room.code)}</div>
          <div class="joined">${names || '<span class="muted">Пока в избе пусто…</span>'}</div>
          <div class="actions">
            <button class="primary" id="startBtn" ${state.players.length < 2 ? 'disabled' : ''}>
              Зажечь свечи (${state.players.length}/20)
            </button>
            <button id="lobbySound">${Sound.on ? '🔊 Звук включён' : '🔇 Включить звук'}</button>
          </div>
        </div>
      </div>`);
    $('#startBtn').onclick = () => {
      Sound.enable();
      const res = game.start();
      if (res.error) alert(res.error);
    };
    $('#lobbySound').onclick = () => {
      Sound.enable();
      $('#lobbySound').textContent = '🔊 Звук включён';
      $('#soundBtn').textContent = '🔊 Звук';
    };
    return;
  }

  if (state.phase === 'intro') {
    const hasZalozhny = dead.length >= 2;
    show(`
      <div class="big-title">Наступает ночь Дедов</div>
      <p class="lore">
        Раз в году умершие возвращаются к родному столу. Угодишь — благословят род.
        Не угодишь — уведут с собой. Говорить они не могут. Только стучать.
      </p>
      <div class="rules">
        <div class="panel"><b>Живые</b> (${living.length})<br>Спрашивайте предков вслух.
          На каждом часу тайно выберите одно угощение и один обряд.</div>
        <div class="panel"><b>Предки</b> (${dead.length})<br>Знают желание.
          Отвечают только стуком — тук «да», тук-тук «нет» — и парой слов из-за гроба.</div>
        <div class="panel"><b>Рассвет</b><br>Три петуха — Род спасён.
          Погаснут все свечи или уйдут все живые — ночь победила.
          ${hasZalozhny ? '<br><br>⚠️ Среди предков прячется <b>заложный покойник</b>. Он лжёт.' : ''}</div>
      </div>
      <p class="muted">Посмотрите на свои телефоны…</p>
      ${nextButton()}`);
    bindNext();
    return;
  }

  if (state.phase === 'reveal' && state.reveal) {
    const r = state.reveal;
    const t = state.table;
    const rt = RESULT_TEXT[r.result];
    const itemOk = r.chosen.item === r.wish.item;
    const riteOk = r.chosen.rite === r.wish.rite;
    show(`
      <div class="verdict ${r.result}">${rt.title}</div>
      <p class="lore">${rt.text}</p>
      <div class="reveal-row">
        <div>
          <div class="muted">Вы поставили</div>
          <div style="display:flex;gap:1rem;margin-top:.5rem">
            ${card(findOpt(t, 'items', r.chosen.item), itemOk ? 'good' : 'bad')}
            ${card(findOpt(t, 'rites', r.chosen.rite), riteOk ? 'good' : 'bad')}
          </div>
        </div>
        <div>
          <div class="muted">Предки хотели</div>
          <div style="display:flex;gap:1rem;margin-top:.5rem">
            ${card(findOpt(t, 'items', r.wish.item))}
            ${card(findOpt(t, 'rites', r.wish.rite))}
          </div>
        </div>
      </div>
      ${r.takenName ? `<div class="taken">👤 ${esc(r.takenName)} теперь среди мёртвых</div>` : ''}
      ${nextButton()}`);
    bindNext();
    return;
  }

  if (state.phase === 'end') {
    const dawn = state.outcome === 'dawn';
    const z = state.players.find((p) => p.zalozhny);
    show(`
      <div class="big-title">${dawn ? '🌅 Рассвет' : '🌑 Вечная ночь'}</div>
      <p class="lore">${dawn
        ? 'Пропели петухи. Предки ушли довольными, Род будет жить.'
        : 'Свечи погасли. Теперь за этим столом сидят только мёртвые.'}</p>
      ${z ? `<p class="lore" style="margin-top:1rem">Заложным покойником был <b>${esc(z.name)}</b> —
        ${dawn ? 'и его ложь не помогла.' : 'и он добился своего.'}</p>` : ''}
      <p class="lore muted" style="margin-top:1rem">Выжили: ${living.map((p) => esc(p.name)).join(', ') || 'никто'}</p>
      <div style="margin-top:2rem"><button class="primary" id="againBtn">Ещё одна ночь</button></div>`);
    $('#againBtn').onclick = () => {
      game.reset();
      game.changed();
    };
    return;
  }

  $('#overlay').classList.add('hidden');
}
