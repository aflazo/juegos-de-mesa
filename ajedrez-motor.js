/* Ajedrez — motor de reglas (movimientos legales, jaque, mate) y un rival sencillo.
   Casillas 0..63: fila 0 es la octava (arriba), columna 0 es la "a". Piezas: 'wK', 'bP', etc.
   Expone window.AjedrezMotor (y module.exports en Node para pruebas). */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const KING = ROOK.concat(BISHOP);
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  const sq = (f, r) => r * 8 + f;
  const fileOf = i => i & 7;
  const rowOf = i => i >> 3;
  const inside = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const other = c => (c === 'w' ? 'b' : 'w');
  const idx = name => sq(FILES.indexOf(name[0]), 8 - Number(name[1]));
  const name = i => FILES[fileOf(i)] + (8 - rowOf(i));

  function empty() {
    return { b: Array(64).fill(null), turn: 'w', castle: { wK: false, wQ: false, bK: false, bQ: false }, ep: null };
  }
  // Posición a partir de un objeto { e1: 'wK', ... }.
  function fromMap(map, turn) {
    const st = empty();
    Object.keys(map).forEach(k => { st.b[idx(k)] = map[k]; });
    st.turn = turn || 'w';
    return st;
  }
  function start() {
    const st = empty();
    const back = 'RNBQKBNR';
    for (let f = 0; f < 8; f++) {
      st.b[sq(f, 0)] = 'b' + back[f];
      st.b[sq(f, 1)] = 'bP';
      st.b[sq(f, 6)] = 'wP';
      st.b[sq(f, 7)] = 'w' + back[f];
    }
    st.castle = { wK: true, wQ: true, bK: true, bQ: true };
    return st;
  }

  // ¿La pieza en "from" ataca la casilla "to"? (no importa qué haya en "to")
  function hits(b, from, to) {
    const p = b[from];
    if (!p || from === to) return false;
    const t = p[1];
    const df = fileOf(to) - fileOf(from), dr = rowOf(to) - rowOf(from);
    if (t === 'P') return dr === (p[0] === 'w' ? -1 : 1) && Math.abs(df) === 1;
    if (t === 'N') return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    if (t === 'K') return Math.max(Math.abs(df), Math.abs(dr)) === 1;
    const straight = df === 0 || dr === 0, diag = Math.abs(df) === Math.abs(dr);
    if (t === 'R' && !straight) return false;
    if (t === 'B' && !diag) return false;
    if (t === 'Q' && !straight && !diag) return false;
    const sf = Math.sign(df), sr = Math.sign(dr);
    let f = fileOf(from) + sf, r = rowOf(from) + sr;
    while (sq(f, r) !== to) {
      if (b[sq(f, r)]) return false;
      f += sf; r += sr;
    }
    return true;
  }
  function attacked(st, s, by) {
    for (let i = 0; i < 64; i++) {
      const p = st.b[i];
      if (p && p[0] === by && hits(st.b, i, s)) return true;
    }
    return false;
  }
  function attackers(st, s, by) {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const p = st.b[i];
      if (p && p[0] === by && hits(st.b, i, s)) out.push(i);
    }
    return out;
  }
  const kingSq = (st, c) => st.b.indexOf(c + 'K');
  function inCheck(st, c) {
    const k = kingSq(st, c);
    return k >= 0 && attacked(st, k, other(c));
  }

  function pseudo(st, from) {
    const b = st.b, p = b[from];
    if (!p) return [];
    const c = p[0], t = p[1], f0 = fileOf(from), r0 = rowOf(from);
    const out = [];
    const add = (to, extra) => out.push(Object.assign({ from, to }, extra || {}));
    if (t === 'P') {
      const dir = c === 'w' ? -1 : 1, first = c === 'w' ? 6 : 1, last = c === 'w' ? 0 : 7;
      const r1 = r0 + dir;
      if (!inside(f0, r1)) return out;
      const promo = r1 === last ? { promo: 'Q' } : null;
      if (!b[sq(f0, r1)]) {
        add(sq(f0, r1), promo);
        if (r0 === first && !b[sq(f0, r0 + 2 * dir)]) add(sq(f0, r0 + 2 * dir), { double: true });
      }
      for (const df of [-1, 1]) {
        const nf = f0 + df;
        if (!inside(nf, r1)) continue;
        const to = sq(nf, r1), q = b[to];
        if (q && q[0] !== c) add(to, promo);
        else if (!q && st.ep === to) add(to, { epCap: sq(nf, r0) });
      }
      return out;
    }
    if (t === 'N' || t === 'K') {
      for (const [df, dr] of (t === 'N' ? KNIGHT : KING)) {
        const f = f0 + df, r = r0 + dr;
        if (!inside(f, r)) continue;
        const q = b[sq(f, r)];
        if (!q || q[0] !== c) add(sq(f, r));
      }
      return out;
    }
    const dirs = t === 'R' ? ROOK : t === 'B' ? BISHOP : KING;
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (inside(f, r)) {
        const q = b[sq(f, r)];
        if (q && q[0] === c) break;
        add(sq(f, r));
        if (q) break;
        f += df; r += dr;
      }
    }
    return out;
  }

  function apply(st, m) {
    const b = st.b.slice(), p = b[m.from];
    const captured = b[m.to] || (m.epCap != null ? b[m.epCap] : null);
    b[m.to] = m.promo ? p[0] + m.promo : p;
    b[m.from] = null;
    if (m.epCap != null) b[m.epCap] = null;
    if (m.rookFrom != null) { b[m.rookTo] = b[m.rookFrom]; b[m.rookFrom] = null; }
    const castle = Object.assign({}, st.castle);
    if (p[1] === 'K') { castle[p[0] + 'K'] = false; castle[p[0] + 'Q'] = false; }
    [m.from, m.to].forEach(s => {
      if (s === 63) castle.wK = false;
      if (s === 56) castle.wQ = false;
      if (s === 7) castle.bK = false;
      if (s === 0) castle.bQ = false;
    });
    return { b, turn: other(st.turn), castle, ep: m.double ? (m.from + m.to) / 2 : null, captured };
  }

  function legal(st, from) {
    const p = st.b[from];
    if (!p) return [];
    const c = p[0], ms = pseudo(st, from);
    if (p[1] === 'K' && st.castle) {
      const home = c === 'w' ? 60 : 4;
      const o = other(c);
      if (from === home && !inCheck(st, c)) {
        if (st.castle[c + 'K'] && !st.b[home + 1] && !st.b[home + 2] && st.b[home + 3] === c + 'R' &&
            !attacked(st, home + 1, o) && !attacked(st, home + 2, o)) {
          ms.push({ from, to: home + 2, rookFrom: home + 3, rookTo: home + 1, castle: true });
        }
        if (st.castle[c + 'Q'] && !st.b[home - 1] && !st.b[home - 2] && !st.b[home - 3] && st.b[home - 4] === c + 'R' &&
            !attacked(st, home - 1, o) && !attacked(st, home - 2, o)) {
          ms.push({ from, to: home - 2, rookFrom: home - 4, rookTo: home - 1, castle: true });
        }
      }
    }
    return ms.filter(m => !inCheck(apply(st, m), c));
  }
  function allLegal(st, c) {
    let out = [];
    for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i][0] === c) out = out.concat(legal(st, i));
    return out;
  }
  // 'play' | 'mate' | 'stalemate' | 'draw' para el bando que mueve.
  function status(st) {
    const left = st.b.filter(Boolean);
    const minors = left.filter(p => p[1] === 'N' || p[1] === 'B');
    if (left.length === 2 || (left.length === 3 && minors.length === 1)) return 'draw';
    if (allLegal(st, st.turn).length) return 'play';
    return inCheck(st, st.turn) ? 'mate' : 'stalemate';
  }

  // Puntaje de una jugada para el rival. level: 'easy' (tortuga) o 'mid' (conejo).
  function score(st, m, level) {
    const c = st.b[m.from][0], moved = st.b[m.from][1];
    const n = apply(st, m);
    let s = Math.random() * (level === 'easy' ? 6 : 1.5);
    if (n.captured) s += VAL[n.captured[1]] * (level === 'easy' ? 4 : 10);
    if (m.promo) s += 8;
    if (level === 'easy') return s;
    if (status(n) === 'mate') s += 1000;
    if (inCheck(n, other(c))) s += 1;
    // ¿Deja la pieza colgando?
    const att = attackers(n, m.to, other(c));
    if (att.length) {
      const cheapest = Math.min.apply(null, att.map(a => VAL[n.b[a][1]] || 0.5));
      const val = VAL[moved === 'K' ? 'P' : moved] || 0;
      const guarded = attacked(Object.assign({}, n, { b: n.b.map((q, i) => (i === m.to ? null : q)) }), m.to, c);
      s -= (guarded ? Math.max(0, val - cheapest) : val) * 9;
    }
    // Desarrollo suave: salir del borde y avanzar peones centrales.
    if (moved !== 'K' && moved !== 'Q') {
      const cf = fileOf(m.to);
      if (cf >= 2 && cf <= 5) s += 0.4;
    }
    return s;
  }
  function bestMove(st, c, level) {
    const ms = allLegal(st, c);
    if (!ms.length) return null;
    if (level === 'easy' && Math.random() < 0.3) return ms[Math.floor(Math.random() * ms.length)];
    let best = null, bs = -Infinity;
    for (const m of ms) {
      const s = score(st, m, level);
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  const api = { FILES, VAL, sq, fileOf, rowOf, idx, name, other, empty, fromMap, start, hits, attacked, attackers,
    kingSq, inCheck, pseudo, apply, legal, allLegal, status, bestMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AjedrezMotor = api;
})(typeof window !== 'undefined' ? window : globalThis);
