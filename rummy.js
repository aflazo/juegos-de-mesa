/* Rummy de Fichas — motor de reglas (sin interfaz). Expone window.Rummy. */
(function (root) {
  'use strict';

  const COLORS = ['K', 'B', 'R', 'O'];
  const COLOR_NAME = { K: 'negro', B: 'azul', R: 'rojo', O: 'naranja', J: 'comodín' };
  const MAX_PLAYERS = 4;
  const HAND = 14;
  const INITIAL = 30;
  const JOKER_PTS = 30;

  const plain = t => ({ id: t.id, n: t.n, c: t.c });
  const tileVal = t => (t.n === 0 ? JOKER_PTS : t.n);
  const rackValue = rack => rack.reduce((a, t) => a + tileVal(t), 0);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 2 juegos del 1 al 13 en 4 colores (104 fichas) + 2 comodines (n = 0).
  function buildPool() {
    const d = [];
    let id = 0;
    for (let k = 0; k < 2; k++)
      for (const c of COLORS)
        for (let n = 1; n <= 13; n++) d.push({ id: id++, n, c });
    d.push({ id: id++, n: 0, c: 'J' });
    d.push({ id: id++, n: 0, c: 'J' });
    return shuffle(d);
  }

  /* ---------- Juegos válidos ---------- */

  // Grupo: 3 o 4 fichas del mismo número y colores distintos.
  // Escalera: 3 o más fichas del mismo color y números seguidos (sin vuelta del 13 al 1).
  // Los comodines reemplazan cualquier ficha. Si hay dudas, el comodín vale lo más alto posible.
  function analyze(tiles) {
    const len = tiles.length;
    if (len < 3 || len > 13) return null;
    const jokers = tiles.filter(t => t.n === 0);
    const nat = tiles.filter(t => t.n !== 0);
    if (!nat.length) return null;
    const cands = [];

    if (len <= 4 && nat.every(t => t.n === nat[0].n) && new Set(nat.map(t => t.c)).size === nat.length) {
      const n = nat[0].n;
      const cells = nat.slice().sort((a, b) => COLORS.indexOf(a.c) - COLORS.indexOf(b.c))
        .concat(jokers).map(t => ({ id: t.id, n: t.n, c: t.c, val: n }));
      cands.push({ type: 'G', cells, sum: n * len });
    }

    if (nat.every(t => t.c === nat[0].c)) {
      const ns = nat.map(t => t.n).sort((a, b) => a - b);
      let dup = false;
      for (let i = 1; i < ns.length; i++) if (ns[i] === ns[i - 1]) dup = true;
      if (!dup) {
        const lo = Math.max(1, ns[ns.length - 1] - len + 1);
        const hi = Math.min(ns[0], 14 - len);
        if (lo <= hi) {
          const byN = {};
          nat.forEach(t => { byN[t.n] = t; });
          const js = jokers.slice();
          const cells = [];
          let sum = 0;
          for (let v = hi; v < hi + len; v++) {
            const t = byN[v] || js.shift();
            cells.push({ id: t.id, n: t.n, c: t.c, val: v });
            sum += v;
          }
          cands.push({ type: 'R', cells, sum });
        }
      }
    }

    if (!cands.length) return null;
    cands.sort((a, b) => b.sum - a.sum);
    return cands[0];
  }

  const keyOf = ids => ids.slice().sort((a, b) => a - b).join(',');

  // Revisa una jugada completa: `sets` es la mesa que queda (listas de ids de ficha).
  function evaluate(table, rack, sets, melded) {
    const rackMap = new Map(rack.map(t => [t.id, t]));
    const tableMap = new Map();
    table.forEach(s => s.forEach(t => tableMap.set(t.id, t)));
    const seen = new Set();
    const out = [];
    let used = 0;
    for (const ids of sets) {
      if (!Array.isArray(ids)) return { error: 'Jugada inválida.' };
      const tiles = [];
      for (const id of ids) {
        if (seen.has(id)) return { error: 'Jugada inválida.' };
        seen.add(id);
        const t = rackMap.get(id) || tableMap.get(id);
        if (!t) return { error: 'Jugada inválida.' };
        if (rackMap.has(id)) used++;
        tiles.push(t);
      }
      const an = analyze(tiles);
      if (!an) {
        return { error: 'Hay un juego inválido en la mesa. Cada juego necesita 3 o más fichas: un grupo (mismo número, colores distintos) o una escalera (mismo color, números seguidos).' };
      }
      out.push(an);
    }
    for (const id of tableMap.keys()) {
      if (!seen.has(id)) return { error: 'Todas las fichas de la mesa tienen que seguir en algún juego: no puedes llevártelas al atril.' };
    }
    if (used === 0) return { error: 'Tienes que jugar al menos una ficha de tu atril. Si no puedes, roba una.' };

    let meld = 0;
    if (!melded) {
      const old = new Map();
      table.forEach(s => {
        const k = keyOf(s.map(t => t.id));
        old.set(k, (old.get(k) || 0) + 1);
      });
      for (const an of out) {
        const k = keyOf(an.cells.map(c => c.id));
        if (old.get(k) > 0) old.set(k, old.get(k) - 1);
        else meld += an.sum;
      }
      for (const n of old.values()) {
        if (n > 0) return { error: 'Antes de tu primera bajada no puedes tocar los juegos de la mesa.', meld };
      }
      if (meld < INITIAL) {
        return { error: 'Tu primera bajada tiene que sumar al menos ' + INITIAL + ' puntos con fichas tuyas (ahora suma ' + meld + ').', meld };
      }
    }
    return { ok: true, used, meld, sets: out.map(an => an.cells.map(c => ({ id: c.id, n: c.n, c: c.c }))) };
  }

  /* ---------- Partida ---------- */

  function log(st, msg) {
    st.log.push(msg);
    if (st.log.length > 40) st.log.shift();
  }

  function newGame(names) {
    const st = {
      players: names.map(n => ({ name: n, rack: [], score: 0, melded: false })),
      round: 1, starter: 0, turn: 0, passes: 0,
      pool: [], table: [], status: 'playing', roundResult: null, winner: null, log: []
    };
    startRound(st);
    return st;
  }

  function startRound(st) {
    st.pool = buildPool();
    st.table = [];
    st.players.forEach(p => { p.rack = []; p.melded = false; });
    for (let k = 0; k < HAND; k++) st.players.forEach(p => p.rack.push(st.pool.pop()));
    st.turn = st.starter;
    st.passes = 0;
    st.status = 'playing';
    st.roundResult = null;
    log(st, 'Ronda ' + st.round + ': empieza ' + st.players[st.turn].name + '.');
  }

  function endRound(st, winner, blocked) {
    const left = st.players.map(p => rackValue(p.rack));
    if (winner == null) {
      winner = 0;
      left.forEach((v, i) => { if (v < left[winner]) winner = i; });
    }
    const others = left.reduce((a, v, i) => a + (i === winner ? 0 : v), 0);
    const delta = left.map((v, i) => (i === winner ? others - v : -v));
    st.players.forEach((p, i) => { p.score += delta[i]; });
    st.roundResult = {
      round: st.round, winner, blocked: !!blocked,
      rows: st.players.map((p, i) => ({ name: p.name, left: p.rack.length, pts: left[i], delta: delta[i], total: p.score }))
    };
    st.status = 'roundEnd';
  }

  function advance(st) {
    st.turn = (st.turn + 1) % st.players.length;
  }

  const err = msg => ({ error: msg });
  const OK = { ok: true };

  function act(st, pi, a) {
    if (a.t === 'next') {
      if (st.status !== 'roundEnd') return err('No hay una ronda por empezar.');
      st.round++;
      st.starter = (st.starter + 1) % st.players.length;
      startRound(st);
      return OK;
    }
    if (a.t === 'finish') {
      if (st.status !== 'roundEnd') return err('Solo se puede terminar entre rondas.');
      let w = 0;
      st.players.forEach((p, i) => { if (p.score > st.players[w].score) w = i; });
      st.winner = w;
      st.status = 'gameOver';
      log(st, st.players[w].name + ' gana la partida.');
      return OK;
    }
    if (st.status !== 'playing') return err('La ronda ya terminó.');
    if (pi !== st.turn) return err('No es tu turno.');
    const p = st.players[pi];

    if (a.t === 'draw') {
      if (!st.pool.length) return err('No quedan fichas para robar: pasa el turno.');
      p.rack.push(st.pool.pop());
      st.passes = 0;
      log(st, p.name + ' robó una ficha.');
      advance(st);
      return OK;
    }

    if (a.t === 'pass') {
      if (st.pool.length) return err('Todavía quedan fichas: tienes que robar una.');
      st.passes++;
      log(st, p.name + ' pasó.');
      if (st.passes >= st.players.length) {
        log(st, 'Nadie puede jugar. Se cierra la ronda.');
        endRound(st, null, true);
        return OK;
      }
      advance(st);
      return OK;
    }

    if (a.t === 'commit') {
      const r = evaluate(st.table, p.rack, a.sets, p.melded);
      if (r.error) return err(r.error);
      const usedIds = new Set();
      a.sets.forEach(s => s.forEach(id => usedIds.add(id)));
      const before = p.rack.length;
      p.rack = p.rack.filter(t => !usedIds.has(t.id));
      st.table = r.sets;
      const first = !p.melded;
      p.melded = true;
      st.passes = 0;
      log(st, p.name + (first ? ' hizo su primera bajada' : ' jugó') + ' (' + (before - p.rack.length) + (before - p.rack.length === 1 ? ' ficha' : ' fichas') + ').');
      if (!p.rack.length) {
        log(st, p.name + ' se quedó sin fichas.');
        endRound(st, pi, false);
        return OK;
      }
      advance(st);
      return OK;
    }

    return err('Acción desconocida.');
  }

  function viewFor(st, pi) {
    return {
      you: pi,
      players: st.players.map((p, i) => ({
        name: p.name, score: p.score, count: p.rack.length, melded: p.melded,
        rack: i === pi ? p.rack.map(plain) : null
      })),
      round: st.round, turn: st.turn, poolCount: st.pool.length,
      table: st.table.map(s => { const an = analyze(s); return { type: an.type, cells: an.cells }; }),
      initial: INITIAL, status: st.status, roundResult: st.roundResult, winner: st.winner,
      log: st.log.slice(-6)
    };
  }

  root.Rummy = {
    COLORS, COLOR_NAME, MAX_PLAYERS, HAND, INITIAL, JOKER_PTS,
    tileVal, rackValue, analyze, evaluate, newGame, act, viewFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
