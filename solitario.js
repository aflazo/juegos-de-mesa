/* Solitario (Klondike, se roba de a 1) — motor de reglas. Expone window.Solitario. */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const isRed = s => s === 'H' || s === 'D';

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Cartas: r va de 1 (As) a 13 (K).
  function newGame() {
    const deck = [];
    let id = 0;
    for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ id: id++, r, s, up: false });
    shuffle(deck);
    const tab = [];
    for (let i = 0; i < 7; i++) {
      const pile = [];
      for (let k = 0; k <= i; k++) pile.push(deck.pop());
      pile[pile.length - 1].up = true;
      tab.push(pile);
    }
    return { stock: deck, waste: [], found: [[], [], [], []], tab, moves: 0, won: false };
  }

  // Roba una carta; si el mazo está vacío, voltea el descarte para volver a pasarlo.
  function draw(st) {
    if (st.stock.length) {
      const c = st.stock.pop();
      c.up = true;
      st.waste.push(c);
    } else if (st.waste.length) {
      st.stock = st.waste.reverse();
      st.stock.forEach(c => { c.up = false; });
      st.waste = [];
    } else return false;
    st.moves++;
    return true;
  }

  const canFound = (st, c) => st.found[SUITS.indexOf(c.s)].length === c.r - 1;

  function canTab(pile, c) {
    if (!pile.length) return c.r === 13;
    const top = pile[pile.length - 1];
    return top.up && isRed(top.s) !== isRed(c.s) && top.r === c.r + 1;
  }

  function cardsAt(st, from) {
    if (from.t === 'w') return st.waste.length ? [st.waste[st.waste.length - 1]] : [];
    if (from.t === 'f') { const p = st.found[from.i]; return p && p.length ? [p[p.length - 1]] : []; }
    const pile = st.tab[from.i];
    if (!pile || from.k < 0 || from.k >= pile.length || !pile[from.k].up) return [];
    return pile.slice(from.k);
  }

  // from: {t:'w'} | {t:'f',i} | {t:'t',i,k}   to: {t:'f'} | {t:'t',i}
  function move(st, from, to) {
    const cards = cardsAt(st, from);
    if (!cards.length) return false;
    if (to.t === 'f') {
      if (cards.length !== 1 || from.t === 'f' || !canFound(st, cards[0])) return false;
    } else {
      if (from.t === 't' && from.i === to.i) return false;
      if (!canTab(st.tab[to.i], cards[0])) return false;
    }
    if (from.t === 'w') st.waste.pop();
    else if (from.t === 'f') st.found[from.i].pop();
    else {
      const pile = st.tab[from.i];
      pile.splice(from.k);
      if (pile.length) pile[pile.length - 1].up = true;
    }
    if (to.t === 'f') st.found[SUITS.indexOf(cards[0].s)].push(cards[0]);
    else cards.forEach(c => st.tab[to.i].push(c));
    st.moves++;
    st.won = st.found.every(p => p.length === 13);
    return true;
  }

  // Sube a las bases todo lo que se pueda.
  function autoFound(st) {
    let any = false, again = true;
    while (again) {
      again = false;
      if (move(st, { t: 'w' }, { t: 'f' })) { any = again = true; continue; }
      for (let i = 0; i < 7; i++) {
        const k = st.tab[i].length - 1;
        if (k >= 0 && move(st, { t: 't', i, k }, { t: 'f' })) { any = again = true; break; }
      }
    }
    return any;
  }

  root.Solitario = { SUITS, isRed, newGame, draw, move, autoFound, canFound, canTab, cardsAt };
})(typeof window !== 'undefined' ? window : globalThis);
