/* El Maldito — motor de reglas (sin interfaz). Expone window.Maldito. */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const rankLabel = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
  const HAND_SIZE = 13;
  const MAX_PLAYERS = 6;

  const G = n => ({ type: 'G', min: n });
  const E = n => ({ type: 'E', min: n });
  const PHASES = [
    [G(3), G(3)],
    [G(3), G(3), G(4)],
    [G(4), G(4)],
    [G(4), G(4), E(4)],
    [E(4), E(4)],
    [E(4), E(4), G(4)],
    [G(3), G(3), G(3)],
    [E(7), G(3)],
    [G(3), G(3), G(3), G(3)],
    [E(5), E(5)]
  ];

  function reqName(q, n) {
    if (q.type === 'E') return (n > 1 ? 'escaleras' : 'escalera') + ' de ' + q.min;
    if (q.min === 3) return n > 1 ? 'tríos' : 'trío';
    if (q.min === 4) return n > 1 ? 'cuartetos' : 'cuarteto';
    return (n > 1 ? 'grupos' : 'grupo') + ' de ' + q.min;
  }

  function phaseText(ph) {
    if (ph > PHASES.length) return 'Completó los 10 juegos';
    const groups = [];
    for (const q of PHASES[ph - 1]) {
      const k = q.type + q.min;
      let g = groups.find(x => x.k === k);
      if (!g) { g = { k, q, n: 0 }; groups.push(g); }
      g.n++;
    }
    return groups.map(g => g.n + ' ' + reqName(g.q, g.n)).join(' + ');
  }

  function points(c) {
    if (c.r === 2) return 25;
    if (c.r === 14) return 20;
    if (c.r >= 10) return 10;
    return 5;
  }

  const plain = c => ({ id: c.id, r: c.r, s: c.s });
  const cardText = c => rankLabel(c.r) + SUIT_SYM[c.s];

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildDeck() {
    const d = [];
    let id = 0;
    for (let k = 0; k < 2; k++)
      for (const s of SUITS)
        for (let r = 2; r <= 14; r++) d.push({ id: id++, r, s });
    return shuffle(d);
  }

  /* ---------- Juegos: grupos y escaleras ---------- */

  // Grupo: 3+ cartas del mismo número. Los 2 son comodines (nunca más comodines que cartas).
  // Si todas son 2, es un grupo natural de 2.
  function evalGroup(cards) {
    if (cards.length < 3) return null;
    const nat = cards.filter(c => c.r !== 2);
    if (!nat.length) {
      return { type: 'G', rank: 2, cards: cards.map(c => Object.assign(plain(c), { wild: false, as: 2 })) };
    }
    const rank = nat[0].r;
    if (nat.some(c => c.r !== rank)) return null;
    if (cards.length - nat.length > nat.length) return null;
    return { type: 'G', rank, cards: cards.map(c => Object.assign(plain(c), { wild: c.r === 2, as: rank })) };
  }

  // Escalera: 4+ cartas consecutivas del mismo palo (2 bajo ... As alto).
  // Devuelve todas las formas válidas de acomodar los comodines.
  function runOptions(cards) {
    if (cards.length < 4) return [];
    const non2 = cards.filter(c => c.r !== 2);
    const twos = cards.filter(c => c.r === 2);
    if (!non2.length) return [];
    const suit = non2[0].s;
    if (non2.some(c => c.s !== suit)) return [];
    const seen = new Set();
    for (const c of non2) { if (seen.has(c.r)) return []; seen.add(c.r); }

    const out = [];
    const sigs = new Set();
    const nat2idx = twos.findIndex(c => c.s === suit);
    const variants = nat2idx >= 0 ? [true, false] : [false];
    for (const useNat2 of variants) {
      const nats = non2.slice();
      const wilds = twos.slice();
      if (useNat2) nats.push(wilds.splice(nat2idx, 1)[0]);
      const byRank = {};
      nats.forEach(c => { byRank[c.r] = c; });
      const rs = nats.map(c => c.r);
      const lo = Math.min.apply(null, rs), hi = Math.max.apply(null, rs);
      const gaps = (hi - lo + 1) - nats.length;
      const extra = wilds.length - gaps;
      if (extra < 0 || extra > 2) continue;
      if (wilds.length > nats.length) continue;
      const places = extra === 0 ? [[0, 0]] : extra === 1 ? [[0, 1], [1, 0]] : [[1, 1]];
      for (const pl of places) {
        const a = lo - pl[0], b = hi + pl[1];
        if (a < 2 || b > 14) continue;
        if (!useNat2 && nat2idx >= 0 && a === 2 && !byRank[2]) continue; // ya cubierto por el 2 natural
        const slots = [];
        let wi = 0, ok = true;
        for (let r = a; r <= b; r++) {
          if (byRank[r]) slots.push(Object.assign(plain(byRank[r]), { wild: false, as: r }));
          else slots.push(Object.assign(plain(wilds[wi++]), { wild: true, as: r }));
          const n = slots.length;
          if (n > 1 && slots[n - 1].wild && slots[n - 2].wild) ok = false;
        }
        if (!ok) continue;
        const sig = slots.map(s => s.as + (s.wild ? 'w' : 'n')).join(',');
        if (sigs.has(sig)) continue;
        sigs.add(sig);
        out.push({ type: 'E', suit, cards: slots });
      }
    }
    return out;
  }

  function meldOptions(cards) {
    if (cards.length < 3) return [];
    const g = evalGroup(cards);
    if (g) return [g];
    return runOptions(cards);
  }

  function meldLabel(m) {
    if (m.type === 'G') return 'Grupo de ' + rankLabel(m.rank) + ' (' + m.cards.length + ' cartas)';
    return 'Escalera ' + SUIT_SYM[m.suit] + ': ' +
      m.cards.map(s => s.wild ? '★(' + rankLabel(s.as) + ')' : rankLabel(s.as)).join(' ');
  }

  // Formas de agregar una carta a un juego de la mesa. `back` = comodín que vuelve a la mano (cambio).
  function addOptions(meld, card) {
    const c = plain(card);
    const out = [];
    if (meld.type === 'G') {
      const g = evalGroup(meld.cards.map(plain).concat([c]));
      if (g) out.push({ label: 'Agregar al grupo', meld: Object.assign({}, meld, g), back: null });
      return out;
    }
    const slots = meld.cards, suit = meld.suit;
    const last = slots.length - 1;
    const lo = slots[0].as, hi = slots[last].as;
    const nW = slots.filter(s => s.wild).length, nN = slots.length - nW;
    const mk = cards => Object.assign({}, meld, { cards });
    const sym = SUIT_SYM[suit];

    if (c.s === suit) { // carta natural (incluye el 2 del palo como 2 de verdad)
      const r = c.r;
      const nat = Object.assign({}, c, { wild: false, as: r });
      if (r === lo - 1) out.push({ label: 'Agregar abajo', meld: mk([nat].concat(slots)), back: null });
      else if (r === hi + 1) out.push({ label: 'Agregar arriba', meld: mk(slots.concat([nat])), back: null });
      else if (r >= lo && r <= hi && slots[r - lo].wild) {
        const ns = slots.slice();
        const back = plain(ns[r - lo]);
        ns[r - lo] = nat;
        out.push({ label: 'Cambiar por el comodín (te llevas el 2)', meld: mk(ns), back });
      }
    }
    if (c.r === 2 && nW + 1 <= nN) {
      if (hi + 1 <= 14 && !slots[last].wild) {
        const w = Object.assign({}, c, { wild: true, as: hi + 1 });
        out.push({ label: 'Comodín arriba (como ' + rankLabel(hi + 1) + sym + ')', meld: mk(slots.concat([w])), back: null });
      }
      if (lo - 1 >= 2 && !slots[0].wild && !(lo - 1 === 2 && c.s === suit)) {
        const w = Object.assign({}, c, { wild: true, as: lo - 1 });
        out.push({ label: 'Comodín abajo (como ' + rankLabel(lo - 1) + sym + ')', meld: mk([w].concat(slots)), back: null });
      }
    }
    return out;
  }

  function matchPhase(reqs, melds) {
    if (reqs.length !== melds.length) return false;
    const used = [];
    const fits = (q, m) => q.type === m.type && m.cards.length >= q.min;
    const rec = i => {
      if (i === reqs.length) return true;
      for (let j = 0; j < melds.length; j++) {
        if (used[j] || !fits(reqs[i], melds[j])) continue;
        used[j] = true;
        if (rec(i + 1)) return true;
        used[j] = false;
      }
      return false;
    };
    return rec(0);
  }

  // Si te queda una sola carta y calza en la mesa, estás obligado a jugarla (te vas sucio).
  function mustPlayLast(table, player) {
    if (!player.bajado || !player.hand || player.hand.length !== 1) return false;
    const c = player.hand[0];
    return table.some(m => addOptions(m, c).some(o => !o.back));
  }

  /* ---------- Partida ---------- */

  function newGame(names) {
    const st = {
      players: names.map(n => ({ name: n, phase: 1, score: 0, hand: [], bajado: false })),
      round: 1, starter: 0, turn: 0, stage: 'draw',
      deck: [], discard: [], table: [], nextMeldId: 1,
      finalLap: null, status: 'playing', roundResult: null, winner: null, log: []
    };
    startRound(st);
    return st;
  }

  function log(st, msg) {
    st.log.push(msg);
    if (st.log.length > 40) st.log.shift();
  }

  function startRound(st) {
    st.deck = buildDeck();
    st.table = [];
    st.players.forEach(p => { p.hand = []; p.bajado = false; });
    for (let k = 0; k < HAND_SIZE; k++) st.players.forEach(p => p.hand.push(st.deck.pop()));
    st.discard = [st.deck.pop()];
    st.turn = st.starter;
    st.stage = 'draw';
    st.finalLap = null;
    st.status = 'playing';
    st.roundResult = null;
    log(st, 'Ronda ' + st.round + ': empieza ' + st.players[st.turn].name + '.');
  }

  function endRound(st, info) {
    const rows = st.players.map(p => {
      const pts = p.hand.reduce((a, c) => a + points(c), 0);
      p.score += pts;
      return { name: p.name, pts, total: p.score, bajado: p.bajado, phase: p.phase, left: p.hand.length };
    });
    let winner = null;
    if (info.winner != null) winner = info.winner;
    else {
      const cands = st.players.map((p, i) => i).filter(i => st.players[i].bajado && st.players[i].phase === PHASES.length);
      if (cands.length) {
        cands.sort((a, b) => (st.players[a].score - st.players[b].score) ||
          (a === info.out ? -1 : b === info.out ? 1 : 0));
        winner = cands[0];
      }
    }
    st.players.forEach((p, i) => { if (p.bajado) p.phase++; rows[i].next = p.phase; });
    st.roundResult = {
      rows, round: st.round,
      out: info.out != null ? info.out : null,
      clean: !!info.clean, reason: info.reason || null
    };
    st.winner = winner;
    st.finalLap = null;
    st.status = winner != null ? 'gameOver' : 'roundEnd';
    if (winner != null) log(st, st.players[winner].name + ' gana la partida.');
  }

  function advanceTurn(st) {
    if (st.finalLap) {
      st.finalLap.queue.shift();
      if (!st.finalLap.queue.length) return endRound(st, { out: st.finalLap.by, clean: false });
      st.turn = st.finalLap.queue[0];
    } else {
      st.turn = (st.turn + 1) % st.players.length;
    }
    st.stage = 'draw';
  }

  // Después de bajar cartas: si te quedaste sin cartas sin botar, te fuiste sucio.
  function afterPlay(st, pi) {
    const p = st.players[pi];
    if (p.hand.length > 0) return;
    if (!st.finalLap) {
      const n = st.players.length, queue = [];
      for (let k = 1; k < n; k++) queue.push((pi + k) % n);
      st.finalLap = { by: pi, queue };
      st.turn = queue[0];
      st.stage = 'draw';
      log(st, p.name + ' se fue sucio. Todos los demás juegan un turno más.');
    } else {
      log(st, p.name + ' también se quedó sin cartas.');
      advanceTurn(st);
    }
  }

  function takeCards(hand, ids) {
    const out = [];
    for (const id of ids) {
      const c = hand.find(x => x.id === id);
      if (!c || out.indexOf(c) >= 0) return null;
      out.push(c);
    }
    return out;
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
    if (st.status !== 'playing') return err('La ronda ya terminó.');
    if (pi !== st.turn) return err('No es tu turno.');
    const p = st.players[pi];

    if (a.t === 'draw') {
      if (st.stage !== 'draw') return err('Ya robaste en este turno.');
      if (a.from === 'discard') {
        if (!st.discard.length) return err('El descarte está vacío.');
        const c = st.discard.pop();
        p.hand.push(c);
        log(st, p.name + ' robó ' + cardText(c) + ' del descarte.');
      } else {
        if (!st.deck.length) {
          const top = st.discard.pop();
          st.deck = shuffle(st.discard);
          st.discard = top ? [top] : [];
          if (st.deck.length) log(st, 'Se acabó el mazo: se barajó el descarte.');
        }
        if (!st.deck.length) {
          log(st, 'No quedan cartas para robar. Se cierra la ronda.');
          endRound(st, { reason: 'sin-cartas' });
          return OK;
        }
        p.hand.push(st.deck.pop());
        log(st, p.name + ' robó del mazo.');
      }
      st.stage = 'play';
      return OK;
    }

    if (st.stage !== 'play') return err('Primero tienes que robar una carta.');

    if (a.t === 'bajar') {
      if (p.bajado) return err('Ya te bajaste en esta ronda.');
      if (!Array.isArray(a.melds)) return err('Jugada inválida.');
      const all = [];
      const melds = [];
      for (const m of a.melds) {
        const cards = takeCards(p.hand, m.ids || []);
        if (!cards || cards.some(c => all.indexOf(c) >= 0)) return err('Cartas inválidas.');
        cards.forEach(c => all.push(c));
        const opts = meldOptions(cards);
        const pick = opts[m.v || 0];
        if (!pick) return err('Uno de los juegos no es válido.');
        melds.push(pick);
      }
      if (!matchPhase(PHASES[p.phase - 1], melds)) return err('Eso no cumple tu juego: ' + phaseText(p.phase) + '.');
      p.hand = p.hand.filter(c => all.indexOf(c) < 0);
      melds.forEach(m => { m.id = st.nextMeldId++; m.owner = pi; st.table.push(m); });
      p.bajado = true;
      log(st, p.name + ' se bajó con el juego ' + p.phase + ' (' + phaseText(p.phase) + ').');
      if (p.phase === PHASES.length && !st.players.some((o, i) => i !== pi && o.phase === PHASES.length)) {
        endRound(st, { winner: pi, out: null });
        return OK;
      }
      afterPlay(st, pi);
      return OK;
    }

    if (a.t === 'meld') {
      if (!p.bajado) return err('Primero tienes que bajarte con tu juego.');
      const cards = takeCards(p.hand, a.ids || []);
      if (!cards) return err('Cartas inválidas.');
      const pick = meldOptions(cards)[a.v || 0];
      if (!pick) return err('Esas cartas no forman un grupo ni una escalera.');
      p.hand = p.hand.filter(c => cards.indexOf(c) < 0);
      pick.id = st.nextMeldId++;
      pick.owner = pi;
      st.table.push(pick);
      log(st, p.name + ' bajó: ' + meldLabel(pick) + '.');
      afterPlay(st, pi);
      return OK;
    }

    if (a.t === 'add') {
      if (!p.bajado) return err('Primero tienes que bajarte con tu juego.');
      const c = p.hand.find(x => x.id === a.id);
      const mi = st.table.findIndex(m => m.id === a.meldId);
      if (!c || mi < 0) return err('Jugada inválida.');
      const pick = addOptions(st.table[mi], c)[a.v || 0];
      if (!pick) return err('Esa carta no calza en ese juego.');
      st.table[mi] = pick.meld;
      p.hand = p.hand.filter(x => x !== c);
      if (pick.back) {
        p.hand.push(pick.back);
        log(st, p.name + ' cambió ' + cardText(c) + ' por un comodín de la mesa.');
      } else {
        log(st, p.name + ' agregó ' + cardText(c) + ' a un juego de la mesa.');
      }
      afterPlay(st, pi);
      return OK;
    }

    if (a.t === 'discard') {
      const c = p.hand.find(x => x.id === a.id);
      if (!c) return err('Carta inválida.');
      if (mustPlayLast(st.table, p)) return err('Tu última carta calza en la mesa: tienes que jugarla.');
      p.hand = p.hand.filter(x => x !== c);
      st.discard.push(c);
      log(st, p.name + ' botó ' + cardText(c) + '.');
      if (!p.hand.length) {
        log(st, p.name + ' se fue limpio. Se acaba la ronda.');
        endRound(st, { out: pi, clean: true });
        return OK;
      }
      advanceTurn(st);
      return OK;
    }

    return err('Acción desconocida.');
  }

  // Lo que puede ver un jugador: su mano, la mesa y solo el conteo de cartas de los demás.
  function viewFor(st, pi) {
    return {
      you: pi,
      players: st.players.map((p, i) => ({
        name: p.name, phase: p.phase, score: p.score, bajado: p.bajado,
        count: p.hand.length, hand: i === pi ? p.hand.map(plain) : null
      })),
      round: st.round, turn: st.turn, stage: st.stage,
      deckCount: st.deck.length,
      discardTop: st.discard.length ? plain(st.discard[st.discard.length - 1]) : null,
      discardCount: st.discard.length,
      table: JSON.parse(JSON.stringify(st.table)),
      finalLap: st.finalLap ? { by: st.finalLap.by } : null,
      status: st.status, roundResult: st.roundResult, winner: st.winner,
      log: st.log.slice(-6)
    };
  }

  root.Maldito = {
    SUITS, SUIT_SYM, PHASES, HAND_SIZE, MAX_PLAYERS,
    rankLabel, cardText, phaseText, points,
    evalGroup, runOptions, meldOptions, meldLabel, addOptions, matchPhase, mustPlayLast,
    newGame, act, viewFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
