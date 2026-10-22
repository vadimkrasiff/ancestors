const { ITEMS, RITES, WORDS } = require('./content');

const PHASE = {
  LOBBY: 'lobby',
  INTRO: 'intro',
  OMEN: 'omen', // предки узнают желание
  TALK: 'talk', // живые спрашивают, предки стучат
  OFFER: 'offer', // живые голосуют за подношение
  REVEAL: 'reveal',
  END: 'end',
};

const DEFAULT_DURATIONS = {
  intro: 15000,
  omen: 8000,
  talk: 120000,
  offer: 30000,
  reveal: 12000,
};

const MAX_PLAYERS = 20;
const MAX_CANDLES = 4;
const NEED_ROOSTERS = 3;
const WORDS_PER_ROUND = 2;
const HAND_SIZE = 6;

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Победитель голосования; ничья решается жребием, пустое голосование — тоже.
function tally(votes, options, rng) {
  const counts = new Map();
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  if (counts.size === 0) return pick(options, rng).id;
  const max = Math.max(...counts.values());
  return pick([...counts].filter(([, c]) => c === max).map(([id]) => id), rng);
}

class Room {
  constructor(code, { onChange = () => {}, onFx = () => {}, durations = DEFAULT_DURATIONS, rng = Math.random } = {}) {
    this.code = code;
    this.onChange = onChange;
    this.onFx = onFx;
    this.durations = { ...DEFAULT_DURATIONS, ...durations };
    this.rng = rng;
    this.players = new Map();
    this.timer = null;
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.candles = MAX_CANDLES;
    this.roosters = 0;
    this.table = null;
    this.wish = null;
    this.signals = [];
    this.reveal = null;
    this.outcome = null;
    this.endsAt = null;
    for (const p of this.players.values()) {
      Object.assign(p, { role: 'living', zalozhny: false, vote: null, hand: [], knocksLeft: 0, wordsLeft: 0 });
    }
  }

  // --- игроки ---

