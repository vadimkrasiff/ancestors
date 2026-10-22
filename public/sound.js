// Все звуки синтезируются на лету, без файлов.
const Sound = (() => {
  let ctx = null;
  let master = null;

  function enable() {
    if (ctx) return ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    wind();
  }

  function noiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Ветер за окном: шум через полосовой фильтр, который медленно гуляет
  function wind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 1.2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(filter.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    lfo.start();
  }

  function thump(at) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(1, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + 0.3);

    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6, at);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    n.connect(f).connect(ng).connect(master);
    n.start(at);
  }

  function knock(kind) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    thump(t);
    if (kind === 'no') thump(t + 0.22);
  }

  function tone(freq, start, dur, type = 'sine', vol = 0.3) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function verdict(result) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    if (result === 'blessed') {
      [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.18, 1.6, 'triangle', 0.18));
    } else if (result === 'grumble') {
      tone(110, t, 1.8, 'sawtooth', 0.12);
      tone(116, t, 1.8, 'sawtooth', 0.1);
    } else {
      tone(55, t, 3, 'sawtooth', 0.25);
      tone(58, t, 3, 'square', 0.12);
      thump(t + 0.1);
      thump(t + 0.45);
      thump(t + 0.8);
    }
  }

  // Слово предка произносится шёпотом, если браузер это умеет
  function whisper(word) {
    try {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'ru-RU';
      u.pitch = 0.1;
      u.rate = 0.6;
      u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch {}
  }

  return { enable, knock, verdict, whisper, get on() { return !!ctx; } };
})();
