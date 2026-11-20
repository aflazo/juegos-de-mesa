/* Ajedrez para peques — aprende a jugar sin saber leer: voz, dibujos y sonidos. */
(function () {
  'use strict';

  const E = window.AjedrezMotor;
  const app = document.getElementById('app');
  const SAVE = 'ajedrez-peques';

  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const NAME = { K: 'el rey', Q: 'la reina', R: 'la torre', B: 'el alfil', N: 'el caballo', P: 'el peón' };
  const SHORT = { K: 'Rey', Q: 'Reina', R: 'Torre', B: 'Alfil', N: 'Caballo', P: 'Peón' };
  const PRAISE = ['¡Muy bien!', '¡Genial!', '¡Bravo!', '¡Excelente!', '¡Súper!', '¡Lo lograste!', '¡Qué bien!'];
  const D4 = E.idx('d4');

  const LESSONS = [
    { id: 'R', kind: 'piece', piece: 'R',
      demo: 'Esta es la torre. La torre camina derecho: hacia adelante, hacia atrás y hacia los lados. ¡Todo lo que quiera!' },
    { id: 'B', kind: 'piece', piece: 'B',
      demo: 'Este es el alfil. El alfil camina en diagonal, como una equis. Siempre se queda en cuadritos de su mismo color.' },
    { id: 'Q', kind: 'piece', piece: 'Q',
      demo: 'Esta es la reina, ¡la más poderosa! Camina derecho como la torre y en diagonal como el alfil. ¡Para todos lados!' },
    { id: 'K', kind: 'piece', piece: 'K',
      demo: 'Este es el rey, el más importante de todos. Camina despacito: solo un cuadrito, para cualquier lado.' },
    { id: 'N', kind: 'piece', piece: 'N',
      demo: 'Este es el caballo. El caballo salta como una letra ele: dos pasos derecho y uno al costado. ¡Puede saltar por encima de las otras fichas!' },
    { id: 'P', kind: 'pawn', piece: 'P',
      demo: 'Este es el peón. El peón camina hacia adelante, un cuadrito. En su primer paso puede avanzar dos. ¡Y come en diagonal, de ladito!' },
    { id: 'cap', kind: 'capture', icon: '🍽️',
      demo: '¡A comer! Cuando una ficha llega al cuadrito de una ficha negra, se la come. ¡Cómete todas las fichas negras!' },
    { id: 'chk', kind: 'check', icon: '⚠️',
      demo: '¡Jaque! Cuando alguien ataca a tu rey, se llama jaque. Tienes que salvarlo: muévelo a un cuadrito seguro, sin equis roja.' },
    { id: 'mate', kind: 'mate', icon: '👑',
      demo: '¡Jaque mate! Ataca al rey negro para que no pueda escapar a ningún lado. ¡Así se gana el ajedrez!' },
    { id: 'play', kind: 'play', icon: '🤖',
      demo: '¡Ahora a jugar una partida de verdad! Elige contra quién quieres jugar.' }
  ];

  const PUZZLES = [
    { g8: 'bK', f7: 'bP', g7: 'bP', h7: 'bP', a1: 'wR', g1: 'wK' },
    { h8: 'bK', g6: 'wK', a7: 'wQ' },
    { h8: 'bK', a7: 'wR', b1: 'wR', e1: 'wK' },
    { e8: 'bK', e6: 'wK', h4: 'wQ' },
    { h8: 'bK', g8: 'bR', g7: 'bP', h7: 'bP', e5: 'wN', a1: 'wK' },
    { a8: 'bK', a7: 'bP', b7: 'bP', d1: 'wR', g1: 'wK' },
    { g8: 'bK', f7: 'bP', g6: 'bP', h7: 'bP', h6: 'wQ', b2: 'wB', g1: 'wK' }
  ];

  /* ---------- utilidades ---------- */
  const rnd = n => Math.floor(Math.random() * n);
  const pickOne = a => a[rnd(a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function load() { try { return JSON.parse(localStorage.getItem(SAVE)) || {}; } catch (e) { return {}; } }
  function store(v) { try { localStorage.setItem(SAVE, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  let progress = load();
  if (!progress.done) progress.done = {};

  /* ---------- voz ---------- */
  let voice = null, lastSaid = '', bubble = '';
  const canSpeak = 'speechSynthesis' in window;
  function pickVoice() {
    if (!canSpeak) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^es[-_](MX|US|419|CL|AR|CO|PE)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  }
  if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function say(text, keepBubble) {
    lastSaid = text;
    if (!keepBubble) { bubble = text; const el = document.querySelector('.bubble'); if (el) el.textContent = text; }
    if (!canSpeak) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'es-ES';
    if (voice) u.voice = voice;
    u.rate = 0.92; u.pitch = 1.15;
    u.onstart = () => document.body.classList.add('talking');
    u.onend = u.onerror = () => document.body.classList.remove('talking');
    speechSynthesis.speak(u);
  }

  /* ---------- sonidos ---------- */
  let ac = null;
  function tone(freq, dur, type, when, vol) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) { /* sin audio */ }
  }
  const sfx = {
    move: () => tone(520, 0.08, 'triangle', 0, 0.12),
    eat: () => { tone(300, 0.1, 'square', 0, 0.08); tone(200, 0.15, 'square', 0.08, 0.08); },
    star: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.18, 'sine', i * 0.08)),
    wrong: () => tone(160, 0.25, 'sawtooth', 0, 0.07),
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.12)),
    check: () => { tone(880, 0.12, 'square', 0, 0.07); tone(880, 0.12, 'square', 0.18, 0.07); }
  };

  function confetti(n) {
    const bits = ['⭐', '🎉', '🎈', '✨', '🌟', '🎊'];
    for (let i = 0; i < (n || 30); i++) {
      const s = document.createElement('span');
      s.className = 'confetti';
      s.textContent = pickOne(bits);
      s.style.left = Math.random() * 100 + 'vw';
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.fontSize = 18 + rnd(22) + 'px';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 3200);
    }
  }

  /* ---------- estado de la pantalla ---------- */
  let screen = 'start';
  let L = null;          // lección en curso
  let busy = false;
  let wrongCount = 0;

  function lessonIndex(id) { return LESSONS.findIndex(l => l.id === id); }
  function nextSuggested() {
    const i = LESSONS.findIndex(l => !progress.done[l.id]);
    return i < 0 ? null : LESSONS[i].id;
  }

  /* ---------- tablero ---------- */
  function pieceHTML(p, extra) {
    return '<span class="pc ' + (p[0] === 'w' ? 'w' : 'b') + (extra || '') + '">' + GLYPH[p[1]] + '︎</span>';
  }
  function boardHTML(o) {
    // o: { st, moves, sel, stars:Set, last, check, danger:Set, line:Set, hint:Set, anim:{from,to}, fallen }
    let h = '<div class="board' + (o.shake ? ' shake' : '') + '">';
    const targets = new Map((o.moves || []).map(m => [m.to, m]));
    for (let i = 0; i < 64; i++) {
      const dark = (E.fileOf(i) + E.rowOf(i)) % 2 === 1;
      const p = o.st.b[i];
      let cls = 'sq ' + (dark ? 'dk' : 'lt');
      if (o.sel === i) cls += ' sel';
      if (o.last && (o.last.from === i || o.last.to === i)) cls += ' last';
      if (o.check === i) cls += ' chk';
      if (o.line && o.line.has(i)) cls += ' line';
      if (o.hint && o.hint.has(i)) cls += ' hint';
      if (targets.has(i)) cls += ' can';
      let inner = '';
      if (o.stars && o.stars.has(i)) inner += '<span class="star">⭐</span>';
      if (p) {
        let extra = '';
        let style = '';
        if (o.anim && o.anim.to === i) {
          extra += ' slide';
          style = ' style="--dx:' + (E.fileOf(o.anim.from) - E.fileOf(i)) + ';--dy:' + (E.rowOf(o.anim.from) - E.rowOf(i)) + '"';
        }
        if (o.fallen === i) extra += ' fallen';
        inner += pieceHTML(p, extra).replace('<span class', '<span' + style + ' class');
      }
      if (targets.has(i)) inner += p ? '<span class="ring"></span>' : '<span class="dot"></span>';
      if (o.danger && o.danger.has(i)) inner += '<span class="x">✖</span>';
      h += '<div class="' + cls + '" data-sq="' + i + '">' + inner + '</div>';
    }
    return h + '</div>';
  }

  function barHTML(middle) {
    return '<div class="bar"><button class="ib" data-act="map" aria-label="Volver al mapa">🗺️</button>' +
      '<div class="mid">' + (middle || '') + '</div>' +
      '<button class="ib" data-act="say" aria-label="Repetir">🔊</button></div>';
  }
  function guideHTML() {
    return '<div class="guide"><span class="owl">🦉</span><div class="bubble">' + escapeHTML(bubble) + '</div></div>';
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function dotsProgress(n, goal) {
    let h = '';
    for (let i = 0; i < goal; i++) h += '<span class="pg' + (i < n ? ' on' : '') + '">' + (i < n ? '⭐' : '☆') + '</span>';
    return h;
  }

  /* ---------- pantallas ---------- */
  function render() {
    if (screen === 'start') return renderStart();
    if (screen === 'map') return renderMap();
    if (screen === 'lesson') return renderLesson();
  }

  function renderStart() {
    app.innerHTML =
      '<div class="start">' +
      '<a class="back" href="index.html" aria-label="Volver a Juegos de Mesa">⬅</a>' +
      '<div class="hero">' + pieceHTML('wN') + pieceHTML('bK') + pieceHTML('wQ') + '</div>' +
      '<h1>Ajedrez para peques</h1>' +
      '<button class="play-big" data-act="begin" aria-label="Empezar">▶</button>' +
      '<p class="parents">Para niños que todavía no leen: el búho explica todo en voz alta. Sube el volumen 🔊</p>' +
      '</div>';
  }

  function renderMap() {
    const next = nextSuggested();
    let tiles = '';
    LESSONS.forEach((l, i) => {
      const icon = l.piece ? pieceHTML('w' + l.piece) : '<span class="emo">' + l.icon + '</span>';
      tiles += '<button class="tile' + (progress.done[l.id] ? ' done' : '') + (next === l.id ? ' next' : '') +
        '" data-act="open" data-id="' + l.id + '" aria-label="Lección ' + (i + 1) + '">' +
        '<span class="num">' + (i + 1) + '</span>' + icon +
        (progress.done[l.id] ? '<span class="medal">🏅</span>' : '') + '</button>';
    });
    app.innerHTML =
      '<div class="map">' +
      '<div class="bar"><a class="ib" href="index.html" aria-label="Volver a Juegos de Mesa">⬅</a>' +
      '<div class="mid">' + dotsProgress(Object.keys(progress.done).filter(k => progress.done[k]).length, LESSONS.length) + '</div>' +
      '<button class="ib" data-act="say" aria-label="Repetir">🔊</button></div>' +
      guideHTML() +
      '<div class="tiles">' + tiles + '</div>' +
      '</div>';
  }

  function renderLesson() {
    const lesson = L.lesson;
    let mid = '';
    if (L.phase === 'choose') mid = '';
    else if (lesson.kind === 'play') mid = playStatusHTML();
    else mid = dotsProgress(L.count, L.goal);

    let main = '';
    if (L.phase === 'choose') {
      main = '<div class="choose">' +
        '<button class="opp" data-act="opp" data-v="easy" aria-label="Contra la tortuga (fácil)"><span>🐢</span><small>vs 🤖</small></button>' +
        '<button class="opp" data-act="opp" data-v="mid" aria-label="Contra el conejo (más difícil)"><span>🐇</span><small>vs 🤖</small></button>' +
        '<button class="opp" data-act="opp" data-v="two" aria-label="Dos jugadores"><span>👧👦</span><small>1 vs 1</small></button>' +
        '</div>';
    } else {
      main = boardHTML(L.view());
    }

    let actions = '';
    if (L.phase === 'demo') actions = '<button class="go" data-act="go" aria-label="¡A jugar!">▶</button>';
    if (lesson.kind === 'play' && L.phase === 'go') {
      actions = '<div class="tray">' + L.eaten.b.map(p => pieceHTML(p)).join('') + '</div>' +
        '<button class="ib" data-act="undo" aria-label="Deshacer">↩️</button>' +
        (L.bot ? '<button class="ib" data-act="hint" aria-label="Ayuda">💡</button>' : '') +
        '<button class="ib" data-act="newgame" aria-label="Otra partida">🔄</button>';
    }

    app.innerHTML =
      '<div class="lesson">' + barHTML(mid) + guideHTML() + main +
      '<div class="actions">' + actions + '</div>' + overlayHTML() + '</div>';

    if (L.anim) L.anim = null;
    if (L.shake) L.shake = false;
  }

  function playStatusHTML() {
    const turn = L.st.turn;
    if (L.bot) {
      return '<span class="who' + (turn === 'w' ? ' on' : '') + '">' + pieceHTML('wK') + '</span>' +
        '<span class="vs">' + (turn === 'b' && !L.over ? '🤔' : '') + '</span>' +
        '<span class="who' + (turn === 'b' ? ' on' : '') + '">' + (L.bot === 'easy' ? '🐢' : '🐇') + '</span>';
    }
    return '<span class="who' + (turn === 'w' ? ' on' : '') + '">' + pieceHTML('wK') + '</span>' +
      '<span class="who' + (turn === 'b' ? ' on' : '') + '">' + pieceHTML('bK') + '</span>';
  }

  function overlayHTML() {
    if (!L.done) return '';
    const d = L.done;
    let btns = '<button class="ib big" data-act="again" aria-label="Otra vez">🔁</button>' +
      '<button class="ib big" data-act="map" aria-label="Mapa">🗺️</button>';
    const i = lessonIndex(L.lesson.id);
    if (d.next && i < LESSONS.length - 1) btns += '<button class="ib big primary" data-act="next" aria-label="Siguiente">➡️</button>';
    return '<div class="overlay"><div class="modal"><div class="trophy">' + d.icon + '</div>' +
      '<div class="row">' + btns + '</div></div></div>';
  }

  /* ---------- lecciones ---------- */
  function openLesson(id) {
    const lesson = LESSONS[lessonIndex(id)];
    wrongCount = 0;
    busy = false;
    L = { lesson, phase: 'demo', count: 0, goal: 5, sel: null, moves: [], stars: new Set(), last: null, done: null };
    L.view = () => ({ st: L.st, sel: L.sel, moves: L.moves, stars: L.stars, last: L.last, anim: L.anim, shake: L.shake,
      check: L.check, danger: L.danger, line: L.line, hint: L.hint, fallen: L.fallen });
    screen = 'lesson';
    ({ piece: setupPiece, pawn: setupPawn, capture: setupCapture, check: setupCheck, mate: setupMate, play: setupPlay })[lesson.kind]();
  }

  function finish(text, icon, opts) {
    progress.done[L.lesson.id] = true;
    store(progress);
    busy = true;
    setTimeout(() => {
      sfx.win(); confetti(40);
      L.done = { icon: icon || '🏅', next: !opts || opts.next !== false };
      render();
      say(text);
      busy = false;
    }, 600);
  }

  function praise() { return pickOne(PRAISE); }

  /* --- una pieza: atrapa las estrellas --- */
  function demoDots(from, extraSay) {
    // Muestra los puntitos de a uno para que se vea cómo se mueve.
    const all = E.legal(L.st, from);
    L.sel = from;
    L.moves = [];
    render();
    say(L.lesson.demo + (extraSay || ''));
    let k = 0;
    const order = all.slice().sort((a, b) => dirKey(from, a.to) - dirKey(from, b.to));
    const tick = () => {
      if (!L || L.phase !== 'demo') return;
      L.moves = order.slice(0, ++k);
      render();
      if (k < order.length) L.timer = setTimeout(tick, 140);
    };
    L.timer = setTimeout(tick, 500);
  }
  function dirKey(from, to) {
    const df = E.fileOf(to) - E.fileOf(from), dr = E.rowOf(to) - E.rowOf(from);
    return Math.atan2(dr, df) * 100 + Math.max(Math.abs(df), Math.abs(dr));
  }

  function setupPiece() {
    const t = L.lesson.piece;
    L.st = E.fromMap({});
    L.st.b[D4] = 'w' + t;
    L.pos = D4;
    demoDots(D4);
  }
  function startStars() {
    L.phase = 'go';
    L.goal = 5;
    clearTimeout(L.timer);
    newStar();
    autoSelect();
    render();
    say('¡Ahora tú! Lleva ' + NAME[L.lesson.piece] + ' hasta la estrella. Toca un puntito.');
  }
  function newStar() {
    const opts = E.legal(L.st, L.pos).map(m => m.to);
    // Preferimos estrellas un poco lejos para las piezas que corren.
    const far = opts.filter(s => Math.max(Math.abs(E.fileOf(s) - E.fileOf(L.pos)), Math.abs(E.rowOf(s) - E.rowOf(L.pos))) > 1);
    const pool = far.length && L.lesson.piece !== 'K' && L.lesson.piece !== 'N' ? far : opts;
    L.stars = new Set([pickOne(pool)]);
  }
  function autoSelect() {
    L.sel = L.pos;
    L.moves = E.legal(L.st, L.pos);
  }

  /* --- el peón --- */
  function setupPawn() {
    L.st = E.fromMap({ e2: 'wP', f3: 'bP' });
    L.pos = E.idx('e2');
    demoDots(L.pos);
  }
  function startPawn() {
    L.phase = 'go';
    clearTimeout(L.timer);
    const f = 1 + rnd(6);
    L.st = E.empty();
    L.pos = E.sq(f, 6);
    L.st.b[L.pos] = 'wP';
    L.goal = 5;
    L.count = 0;
    pawnStep();
    autoSelect();
    render();
    say('¡Ahora tú! Lleva el peón hasta el final del tablero. ¡Algo mágico va a pasar!');
  }
  function pawnStep() {
    // Limpia obstáculos y pone el siguiente objetivo.
    L.stars = new Set();
    for (let i = 0; i < 64; i++) if (L.st.b[i] && L.st.b[i][0] === 'b') L.st.b[i] = null;
    const f = E.fileOf(L.pos), r = E.rowOf(L.pos);
    if (r === 0) return;
    if (r === 6) { L.stars.add(E.sq(f, 4)); return; }
    if (r >= 2 && Math.random() < 0.5) {
      // Bloqueado al frente: hay que comer en diagonal.
      L.st.b[E.sq(f, r - 1)] = 'bP';
      const df = f === 0 ? 1 : f === 7 ? -1 : pickOne([-1, 1]);
      L.st.b[E.sq(f + df, r - 1)] = pickOne(['bN', 'bB', 'bP']);
      L.blocked = true;
      return;
    }
    L.blocked = false;
    L.stars.add(E.sq(f, r - 1));
  }

  /* --- a comer --- */
  const CAP_PIECES = ['R', 'B', 'N', 'Q', 'R', 'N'];
  function setupCapture() {
    L.round = 0;
    L.goal = 4;
    L.st = E.fromMap({ d4: 'wR', d7: 'bP' });
    L.pos = D4;
    L.sel = D4;
    L.moves = E.legal(L.st, D4);
    render();
    say(L.lesson.demo);
  }
  function captureRound() {
    const t = CAP_PIECES[L.round % CAP_PIECES.length];
    for (let tries = 0; tries < 400; tries++) {
      const st = E.empty();
      const p0 = rnd(64);
      st.b[p0] = 'w' + t;
      // Camino: p0 -> e1 -> e2 -> e3, cada una a un salto de la anterior.
      let cur = p0;
      const chain = [];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const probe = E.empty();
        probe.b[cur] = 'w' + t;
        const opts = E.legal(probe, cur).map(m => m.to).filter(s => s !== p0 && !chain.includes(s));
        if (!opts.length) { ok = false; break; }
        const s = pickOne(opts);
        chain.push(s);
        cur = s;
      }
      if (!ok) continue;
      chain.forEach(s => { st.b[s] = 'b' + pickOne(['P', 'N', 'B', 'R']); });
      // Verifica que la cadena se pueda comer en orden con las otras fichas puestas.
      let sim = st, pos = p0, good = true;
      for (const s of chain) {
        const m = E.legal(sim, pos).find(x => x.to === s);
        if (!m) { good = false; break; }
        sim = E.apply(sim, m); pos = s;
      }
      if (!good) continue;
      L.st = st; L.pos = p0;
      return;
    }
  }
  function startCapture() {
    L.phase = 'go';
    L.count = 0;
    captureRound();
    autoSelect();
    render();
    say('¡Cómete todas las fichas negras con ' + NAME[CAP_PIECES[0]] + '!');
  }

  /* --- jaque --- */
  function setupCheck() {
    L.goal = 4;
    L.st = E.fromMap({ e1: 'wK', e8: 'bR' });
    L.pos = E.idx('e1');
    checkMarks();
    render();
    say(L.lesson.demo);
  }
  function checkRound() {
    for (let tries = 0; tries < 500; tries++) {
      const k = rnd(64), a = rnd(64);
      if (k === a) continue;
      const t = pickOne(['R', 'B', 'Q', 'N', 'R']);
      if (Math.max(Math.abs(E.fileOf(k) - E.fileOf(a)), Math.abs(E.rowOf(k) - E.rowOf(a))) <= 1) continue;
      const st = E.empty();
      st.b[k] = 'wK'; st.b[a] = 'b' + t;
      if (!E.attacked(st, k, 'b')) continue;
      const ms = E.legal(st, k);
      if (ms.length < 2) continue;
      L.st = st; L.pos = k;
      return;
    }
  }
  function checkMarks() {
    const k = L.pos;
    L.check = E.inCheck(L.st, 'w') ? k : null;
    L.line = new Set();
    L.danger = new Set();
    if (L.check == null) return;
    E.attackers(L.st, k, 'b').forEach(a => {
      L.line.add(a);
      const t = L.st.b[a][1];
      if (t === 'N') return;
      const sf = Math.sign(E.fileOf(k) - E.fileOf(a)), sr = Math.sign(E.rowOf(k) - E.rowOf(a));
      let f = E.fileOf(a) + sf, r = E.rowOf(a) + sr;
      while (E.sq(f, r) !== k) { L.line.add(E.sq(f, r)); f += sf; r += sr; }
    });
    const ok = new Set(E.legal(L.st, k).map(m => m.to));
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      const f = E.fileOf(k) + df, r = E.rowOf(k) + dr;
      if ((!df && !dr) || f < 0 || f > 7 || r < 0 || r > 7) continue;
      const s = E.sq(f, r);
      if (!ok.has(s)) L.danger.add(s);
    }
    L.sel = k;
    L.moves = E.legal(L.st, k);
  }
  function startCheck() {
    L.phase = 'go';
    L.count = 0;
    checkRound();
    checkMarks();
    render();
    sfx.check();
    say('¡Jaque! Salva a tu rey. Llévalo a un puntito verde.');
  }

  /* --- jaque mate --- */
  function setupMate() {
    L.goal = PUZZLES.length;
    L.order = shuffle(PUZZLES.slice());
    L.st = E.fromMap(L.order[0]);
    L.sel = null; L.moves = [];
    L.phase = 'demo';
    render();
    say(L.lesson.demo);
  }
  function mateRound() {
    L.st = E.fromMap(L.order[L.count]);
    L.sel = null; L.moves = []; L.last = null; L.hint = null; L.fallen = null;
    L.fails = 0;
  }
  function startMate() {
    L.phase = 'go';
    L.count = 0;
    mateRound();
    render();
    say('Toca una de tus fichas blancas y dale jaque mate al rey negro.');
  }

  /* --- partida completa --- */
  function setupPlay() {
    L.phase = 'choose';
    L.st = E.start();
    render();
    say('¡A jugar! ¿Contra quién? La tortuga es tranquila, el conejo es más listo. O jueguen dos personas.');
  }
  function startGame(bot) {
    L.phase = 'go';
    L.bot = bot === 'two' ? null : bot;
    L.st = E.start();
    L.hist = [];
    L.eaten = { w: [], b: [] };
    L.sel = null; L.moves = []; L.last = null; L.over = null; L.hint = null; L.check = null;
    render();
    say(L.bot ? 'Tú juegas con las blancas. ¡Empiezas tú! Toca una ficha.' : 'Empiezan las blancas. ¡Mucha suerte!');
  }

  /* ---------- toques en el tablero ---------- */
  function wrong(msg) {
    sfx.wrong();
    L.shake = true;
    render();
    wrongCount++;
    if (msg && (wrongCount <= 2 || wrongCount % 4 === 0)) say(msg);
  }

  function tap(i) {
    if (busy || !L || L.done) return;
    const k = L.lesson.kind;
    if (L.phase === 'demo') {
      // En la demostración cualquier toque arranca el juego.
      return go();
    }
    if (L.phase !== 'go') return;
    const m = L.moves.find(x => x.to === i);
    if (L.sel != null && m) return move(m);
    const p = L.st.b[i];
    const canPick = (k === 'mate' && p && p[0] === 'w') ||
      (k === 'play' && !L.over && p && p[0] === L.st.turn && (!L.bot || L.st.turn === 'w'));
    if (canPick) {
      if (L.sel === i) { L.sel = null; L.moves = []; render(); return; }
      L.sel = i;
      L.moves = E.legal(L.st, i);
      sfx.move();
      render();
      say(SHORT[p[1]], true);
      if (!L.moves.length) say(SHORT[p[1]] + '. Esta ficha no se puede mover ahora.');
      return;
    }
    if (k === 'play' && L.over) return;
    if (k === 'play' && L.bot && L.st.turn === 'b') return;
    if (L.sel == null) return wrong(k === 'play' || k === 'mate' ? 'Primero toca una de tus fichas blancas.' : null);
    wrong(k === 'check' ? '¡Ahí no! Ese cuadrito es peligroso. Busca un puntito verde.' : 'Por ahí no puede ir. Mira los puntitos.');
  }

  function move(m) {
    const k = L.lesson.kind;
    const before = L.st;
    const n = E.apply(before, m);
    L.anim = { from: m.from, to: m.to };
    L.last = { from: m.from, to: m.to };
    if (k !== 'play' && k !== 'mate') n.turn = 'w';
    if (n.captured) sfx.eat(); else sfx.move();
    L.st = n;
    L.sel = null; L.moves = [];

    if (k === 'piece') {
      L.pos = m.to;
      if (L.stars.has(m.to)) {
        L.count++;
        sfx.star();
        if (L.count >= L.goal) { L.stars = new Set(); render(); return finish('¡Felicidades! Ya sabes mover ' + NAME[L.lesson.piece] + '.', '🏅'); }
        say(praise() + (L.count === L.goal - 1 ? ' ¡Falta una!' : ''));
        newStar();
      }
      autoSelect();
      return render();
    }

    if (k === 'pawn') {
      L.pos = m.to;
      const got = L.stars.has(m.to) || (n.captured && L.blocked);
      if (m.promo) {
        L.count = L.goal;
        render();
        busy = true;
        setTimeout(() => {
          sfx.star();
          busy = false;
          finish('¡Magia! El peón llegó al final y se convirtió en reina. ¡Ya sabes mover el peón!', '👑');
        }, 500);
        return;
      }
      if (got) {
        L.count = Math.min(L.goal - 1, L.count + 1);
        sfx.star();
        say(n.captured ? '¡Ñam! El peón come de ladito. ' + praise() : praise());
      }
      pawnStep();
      if (L.blocked) setTimeout(() => { if (L && L.blocked) say('¡Uy, una ficha tapa el camino! El peón no puede comer derecho. ¡Cómete la de al lado!'); }, 700);
      autoSelect();
      return render();
    }

    if (k === 'capture') {
      L.pos = m.to;
      if (n.captured) say(pickOne(['¡Ñam!', '¡Ñam, ñam!', '¡Rico!', praise()]));
      const left = n.b.some(p => p && p[0] === 'b');
      if (!left) {
        L.count++;
        sfx.star();
        if (L.count >= L.goal) { render(); return finish('¡Felicidades! Te comiste todas las fichas.', '🏅'); }
        render();
        busy = true;
        setTimeout(() => {
          L.round++;
          captureRound();
          autoSelect();
          L.last = null;
          busy = false;
          render();
          say('¡Otra vez! Ahora con ' + NAME[CAP_PIECES[L.round % CAP_PIECES.length]] + '.');
        }, 1100);
        return;
      }
      autoSelect();
      return render();
    }

    if (k === 'check') {
      L.pos = m.to;
      L.check = null; L.line = new Set(); L.danger = new Set();
      L.count++;
      sfx.star();
      if (L.count >= L.goal) { render(); return finish('¡Felicidades! Sabes salvar a tu rey del jaque.', '🛡️'); }
      say(n.captured ? '¡Te comiste al atacante! Tu rey está a salvo.' : '¡Bien! Tu rey está a salvo.');
      render();
      busy = true;
      setTimeout(() => {
        checkRound();
        checkMarks();
        L.last = null;
        busy = false;
        render();
        sfx.check();
        say('¡Jaque otra vez! Salva al rey.');
      }, 1300);
      return;
    }

    if (k === 'mate') {
      const st = E.status(n);
      if (st === 'mate') {
        L.count++;
        L.fallen = E.kingSq(n, 'b');
        L.check = L.fallen;
        render();
        sfx.star();
        if (L.count >= L.goal) return finish('¡Jaque mate! ¡Eres un campeón del ajedrez!', '🏆');
        say('¡Jaque mate! ' + praise());
        busy = true;
        setTimeout(() => { mateRound(); busy = false; render(); say('Otro más. ¡Dale jaque mate!'); }, 1700);
        return;
      }
      L.fails = (L.fails || 0) + 1;
      L.check = E.inCheck(n, 'b') ? E.kingSq(n, 'b') : null;
      render();
      busy = true;
      say(L.check != null ? '¡Es jaque, pero el rey negro puede escapar! Prueba otra.' : 'Mmm, así no es jaque mate. ¡Prueba otra!');
      setTimeout(() => {
        L.st = before; L.last = null; L.check = null;
        if (L.fails >= 2) {
          const sol = E.allLegal(before, 'w').find(x => E.status(E.apply(before, x)) === 'mate');
          L.hint = new Set([sol.from]);
          if (L.fails >= 3) L.hint.add(sol.to);
        }
        busy = false;
        render();
        if (L.fails >= 2) say('Una ayudita: prueba con la ficha que brilla.');
      }, 1500);
      return;
    }

    if (k === 'play') return afterGameMove(m, before);
  }

  function afterGameMove(m, before) {
    L.hist.push({ st: before, last: L.prevLast || null, eaten: { w: L.eaten.w.slice(), b: L.eaten.b.slice() } });
    L.prevLast = L.last;
    L.hint = null;
    const n = L.st;
    if (n.captured) {
      L.eaten[n.captured[0]].push(n.captured);
      if (n.captured[0] === 'b') say(pickOne(['¡Ñam! Te comiste ' + NAME[n.captured[1]] + '.', '¡Bien! Atrapaste ' + NAME[n.captured[1]] + '.']));
      else if (L.bot) say('¡Uy! Se comieron ' + NAME[n.captured[1]] + '.');
    }
    if (m.promo) say('¡El peón se convirtió en reina!');
    const st = E.status(n);
    L.check = E.inCheck(n, n.turn) ? E.kingSq(n, n.turn) : null;
    if (st !== 'play') return gameOver(st);
    if (L.check != null) {
      sfx.check();
      if (L.bot) say(n.turn === 'w' ? '¡Jaque! Tu rey está en peligro. ¡Sálvalo!' : '¡Le diste jaque al rey negro!');
      else say('¡Jaque! ¡Cuidado con el rey!');
    }
    render();
    if (L.bot && n.turn === 'b') {
      busy = true;
      setTimeout(() => {
        busy = false;
        if (!L || L.lesson.kind !== 'play' || L.st !== n) return;
        const bm = E.bestMove(n, 'b', L.bot);
        const before2 = L.st;
        L.anim = { from: bm.from, to: bm.to };
        L.last = { from: bm.from, to: bm.to };
        L.st = E.apply(before2, bm);
        if (L.st.captured) sfx.eat(); else sfx.move();
        afterGameMove(bm, before2);
      }, 650 + rnd(500));
    }
  }

  function gameOver(st) {
    const n = L.st;
    L.over = st;
    L.sel = null; L.moves = [];
    if (st === 'mate') {
      const winner = E.other(n.turn);
      L.fallen = E.kingSq(n, n.turn);
      render();
      if (!L.bot) return finish('¡Jaque mate! Ganaron las ' + (winner === 'w' ? 'blancas' : 'negras') + '. ¡Qué gran partida!', '🏆', { next: false });
      if (winner === 'w') return finish('¡Jaque mate! ¡Le ganaste ' + (L.bot === 'easy' ? 'a la tortuga' : 'al conejo') + '! ¡Eres un campeón!', '🏆', { next: false });
      busy = true;
      setTimeout(() => {
        busy = false;
        L.done = { icon: '🤗', next: false };
        render();
        say('¡Jaque mate! Esta vez ganó ' + (L.bot === 'easy' ? 'la tortuga' : 'el conejo') + '. ¡Buen intento! ¿Jugamos otra?');
      }, 900);
      return;
    }
    render();
    busy = true;
    setTimeout(() => {
      busy = false;
      L.done = { icon: '🤝', next: false };
      render();
      say(st === 'stalemate' ? '¡Empate! El rey no puede moverse, pero no está en jaque. Nadie gana.' : '¡Empate! Quedan muy pocas fichas para ganar.');
    }, 900);
  }

  function go() {
    if (!L || L.phase !== 'demo') return;
    const k = L.lesson.kind;
    if (k === 'piece') startStars();
    else if (k === 'pawn') startPawn();
    else if (k === 'capture') startCapture();
    else if (k === 'check') startCheck();
    else if (k === 'mate') startMate();
  }

  /* ---------- botones ---------- */
  const acts = {
    begin() {
      tone(1, 0.01); // desbloquea el audio en iOS
      screen = 'map';
      bubble = '';
      render();
      say('¡Hola! Soy Búho. ¡Vamos a aprender ajedrez! Toca la ficha que brilla para empezar.');
    },
    map() {
      if (L) clearTimeout(L.timer);
      L = null; busy = false;
      screen = 'map';
      render();
      say(nextSuggested() ? 'Toca la ficha que brilla.' : '¡Terminaste todas las lecciones! Puedes jugar todas las veces que quieras.');
    },
    open(el) { openLesson(el.dataset.id); },
    say() { if (lastSaid) say(lastSaid, true); },
    go() { go(); },
    again() { openLesson(L.lesson.id); },
    next() {
      const i = lessonIndex(L.lesson.id);
      openLesson(LESSONS[Math.min(i + 1, LESSONS.length - 1)].id);
    },
    opp(el) { startGame(el.dataset.v); },
    newgame() { L.phase = 'choose'; L.done = null; L.st = E.start(); render(); say('¿Contra quién quieres jugar?'); },
    undo() {
      if (busy || !L.hist || !L.hist.length) return;
      let h = L.hist.pop();
      if (L.bot && h.st.turn === 'b' && L.hist.length) h = L.hist.pop();
      L.st = h.st; L.last = h.last; L.prevLast = h.last; L.eaten = h.eaten;
      L.sel = null; L.moves = []; L.over = null; L.fallen = null; L.hint = null;
      L.check = E.inCheck(L.st, L.st.turn) ? E.kingSq(L.st, L.st.turn) : null;
      render();
      say('Volvimos atrás.');
    },
    hint() {
      if (busy || L.over || L.st.turn !== 'w') return;
      const m = E.bestMove(L.st, 'w', 'mid');
      if (!m) return;
      L.hint = new Set([m.from, m.to]);
      L.sel = null; L.moves = [];
      render();
      say('Una idea: mueve ' + NAME[L.st.b[m.from][1]] + ' al cuadrito que brilla.');
    }
  };

  function onTap(e) {
    const sqEl = e.target.closest('[data-sq]');
    if (sqEl) { e.preventDefault(); return tap(Number(sqEl.dataset.sq)); }
    const a = e.target.closest('[data-act]');
    if (a && acts[a.dataset.act]) { e.preventDefault(); acts[a.dataset.act](a); }
  }
  app.addEventListener('click', onTap);

  render();
  window.__ajedrez = { get L() { return L; }, openLesson, acts };
})();
