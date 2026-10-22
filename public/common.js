// Общее для экрана ведущего и телефона.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const $ = (sel) => document.querySelector(sel);

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// Таймер считается от момента получения состояния, чтобы не зависеть от часов устройства
let deadline = null;
function trackDeadline(state) {
  deadline = state.endsIn == null ? null : Date.now() + state.endsIn;
}
function secondsLeft() {
  return deadline == null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
function fmtTime(s) {
  return s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function findOpt(table, kind, id) {
  return table && table[kind].find((o) => o.id === id);
}

function card(opt, cls = '') {
  return opt
    ? `<div class="card ${cls}"><span class="em">${opt.emoji}</span><span class="nm">${esc(opt.name)}</span></div>`
    : '';
}

const RESULT_TEXT = {
  blessed: { title: 'Дед доволен', text: 'Где-то далеко кричит петух 🐓' },
  grumble: { title: 'Дед ворчит', text: 'Наполовину угодили. Гаснет свеча 🕯️' },
  wrath: { title: 'Дед гневается', text: 'Гаснет свеча, и предок уводит одного из живых' },
};

const PHASE_TEXT = {
  omen: { title: 'Предки пришли', hint: 'Тише… Мёртвые узнают, чего им хочется' },
  talk: { title: 'Спрашивайте', hint: 'Задавайте вопросы вслух — предки ответят стуком' },
  offer: { title: 'Накрывайте стол', hint: 'Живые тайно выбирают угощение и обряд' },
};
