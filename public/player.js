const socket = io();
const app = $('#app');
let state = null;
let session = store.get('dedy-player'); // { code, playerId, name }
let joinError = '';

// Локальные пометки живого: что вычеркнул и что выбрал на этом часу
let marks = { round: 0, crossed: new Set(), item: null, rite: null };

const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom && session && session.code !== urlRoom.toUpperCase()) session = null;

function join(code, name, playerId) {
  socket.emit('player:join', { code, name, playerId }, (res) => {
    if (res.error) {
      // старая сессия протухла — показываем форму заново
      if (playerId) {
        store.del('dedy-player');
        session = null;
        return render();
      }
      joinError = res.error;
      return render();
    }
    session = { code: res.code, playerId: res.playerId, name };
    store.set('dedy-player', session);
    joinError = '';
    render();
  });
}

socket.on('connect', () => {
  if (session) join(session.code, session.name, session.playerId);
  else render();
});

socket.on('state', (s) => {
  state = s;
  trackDeadline(s);
  if (marks.round !== s.round) marks = { round: s.round, crossed: new Set(), item: null, rite: null };
  render();
});

// Живые чувствуют стук рукой
socket.on('fx', (s) => {
  if (s.type !== 'knock' || !navigator.vibrate) return;
  navigator.vibrate(s.value === 'yes' ? 120 : [120, 140, 120]);
});

setInterval(() => {
  const el = $('#timer');
  if (el) el.textContent = fmtTime(secondsLeft());
}, 250);

function topBar() {
  return `<div class="top">
    <span>${esc(state.me.name)}</span><span class="grow"></span>
    <span>${'🐓'.repeat(state.roosters)} ${'🕯️'.repeat(state.candles)}</span>
    <span id="timer">${fmtTime(secondsLeft())}</span>
  </div>`;
}

function render() {
  if (!session || !state || !state.me) return renderJoin();
  const { me, phase } = state;

  if (phase === 'lobby') {
    app.innerHTML = `
      <h1>Деды</h1>
      <div class="role-card"><div class="em">🕯️</div>
        <p>Ты в избе, <b>${esc(me.name)}</b>.<br>Ждём, пока соберутся все и зажгут свечи.</p>
        <p class="muted">Уже за столом: ${state.players.length}</p>
      </div>`;
    return;
  }

  if (phase === 'end') {
    const dawn = state.outcome === 'dawn';
    const won = me.zalozhny ? !dawn : dawn;
    app.innerHTML = `
      <h1>${dawn ? 'Рассвет' : 'Вечная ночь'}</h1>
      <div class="role-card ${won ? '' : 'zalozhny'}"><div class="em">${won ? '🌅' : '🌑'}</div>
        <h2>${won ? 'Победа' : 'Поражение'}</h2>
        <p class="muted">Смотри на общий экран</p>
      </div>`;
    return;
  }

  if (phase === 'intro') return renderRole();
  if (phase === 'reveal') return renderReveal();
  return me.role === 'dead' ? renderDead() : renderLiving();
}

function renderJoin() {
  const code = (session && session.code) || urlRoom || '';
  app.innerHTML = `
    <h1>Деды</h1>
    <p class="center muted">Поминальная ночь</p>
    <form id="joinForm">
      <input name="code" placeholder="Код избы" maxlength="4" value="${esc(code)}"
        autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.3em;text-align:center">
      <input name="name" placeholder="Твоё имя" maxlength="16" autocomplete="nickname">
      <div class="err">${esc(joinError)}</div>
      <button class="primary big" type="submit">Войти в избу</button>
    </form>`;
  $('#joinForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    join(String(f.get('code')).trim(), String(f.get('name')).trim());
  };
  if (code) $('[name=name]').focus();
}

function roleCardHtml() {
  const { me } = state;
  if (me.zalozhny) {
    return `<div class="role-card zalozhny"><div class="em">💀</div>
      <h2>Ты — заложный покойник</h2>
      <p>Ты умер нехорошей смертью и не нашёл покоя. Ты знаешь, чего хотят предки, —
      но хочешь, чтобы Род погас. Стучи как честный предок, но <b>путай живых</b>.
      Не попадись: остальные предки знают правду.</p></div>`;
  }
  if (me.role === 'dead') {
    return `<div class="role-card dead"><div class="em">👤</div>
      <h2>Ты — предок</h2>
      <p>Ты умер. <b>Говорить нельзя</b> — вообще. Ты будешь видеть, чего хочется предкам,
      и сможешь только стучать (тук — да, тук-тук — нет) и шептать пару слов.
      Помоги живым угодить — иначе Род угаснет.</p></div>`;
  }
  return `<div class="role-card"><div class="em">🕯️</div>
    <h2>Ты — живой</h2>
    <p>Предки пришли к столу. Спрашивай их вслух — они ответят стуком.
    Потом тайно выбери, какое угощение поставить и какой обряд исполнить.
    Ошибёшься — тебя могут увести.</p></div>`;
}

