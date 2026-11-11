/* Ocho Locos — motor de reglas (sin interfaz). Expone window.OchoLocos. */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'espadas', H: 'corazones', D: 'diamantes', C: 'tréboles' };
  const rankLabel = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
  const cardText = c => rankLabel(c.r) + SUIT_SYM[c.s];
  const MAX_PLAYERS = 6;
  const TARGET = 100;

  const plain = c => ({ id: c.id, r: c.r, s: c.s });

  // Valor de las cartas que quedan en la mano al cerrar la ronda.
  function points(c) {
    if (c.r === 8) return 50;
    if (c.r === 14) return 1;
    if (c.r >= 11) return 10;
    return c.r;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildDeck(decks) {
    const d = [];
    let id = 0;
    for (let k = 0; k < decks; k++)
      for (const s of SUITS)
        for (let r = 2; r <= 14; r++) d.push({ id: id++, r, s });
    return shuffle(d);
  }

  // Se puede jugar un 8 siempre; si no, hay que coincidir en palo o en número.
  function canPlay(card, top, suit) {
    return card.r === 8 || card.s === suit || card.r === top.r;
  }

  function log(st, msg) {
    st.log.push(msg);
    if (st.log.length > 40) st.log.shift();
  }

  function newGame(names) {
    const st = {
      players: names.map(n => ({ name: n, hand: [], score: 0 })),
      round: 1, starter: 0, turn: 0, drew: false, stuck: 0,
      deck: [], discard: [], suit: null,
      status: 'playing', roundResult: null, winner: null, log: []
    };
    startRound(st);
    return st;
  }

  function startRound(st) {
    const n = st.players.length;
    st.deck = buildDeck(n > 4 ? 2 : 1);
    const size = n === 2 ? 7 : 5;
    st.players.forEach(p => { p.hand = []; });
    for (let k = 0; k < size; k++) st.players.forEach(p => p.hand.push(st.deck.pop()));
    let first = st.deck.pop();
    while (first.r === 8) { st.deck.unshift(first); first = st.deck.pop(); } // no se empieza con un 8
    st.discard = [first];
    st.suit = first.s;
    st.turn = st.starter;
    st.drew = false;
    st.stuck = 0;
    st.status = 'playing';
    st.roundResult = null;
    log(st, 'Ronda ' + st.round + ': empieza ' + st.players[st.turn].name + '.');
  }

  function refill(st) {
    if (st.deck.length || st.discard.length <= 1) return;
    const top = st.discard.pop();
    st.deck = shuffle(st.discard);
    st.discard = [top];
    log(st, 'Se acabó el mazo: se barajó el descarte.');
  }

  function advance(st) {
    st.turn = (st.turn + 1) % st.players.length;
    st.drew = false;
  }

  function endRound(st, winner, blocked) {
    const pts = st.players.map(p => p.hand.reduce((a, c) => a + points(c), 0));
    if (blocked) {
      winner = 0;
      pts.forEach((v, i) => { if (v < pts[winner]) winner = i; });
    }
    let gain = 0;
    pts.forEach((v, i) => { if (i !== winner) gain += v; });
    if (blocked) gain = Math.max(0, gain - pts[winner]);
    st.players[winner].score += gain;
    st.roundResult = {
      round: st.round, winner, blocked: !!blocked, gain,
      rows: st.players.map((p, i) => ({ name: p.name, left: p.hand.length, pts: pts[i], total: p.score }))
    };
    if (st.players[winner].score >= TARGET) {
      st.winner = winner;
      st.status = 'gameOver';
      log(st, st.players[winner].name + ' gana la partida.');
    } else {
      st.status = 'roundEnd';
    }
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
    const top = st.discard[st.discard.length - 1];

    if (a.t === 'play') {
      const c = p.hand.find(x => x.id === a.id);
      if (!c) return err('Carta inválida.');
      if (!canPlay(c, top, st.suit)) return err('Esa carta no coincide en palo ni en número.');
      if (c.r === 8 && SUITS.indexOf(a.suit) < 0) return err('Elige el palo que pides.');
      p.hand = p.hand.filter(x => x !== c);
      st.discard.push(c);
      st.suit = c.r === 8 ? a.suit : c.s;
      st.stuck = 0;
      log(st, p.name + ' jugó ' + cardText(c) + (c.r === 8 ? ' y pidió ' + SUIT_NAME[a.suit] + '.' : '.'));
      if (!p.hand.length) {
        log(st, p.name + ' se quedó sin cartas.');
        endRound(st, pi, false);
        return OK;
      }
      advance(st);
      return OK;
    }

    if (a.t === 'draw') {
      if (st.drew) return err('Ya robaste: juega una carta o pasa.');
      refill(st);
      if (!st.deck.length) return err('No quedan cartas para robar: pasa el turno.');
      p.hand.push(st.deck.pop());
      st.drew = true;
      log(st, p.name + ' robó una carta.');
      return OK;
    }

    if (a.t === 'pass') {
      const canDraw = st.deck.length > 0 || st.discard.length > 1;
      if (!st.drew && canDraw) return err('Antes de pasar tienes que robar una carta.');
      log(st, p.name + ' pasó.');
      st.stuck++;
      if (st.stuck >= st.players.length && !canDraw) {
        log(st, 'Nadie puede jugar. Se cierra la ronda.');
        endRound(st, null, true);
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
        name: p.name, score: p.score, count: p.hand.length,
        hand: i === pi ? p.hand.map(plain) : null
      })),
      round: st.round, turn: st.turn, drew: st.drew,
      deckCount: st.deck.length,
      canDrawMore: st.deck.length > 0 || st.discard.length > 1,
      top: plain(st.discard[st.discard.length - 1]),
      suit: st.suit, target: TARGET,
      status: st.status, roundResult: st.roundResult, winner: st.winner,
      log: st.log.slice(-6)
    };
  }

  root.OchoLocos = {
    SUITS, SUIT_SYM, SUIT_NAME, MAX_PLAYERS, TARGET,
    rankLabel, cardText, points, canPlay, newGame, act, viewFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