  addPlayer(name) {
    name = String(name || '').trim().slice(0, 16);
    if (!name) return { error: 'Назови себя' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'Изба полна: не больше 20 человек' };
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'Это имя уже занято' };
    }
    const inGame = this.phase !== PHASE.LOBBY;
    const p = {
      id: newId(),
      name,
      connected: true,
      // опоздавшие приходят уже предками
      role: inGame ? 'dead' : 'living',
      zalozhny: false,
      vote: null,
      hand: [],
      knocksLeft: 0,
      wordsLeft: 0,
    };
    this.players.set(p.id, p);
    this.changed();
    return { player: p };
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    if (!connected && this.phase === PHASE.LOBBY) this.players.delete(id);
    else p.connected = connected;
    this.changed();
  }

  living() {
    return [...this.players.values()].filter((p) => p.role === 'living');
  }

  dead() {
    return [...this.players.values()].filter((p) => p.role === 'dead');
  }

  // --- ход игры ---

  start() {
    if (this.phase !== PHASE.LOBBY) return { error: 'Игра уже идёт' };
    const all = shuffle([...this.players.values()], this.rng);
    if (all.length < 2) return { error: 'Нужно хотя бы двое' };
    const deadCount = Math.max(1, Math.floor(all.length / 4));
    all.forEach((p, i) => {
      p.role = i < deadCount ? 'dead' : 'living';
    });
    // Заложный появляется, только когда честных предков хотя бы двое
    if (deadCount >= 2) all[Math.floor(this.rng() * deadCount)].zalozhny = true;
    this.setPhase(PHASE.INTRO);
    return {};
  }

  setPhase(phase) {
    clearTimeout(this.timer);
    this.phase = phase;
    const dur = this.durations[phase];
    if (dur) {
      this.endsAt = Date.now() + dur;
      this.timer = setTimeout(() => this.next(), dur);
    } else {
      this.endsAt = null;
    }
    this.changed();
  }

  next() {
    switch (this.phase) {
      case PHASE.INTRO:
        return this.beginRound();
      case PHASE.OMEN:
        return this.setPhase(PHASE.TALK);
      case PHASE.TALK:
        return this.setPhase(PHASE.OFFER);
      case PHASE.OFFER:
        return this.resolve();
      case PHASE.REVEAL:
        return this.outcome ? this.setPhase(PHASE.END) : this.beginRound();
    }
  }

  beginRound() {
    this.round += 1;
    const items = shuffle(ITEMS, this.rng).slice(0, Math.min(ITEMS.length, 5 + this.round));
    const rites = shuffle(RITES, this.rng).slice(0, Math.min(RITES.length, 3 + this.round));
    this.table = { items, rites };
    this.wish = { item: pick(items, this.rng).id, rite: pick(rites, this.rng).id };
    this.signals = [];
    this.reveal = null;

    // Чем больше предков, тем меньше стуков у каждого
    const dead = this.dead();
    const knocks = Math.max(3, Math.ceil(10 / Math.max(1, dead.length)));
    for (const p of dead) {
      p.knocksLeft = knocks;
      p.wordsLeft = WORDS_PER_ROUND;
      p.hand = shuffle(WORDS, this.rng).slice(0, HAND_SIZE);
    }
    for (const p of this.living()) p.vote = null;
    this.setPhase(PHASE.OMEN);
  }

  knock(id, kind) {
    const p = this.players.get(id);
    if (!p || p.role !== 'dead' || this.phase !== PHASE.TALK) return;
    if (p.knocksLeft <= 0 || (kind !== 'yes' && kind !== 'no')) return;
    p.knocksLeft -= 1;
    this.signal(p, 'knock', kind);
  }

  word(id, word) {
    const p = this.players.get(id);
    if (!p || p.role !== 'dead' || this.phase !== PHASE.TALK) return;
    if (p.wordsLeft <= 0 || !p.hand.includes(word)) return;
    p.wordsLeft -= 1;
    p.hand = p.hand.filter((w) => w !== word);
    this.signal(p, 'word', word);
  }

  signal(p, type, value) {
    const s = { pid: p.id, name: p.name, type, value, t: Date.now() };
    this.signals.push(s);
    this.onFx(s);
    this.changed();
  }

  vote(id, item, rite) {
    const p = this.players.get(id);
    if (!p || p.role !== 'living' || this.phase !== PHASE.OFFER || !this.table) return;
    if (!this.table.items.some((i) => i.id === item)) return;
    if (!this.table.rites.some((r) => r.id === rite)) return;
    p.vote = { item, rite };
    this.changed();
    const living = this.living();
    if (living.every((l) => l.vote || !l.connected)) this.resolve();
  }

  resolve() {
    if (this.phase !== PHASE.OFFER) return;
    const living = this.living();
    const voted = living.filter((p) => p.vote);
    const chosen = {
      item: tally(voted.map((p) => p.vote.item), this.table.items, this.rng),
      rite: tally(voted.map((p) => p.vote.rite), this.table.rites, this.rng),
    };
    const itemOk = chosen.item === this.wish.item;
    const riteOk = chosen.rite === this.wish.rite;

    let result;
    let taken = null;
    if (itemOk && riteOk) {
      result = 'blessed';
      this.roosters += 1;
    } else if (itemOk || riteOk) {
      result = 'grumble';
      this.candles -= 1;
    } else {
      result = 'wrath';
      this.candles -= 1;
      // Забирают того, кто угадал хуже всех; молчавшие — первые в очереди
      const score = (p) =>
        p.vote ? (p.vote.item === this.wish.item) + (p.vote.rite === this.wish.rite) : -1;
      const worst = Math.min(...living.map(score));
      taken = pick(living.filter((p) => score(p) === worst), this.rng);
      taken.role = 'dead';
      taken.vote = null;
    }

    this.reveal = { wish: this.wish, chosen, result, takenId: taken && taken.id, takenName: taken && taken.name };

    if (this.roosters >= NEED_ROOSTERS) this.outcome = 'dawn';
    else if (this.candles <= 0 || this.living().length === 0) this.outcome = 'night';

    this.setPhase(PHASE.REVEAL);
  }

  // --- представления ---

  publicView() {
    const showZalozhny = this.phase === PHASE.END;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      endsIn: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      candles: this.candles,
      maxCandles: MAX_CANDLES,
      roosters: this.roosters,
      needRoosters: NEED_ROOSTERS,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: this.phase === PHASE.LOBBY ? null : p.role,
        connected: p.connected,
        voted: !!p.vote,
        zalozhny: showZalozhny && p.zalozhny,
      })),
      table: this.table,
      signals: this.signals,
      reveal: this.reveal,
      outcome: this.outcome,
    };
  }

  playerView(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const isDead = p.role === 'dead' && this.phase !== PHASE.LOBBY;
    const seesWish = isDead && [PHASE.OMEN, PHASE.TALK, PHASE.OFFER].includes(this.phase);
    return {
      ...this.publicView(),
      me: {
        id: p.id,
        name: p.name,
        role: this.phase === PHASE.LOBBY ? null : p.role,
        zalozhny: p.zalozhny,
        wish: seesWish ? this.wish : null,
        hand: isDead ? p.hand : [],
        knocksLeft: p.knocksLeft,
        wordsLeft: p.wordsLeft,
        vote: p.vote,
      },
    };
  }

  changed() {
    this.onChange();
  }

  destroy() {
    clearTimeout(this.timer);
  }
}

module.exports = { Room, PHASE, MAX_PLAYERS, MAX_CANDLES, NEED_ROOSTERS };