function renderRole() {
  app.innerHTML = `${topBar()}${roleCardHtml()}`;
}

function renderDead() {
  const { me, phase, table } = state;
  const wish = me.wish;
  const wishHtml = wish
    ? `<div class="section-label">${me.zalozhny ? 'Настоящее желание (а ты путай):' : 'Предки хотят:'}</div>
       <div class="wish">${card(findOpt(table, 'items', wish.item))}${card(findOpt(table, 'rites', wish.rite))}</div>`
    : '';

  if (phase === 'omen') {
    app.innerHTML = `${topBar()}<h2>Ты чуешь желание…</h2>${wishHtml}
      <p class="center muted">Запомни. Скоро живые начнут спрашивать.</p>`;
    return;
  }

  if (phase === 'talk') {
    app.innerHTML = `${topBar()}
      <p class="center muted">🤐 Молчи. Отвечай стуком.</p>
      ${wishHtml}
      <div class="section-label">Стук (осталось ${me.knocksLeft})</div>
      <div class="knocks">
        <button class="yes" data-knock="yes" ${me.knocksLeft ? '' : 'disabled'}>Тук<small>да</small></button>
        <button class="no" data-knock="no" ${me.knocksLeft ? '' : 'disabled'}>Тук-тук<small>нет</small></button>
      </div>
      <div class="section-label">Слово из-за гроба (осталось ${me.wordsLeft})</div>
      <div class="words">
        ${me.hand.map((w) => `<button data-word="${esc(w)}" ${me.wordsLeft ? '' : 'disabled'}>${esc(w)}</button>`).join('')}
      </div>`;
    app.querySelectorAll('[data-knock]').forEach((b) => {
      b.onclick = () => socket.emit('player:knock', b.dataset.knock);
    });
    app.querySelectorAll('[data-word]').forEach((b) => {
      b.onclick = () => socket.emit('player:word', b.dataset.word);
    });
    return;
  }

  app.innerHTML = `${topBar()}${wishHtml}
    <p class="center muted">Живые накрывают стол. Смотри молча.</p>`;
}

function optionButtons(kind) {
  const isOffer = state.phase === 'offer';
  const chosen = state.me.vote ? state.me.vote[kind === 'items' ? 'item' : 'rite'] : marks[kind === 'items' ? 'item' : 'rite'];
  return state.table[kind].map((o) => {
    const cls = [
      isOffer && chosen === o.id ? 'on' : '',
      marks.crossed.has(o.id) ? 'crossed' : '',
    ].join(' ');
    return `<button class="${cls}" data-kind="${kind}" data-id="${o.id}">
      <span class="em">${o.emoji}</span>${esc(o.name)}</button>`;
  }).join('');
}

function renderLiving() {
  const { me, phase } = state;
  const isOffer = phase === 'offer';
  const hint = {
    omen: 'Предки прислушиваются к своим желаниям…',
    talk: 'Спрашивай вслух. Нажимай на варианты, чтобы вычеркнуть лишнее.',
    offer: me.vote ? 'Подношение отдано. Ждём остальных…' : 'Выбери одно угощение и один обряд.',
  }[phase];

  app.innerHTML = `${topBar()}
    <h2>${PHASE_TEXT[phase].title}</h2>
    <p class="center muted">${hint}</p>
    <div class="section-label">Угощение</div>
    <div class="pick">${optionButtons('items')}</div>
    <div class="section-label">Обряд</div>
    <div class="pick">${optionButtons('rites')}</div>
    ${isOffer && !me.vote
      ? `<button class="primary big" id="voteBtn" ${marks.item && marks.rite ? '' : 'disabled'}>Поставить на стол</button>`
      : ''}`;

  app.querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => {
      const { kind, id } = b.dataset;
      if (isOffer) {
        if (me.vote) return;
        marks[kind === 'items' ? 'item' : 'rite'] = id;
      } else if (phase === 'talk') {
        marks.crossed.has(id) ? marks.crossed.delete(id) : marks.crossed.add(id);
      }
      render();
    };
  });
  const vb = $('#voteBtn');
  if (vb) vb.onclick = () => socket.emit('player:vote', { item: marks.item, rite: marks.rite });
}

function renderReveal() {
  const r = state.reveal;
  const rt = RESULT_TEXT[r.result];
  const takenMe = r.takenId === state.me.id;
  app.innerHTML = `${topBar()}
    <div class="role-card ${takenMe ? 'dead' : ''}">
      <h2>${rt.title}</h2>
      <p>${rt.text}</p>
      <div class="wish">${card(findOpt(state.table, 'items', r.wish.item))}${card(findOpt(state.table, 'rites', r.wish.rite))}</div>
      ${takenMe ? `<p><b>Тебя увели.</b> Теперь ты предок: молчи и стучи.</p>` : ''}
      ${r.takenName && !takenMe ? `<p>👤 ${esc(r.takenName)} теперь среди мёртвых</p>` : ''}
    </div>`;
}
