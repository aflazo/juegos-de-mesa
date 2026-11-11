/* El Maldito — interfaz, modo en la misma pantalla y modo en línea (PeerJS, el anfitrión manda). */
(function () {
  'use strict';

  const GAMES = { maldito: window.Maldito, ocho: window.OchoLocos };
  const NAMES = { maldito: 'El Maldito', ocho: 'Ocho Locos', sol: 'Solitario' };
  const CARD = window.Maldito;       // utilidades de cartas compartidas
  const S = window.Solitario;
  const SOLSAVE = 'solitario-save';
  let gameId = 'maldito';            // juego de la partida en curso
  let M = GAMES.maldito;             // motor del juego en curso
  function setGame(id) { gameId = GAMES[id] ? id : 'maldito'; M = GAMES[gameId]; }
  let homeGame = 'maldito';          // juego elegido en el inicio
  const homeVals = { name: null, code: null, names: null };
  const sol = { st: null, sel: null, undo: [] };
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const PREFIX = 'maldito-mvp1-';
  const SAVE = 'maldito-save';
  const CLIENT = 'maldito-client';

  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let mode = null;            // null | 'local' | 'host' | 'client'
  let view = null;            // lo que ve este jugador
  let lobby = null;           // sala de espera (cliente)
  let sel = new Set();        // cartas seleccionadas
  let staged = [];            // juegos armados antes de bajarse
  let sortMode = 'rank';
  let turnKey = '';
  const ui = { chooser: null, help: false, cover: false, status: '' };
  const net = { peer: null, conn: null, code: null, seats: [], state: null, ready: false, connected: false, retry: null, tries: 0 };
  const local = { state: null };

  /* ---------- utilidades ---------- */
  function load(k, session) {
    try { return JSON.parse((session ? sessionStorage : localStorage).getItem(k)); } catch (e) { return null; }
  }
  function store(k, v, session) {
    try {
      const s = session ? sessionStorage : localStorage;
      if (v == null) s.removeItem(k); else s.setItem(k, JSON.stringify(v));
    } catch (e) { /* sin almacenamiento: se juega igual */ }
  }
  function token() {
    let t = load('maldito-token', true);
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); store('maldito-token', t, true); }
    return t;
  }
  function newCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let c = '';
    for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  }
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }
  function pick(labels, title, cb) {
    if (labels.length === 1) return cb(0);
    ui.chooser = { title, labels, cb };
    render();
  }

  /* ---------- estado y envío de jugadas ---------- */
  function refresh() {
    if (mode === 'local') {
      store(SAVE, { mode: 'local', game: gameId, state: local.state });
      view = M.viewFor(local.state, local.state.turn);
    } else if (mode === 'host') {
      store(SAVE, { mode: 'host', game: gameId, code: net.code, seats: net.seats.map(s => ({ name: s.name, token: s.token })), state: net.state });
      const on = net.seats.map((s, i) => i === 0 || !!(s.conn && s.conn.open));
      net.seats.forEach((s, i) => {
        if (i === 0 || !s.conn || !s.conn.open) return;
        if (net.state) {
          const v = M.viewFor(net.state, i);
          v.conn = on;
          s.conn.send({ t: 'state', game: gameId, view: v });
        } else {
          s.conn.send({ t: 'lobby', game: gameId, you: i, players: net.seats.map((x, j) => ({ name: x.name, on: on[j] })) });
        }
      });
      if (net.state) { view = M.viewFor(net.state, 0); view.conn = on; }
    }
    render();
  }

  function send(a) {
    if (mode === 'client') {
      if (net.conn && net.conn.open) net.conn.send({ t: 'act', a });
      else toast('Sin conexión con el anfitrión. Reintentando…');
      return;
    }
    const st = mode === 'local' ? local.state : net.state;
    const pi = mode === 'local' ? st.turn : 0;
    const prevTurn = st.turn, prevStatus = st.status;
    const res = M.act(st, pi, a);
    if (res.error) return toast(res.error);
    if (mode === 'local' && st.status === 'playing' && (st.turn !== prevTurn || prevStatus !== 'playing')) ui.cover = true;
    refresh();
  }

  /* ---------- red: anfitrión ---------- */
  function hostStart(code, resume) {
    if (typeof Peer === 'undefined') return toast('No se pudo cargar el modo en línea. Revisa tu conexión a internet.');
    mode = 'host';
    net.code = code;
    net.ready = false;
    const peer = new Peer(PREFIX + code);
    net.peer = peer;
    peer.on('open', () => { net.ready = true; net.tries = 0; refresh(); });
    peer.on('connection', conn => {
      conn.on('data', d => hostOnData(conn, d));
      conn.on('close', () => hostOnClose(conn));
      conn.on('error', () => hostOnClose(conn));
    });
    peer.on('disconnected', () => {
      setTimeout(() => { if (net.peer === peer && !peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', e => {
      if (net.peer !== peer) return;
      if (e.type === 'unavailable-id') {
        peer.destroy();
        if (!resume) return hostStart(newCode(), false);
        if (net.tries++ < 8) setTimeout(() => { if (mode === 'host' && net.peer === peer) hostStart(code, true); }, 2000);
        else toast('No pude reabrir la sala ' + code + '.');
      }
    });
    render();
  }

  function hostOnData(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') {
      let i = net.seats.findIndex(s => s.token === d.token);
      if (i < 0) {
        if (net.state) return conn.send({ t: 'err', fatal: true, msg: 'Esa partida ya empezó.' });
        if (net.seats.length >= M.MAX_PLAYERS) return conn.send({ t: 'err', fatal: true, msg: 'La sala está llena.' });
        let name = String(d.name || 'Jugador').trim().slice(0, 16) || 'Jugador';
        let n = 2;
        const base = name;
        while (net.seats.some(s => s.name === name)) name = base + ' ' + n++;
        net.seats.push({ name, token: String(d.token), conn: null });
        i = net.seats.length - 1;
      }
      const old = net.seats[i].conn;
      net.seats[i].conn = conn;
      if (old && old !== conn) { try { old.close(); } catch (e) { /* ya cerrada */ } }
      refresh();
    } else if (d.t === 'act') {
      const i = net.seats.findIndex(s => s.conn === conn);
      if (i < 1 || !net.state) return;
      const a = d.a || {};
      if (a.t === 'next') return conn.send({ t: 'err', msg: 'Solo el anfitrión empieza la siguiente ronda.' });
      const res = M.act(net.state, i, a);
      if (res.error) conn.send({ t: 'err', msg: res.error });
      refresh();
    }
  }

  function hostOnClose(conn) {
    const s = net.seats.find(x => x.conn === conn);
    if (!s) return;
    s.conn = null;
    if (mode === 'host') refresh();
  }

  /* ---------- red: invitado ---------- */
  function clientStart(code, name) {
    if (typeof Peer === 'undefined') return toast('No se pudo cargar el modo en línea. Revisa tu conexión a internet.');
    mode = 'client';
    net.code = code;
    net.connected = false;
    view = null;
    lobby = null;
    ui.status = 'Conectando con la sala ' + code + '…';
    store(CLIENT, { code, name }, true);
    const peer = new Peer();
    net.peer = peer;

    const schedule = ms => {
      clearTimeout(net.retry);
      net.retry = setTimeout(() => {
        if (mode === 'client' && net.peer === peer && !net.connected) connect();
      }, ms);
    };
    const connect = () => {
      if (net.peer !== peer || peer.destroyed) return;
      if (peer.disconnected) { peer.reconnect(); return schedule(2500); }
      const conn = peer.connect(PREFIX + code, { reliable: true });
      net.conn = conn;
      conn.on('open', () => {
        if (net.conn !== conn) return conn.close();
        net.connected = true;
        ui.status = '';
        conn.send({ t: 'hello', name, token: token() });
        render();
      });
      conn.on('data', clientOnData);
      conn.on('close', () => {
        if (net.conn !== conn || mode !== 'client') return;
        net.connected = false;
        ui.status = 'Se perdió la conexión. Reconectando…';
        render();
        schedule(2000);
      });
      schedule(7000);
    };
    peer.on('open', connect);
    peer.on('error', e => {
      if (net.peer !== peer) return;
      if (e.type === 'peer-unavailable') ui.status = 'No encuentro la sala ' + code + '. Reintentando…';
      render();
      schedule(2500);
    });
    peer.on('disconnected', () => schedule(2000));
    render();
  }

  function clientOnData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'lobby') { setGame(d.game); lobby = d; view = null; render(); }
    else if (d.t === 'state') { setGame(d.game); view = d.view; lobby = null; render(); }
    else if (d.t === 'err') {
      toast(d.msg || 'Error');
      if (d.fatal) leave();
    }
  }

  function leave() {
    if (mode === 'sol') { mode = null; sol.sel = null; ui.help = false; return render(); }
    clearTimeout(net.retry);
    if (net.peer) { try { net.peer.destroy(); } catch (e) { /* nada */ } }
    if (mode === 'client') store(CLIENT, null, true); else store(SAVE, null);
    net.peer = null; net.conn = null; net.code = null; net.seats = []; net.state = null;
    net.ready = false; net.connected = false; net.tries = 0;
    local.state = null;
    mode = null; view = null; lobby = null;
    sel = new Set(); staged = [];
    ui.chooser = null; ui.help = false; ui.cover = false; ui.status = '';
    render();
  }

  /* ---------- dibujo ---------- */
  function cardHTML(c, o) {
    o = o || {};
    const red = c.s === 'H' || c.s === 'D';
    const wild = c.r === 2 && mode !== 'sol' && gameId === 'maldito';
    return '<div class="card' + (red ? ' red' : '') + (wild ? ' wildc' : '') + (o.sel ? ' sel' : '') + (o.cls ? ' ' + o.cls : '') + '" ' + (o.attr || '') + '>' +
      '<span class="r">' + (c.r === 1 ? 'A' : CARD.rankLabel(c.r)) + '</span><span class="s">' + CARD.SUIT_SYM[c.s] + '</span>' +
      (o.tag ? '<span class="tag">' + o.tag + '</span>' : '') + '</div>';
  }

  function meldHTML(m, attr, cls, extra) {
    const cap = m.type === 'G' ? 'Grupo de ' + M.rankLabel(m.rank) : 'Escalera ' + M.SUIT_SYM[m.suit];
    return '<div class="meld ' + (cls || '') + '" ' + (attr || '') + '><div class="cap">' + cap + (extra || '') + '</div><div class="cards">' +
      m.cards.map(c => cardHTML(c, { tag: c.wild ? '=' + M.rankLabel(c.as) : '' })).join('') + '</div></div>';
  }

  function sortHand(cards) {
    const so = { S: 0, H: 1, C: 2, D: 3 };
    return cards.slice().sort((a, b) => sortMode === 'rank'
      ? (a.r - b.r) || (so[a.s] - so[b.s])
      : (so[a.s] - so[b.s]) || (a.r - b.r));
  }

  function render() {
    if (!mode) return renderHome();
    if (mode === 'sol') return renderSol();
    if (mode === 'host' && !net.state) return renderLobby();
    if (mode === 'client' && !view) return lobby ? renderLobby() : renderWaiting();
    if (!view) return;
    if (gameId === 'ocho') renderOcho(); else renderGame();
  }

  function renderHome() {
    const save = load(SAVE), cl = load(CLIENT, true), solSave = load(SOLSAVE);
    const sala = homeVals.code != null ? homeVals.code : (new URLSearchParams(location.search).get('sala') || '').toUpperCase().slice(0, 4);
    const name = homeVals.name != null ? homeVals.name : (load('maldito-name') || '');
    const gcard = (id, desc) => '<div class="game' + (homeGame === id ? ' on' : '') + '" data-act="pickgame" data-g="' + id + '"><b>' +
      NAMES[id] + '</b><span>' + desc + '</span></div>';
    let resume = '';
    if (save && save.state) {
      resume += '<div class="box"><h2>Tienes una partida guardada de ' + NAMES[GAMES[save.game] ? save.game : 'maldito'] + '</h2><p>' +
        (save.mode === 'host' ? 'Sala ' + esc(save.code) + ' (eres el anfitrión)' : 'En esta misma pantalla') + ' · ' +
        save.state.players.map(p => esc(p.name)).join(', ') + '</p>' +
        '<div class="row"><button class="primary" data-act="resume">Continuar</button><button class="ghost" data-act="dropsave">Descartar</button></div></div>';
    }
    if (cl && cl.code) {
      resume += '<div class="box"><h2>Estabas en la sala ' + esc(cl.code) + '</h2>' +
        '<div class="row"><button class="primary" data-act="rejoin">Volver a la sala</button><button class="ghost" data-act="dropclient">Olvidar</button></div></div>';
    }
    app.innerHTML =
      '<div class="home">' +
      '<h1>Juegos de Mesa</h1><p>Elige un juego y arma la mesa.</p>' +
      '<div class="games">' +
      gcard('maldito', '2 a 6 jugadores · 10 juegos · el 2 es comodín') +
      gcard('ocho', '2 a 6 jugadores · el 8 es comodín · a 100 puntos') +
      gcard('sol', '1 jugador · Klondike clásico') + '</div>' +
      resume +
      (homeGame === 'sol'
        ? '<div class="box"><h2>Solitario</h2><p>Ordena las cuatro bases del As al Rey. Se juega solo, en esta pantalla.</p>' +
          (solSave && !solSave.won ? '<button class="primary" data-act="solresume">Continuar mi partida</button>' : '') +
          '<button' + (solSave && !solSave.won ? '' : ' class="primary"') + ' data-act="solnew">Nueva partida</button></div>'
        : multiHTML(name, sala)) +
      '<button class="ghost" data-act="help">Ver reglas de ' + NAMES[homeGame] + '</button>' +
      '</div>' + overlays();
  }

  function multiHTML(name, sala) {
    return '<div class="box"><h2>' + NAMES[homeGame] + ': jugar en línea</h2>' +
      '<input id="name" maxlength="16" placeholder="Tu nombre" value="' + esc(name) + '">' +
      '<button class="primary" data-act="create">Crear una sala</button>' +
      '<div class="row"><input id="code" maxlength="4" placeholder="Código de sala" value="' + esc(sala) + '" style="text-transform:uppercase">' +
      '<button data-act="join">Unirme</button></div>' +
      '<p>Cada jugador entra desde su propio teléfono o computadora y solo ve sus cartas.</p></div>' +
      '<div class="box"><h2>' + NAMES[homeGame] + ': en esta misma pantalla</h2>' +
      '<input id="names" placeholder="Nombres separados por coma (ej. Ana, Luis, Marta)" value="' + esc(homeVals.names || '') + '">' +
      '<button data-act="local">Empezar</button>' +
      '<p>Se van pasando el dispositivo; la mano se oculta entre turnos.</p></div>';
  }

  function renderWaiting() {
    app.innerHTML = '<div class="cover"><h1>Sala ' + esc(net.code) + '</h1><p>' + esc(ui.status || 'Conectando…') + '</p>' +
      '<button class="ghost" data-act="leave">Cancelar</button></div>';
  }

  function renderLobby() {
    const isHost = mode === 'host';
    const players = isHost
      ? net.seats.map((s, i) => ({ name: s.name, on: i === 0 || !!(s.conn && s.conn.open) }))
      : lobby.players;
    const you = isHost ? 0 : lobby.you;
    const link = location.origin + location.pathname + '?sala=' + net.code;
    app.innerHTML =
      '<div class="home"><h1>' + NAMES[gameId] + '</h1>' +
      '<div class="box"><h2>Código de la sala</h2><div class="code">' + esc(net.code) + '</div>' +
      (isHost
        ? (net.ready
          ? '<p>Comparte este código o el enlace con los demás jugadores.</p><div class="linkbox">' + esc(link) + '</div>' +
            '<button class="small ghost" data-act="copy">Copiar enlace</button>'
          : '<p>Abriendo la sala…</p>')
        : '<p>' + esc(ui.status || 'Esperando a que el anfitrión empiece la partida…') + '</p>') +
      '</div>' +
      '<div class="box"><h2>Jugadores (' + players.length + ')</h2><ul class="plist">' +
      players.map((p, i) => '<li><span>' + esc(p.name) + (i === you ? ' (tú)' : '') + (i === 0 ? ' · anfitrión' : '') + '</span>' +
        (p.on ? '<span>listo</span>' : '<span class="badge off">sin conexión</span>') + '</li>').join('') +
      '</ul>' +
      (isHost ? '<button class="primary" data-act="start"' + (players.length < 2 ? ' disabled' : '') + '>Empezar partida</button>' +
        (players.length < 2 ? '<p>Hacen falta al menos 2 jugadores.</p>' : '') : '') +
      '</div><button class="ghost" data-act="leave">Salir</button></div>' + overlays();
  }

  function renderCover() {
    const p = view.players[view.turn];
    app.innerHTML = '<div class="cover"><p>Pásale el dispositivo a</p><h1>' + esc(p.name) + '</h1>' +
      (gameId === 'maldito' ? '<p>Juego ' + p.phase + ': ' + M.phaseText(p.phase) + '</p>' : '<p>' + NAMES[gameId] + '</p>') +
      '<button class="primary" data-act="uncover">Ver mis cartas</button></div>';
  }

  function syncSel(me, canPlay) {
    const key = view.round + ':' + view.turn + ':' + view.status;
    if (key !== turnKey) { turnKey = key; sel = new Set(); staged = []; }
    const ids = new Set(me.hand.map(c => c.id));
    sel.forEach(id => { if (!ids.has(id)) sel.delete(id); });
    if (!canPlay || me.bajado) staged = [];
    staged = staged.filter(s => s.ids.every(id => ids.has(id)));
  }

  function renderGame() {
    const v = view;
    const me = v.players[v.you];
    const playing = v.status === 'playing';
    if (mode === 'local' && ui.cover && playing) return renderCover();
    const myTurn = playing && v.turn === v.you;
    const canDraw = myTurn && v.stage === 'draw';
    const canPlay = myTurn && v.stage === 'play';
    syncSel(me, canPlay);
    const stagedIds = new Set();
    staged.forEach(s => s.ids.forEach(id => stagedIds.add(id)));
    const hand = sortHand(me.hand.filter(c => !stagedIds.has(c.id)));
    const forced = canPlay && M.mustPlayLast(v.table, me);
    const stagedOk = staged.length > 0 && me.phase <= M.PHASES.length && M.matchPhase(M.PHASES[me.phase - 1], staged.map(s => s.meld));
    const turnName = v.players[v.turn].name;
    const who = mode === 'local' ? esc(me.name) + ': ' : 'Tu turno: ';

    let msg;
    if (!playing) msg = 'Ronda terminada.';
    else if (canDraw) msg = who + 'roba una carta del mazo o del descarte.';
    else if (canPlay) msg = who + (me.bajado
      ? 'baja juegos, agrega cartas a la mesa y bota una para terminar.'
      : 'arma tu juego y bájate, o bota una carta para terminar.');
    else msg = 'Turno de ' + esc(turnName) + '.';
    if (playing && v.finalLap) msg = '⚠️ ' + esc(v.players[v.finalLap.by].name) + ' se fue sucio: última vuelta. ' + msg;

    const top =
      '<div class="top">' + (net.code ? 'Sala <b>' + esc(net.code) + '</b> ·' : '') + ' Ronda <b>' + v.round + '</b> · ' +
      'Tu juego: <b>' + (me.phase > M.PHASES.length ? '✔' : me.phase + ' — ' + M.phaseText(me.phase)) + '</b>' +
      (mode === 'client' && !net.connected ? ' · <span class="badge off">' + esc(ui.status || 'sin conexión') + '</span>' : '') +
      '<span class="sp"></span><button class="small ghost" data-act="help">Reglas</button>' +
      '<button class="small ghost" data-act="leave">Salir</button></div>';

    const players = '<div class="players">' + v.players.map((p, i) =>
      '<div class="pchip' + (playing && v.turn === i ? ' turn' : '') + '"><div class="n"><span>' + esc(p.name) +
      (i === v.you && mode !== 'local' ? ' (tú)' : '') + '</span><span>' + p.score + ' pts</span></div>' +
      '<div class="m">Juego ' + (p.phase > M.PHASES.length ? '✔' : p.phase) + ' · ' + p.count + ' cartas ' +
      (p.bajado ? '<span class="badge">se bajó</span> ' : '') +
      (v.conn && !v.conn[i] ? '<span class="badge off">sin conexión</span>' : '') + '</div></div>').join('') + '</div>';

    const banner = '<div class="banner' + (myTurn ? ' mine' : '') + '"><div class="msg">' + msg + '</div>' +
      '<div class="log">' + esc(v.log.slice(-2).join(' ')) + '</div></div>';

    const center = '<div class="center">' +
      '<div class="pile' + (canDraw ? ' can' : '') + '"' + (canDraw ? ' data-act="draw" data-from="deck"' : '') + '>' +
      (v.deckCount || v.discardCount > 1 ? '<div class="back"></div>' : '<div class="empty"></div>') +
      '<div class="lbl">Mazo (' + v.deckCount + ')</div></div>' +
      '<div class="pile' + (canDraw && v.discardTop ? ' can' : '') + '"' + (canDraw && v.discardTop ? ' data-act="draw" data-from="discard"' : '') + '>' +
      (v.discardTop ? cardHTML(v.discardTop) : '<div class="empty"></div>') +
      '<div class="lbl">Descarte</div></div></div>';

    const canAdd = canPlay && me.bajado && sel.size === 1;
    const table = '<div class="table-area"><div class="section-title">Mesa</div>' +
      (v.table.length
        ? '<div class="melds">' + v.table.map(m => meldHTML(m, 'data-act="meld" data-id="' + m.id + '"', canAdd ? 'can' : '')).join('') + '</div>'
        : '<div class="nothing">Todavía nadie se ha bajado.</div>') + '</div>';

    let staging = '';
    if (canPlay && !me.bajado) {
      staging = '<div class="staging"><div class="section-title">Tu bajada — juego ' + me.phase + ': ' + M.phaseText(me.phase) + '</div>' +
        (staged.length
          ? '<div class="melds">' + staged.map((s, i) => meldHTML(s.meld, '', '',
              ' <button class="small ghost" data-act="unstage" data-i="' + i + '">quitar</button>')).join('') + '</div>'
          : '<div class="nothing">Selecciona las cartas de un trío, cuarteto o escalera y toca «Armar juego». Cuando tengas todo lo que pide tu juego, toca «Bajarme».</div>') +
        '</div>';
    }

    let actions = '';
    if (canPlay) {
      actions += '<button data-act="armar"' + (sel.size >= 3 ? '' : ' disabled') + '>' + (me.bajado ? 'Bajar juego' : 'Armar juego') + '</button>';
      if (!me.bajado) actions += '<button class="primary" data-act="bajar"' + (stagedOk ? '' : ' disabled') + '>Bajarme</button>';
      actions += '<button class="primary" data-act="discard"' + (sel.size === 1 && !forced ? '' : ' disabled') + '>Botar</button>';
    }
    actions += '<button class="ghost" data-act="sort">Ordenar por ' + (sortMode === 'rank' ? 'palo' : 'número') + '</button>';
    let hint = '';
    if (forced) hint = 'Tu última carta calza en la mesa: tienes que jugarla (te vas sucio).';
    else if (canPlay && me.bajado) hint = 'Para agregar a un juego de la mesa, selecciona 1 carta y toca el juego.';
    else if (canDraw) hint = 'Toca el mazo o el descarte para robar.';

    const dock = '<div class="dock"><div class="dock-in"><div class="hand">' +
      (hand.length ? hand.map(c => cardHTML(c, { sel: sel.has(c.id), attr: 'data-act="card" data-id="' + c.id + '"' })).join('')
        : '<div class="nothing">Sin cartas en la mano.</div>') +
      '</div><div class="actions">' + actions + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div></div>';

    app.innerHTML = '<div class="game-screen">' + top + players + banner + center + table + staging + '</div>' + dock + overlays();
  }

  function overlays() {
    let h = '';
    if (view && mode && mode !== 'sol' && (view.status === 'roundEnd' || view.status === 'gameOver')) {
      h += gameId === 'ocho' ? ochoResultHTML() : resultHTML();
    }
    if (ui.help) h += ui.help === 'ocho' ? ochoHelpHTML() : ui.help === 'sol' ? solHelpHTML() : helpHTML();
    if (ui.chooser) {
      h += '<div class="overlay" data-act="close"><div class="modal"><h2>' + esc(ui.chooser.title) + '</h2><div class="opts">' +
        ui.chooser.labels.map((l, i) => '<button data-act="choose" data-i="' + i + '">' + esc(l) + '</button>').join('') +
        '</div><button class="ghost" data-act="closebtn">Cancelar</button></div></div>';
    }
    return h;
  }

  function resultHTML() {
    const v = view, rr = v.roundResult, over = v.status === 'gameOver';
    let sub = '';
    if (rr.out != null) sub = esc(rr.rows[rr.out].name) + (rr.clean ? ' se fue limpio.' : ' se fue sucio.');
    else if (rr.reason === 'sin-cartas') sub = 'Se acabaron las cartas para robar.';
    else if (over) sub = esc(rr.rows[v.winner].name) + ' se bajó con el juego 10 y nadie más estaba en ese juego.';
    const rows = rr.rows.map((r, i) => '<tr' + (over && i === v.winner ? ' class="win"' : '') + '><td>' + esc(r.name) + '</td><td>' + (r.bajado ? 'Sí' : 'No') +
      '</td><td class="num">+' + r.pts + '</td><td class="num">' + r.total + '</td><td>' +
      (r.next > M.PHASES.length ? '✔ completó' : 'Juego ' + r.next + (r.bajado ? '' : ' (repite)')) + '</td></tr>').join('');
    let btn;
    if (over) btn = '<button class="primary" data-act="home">Volver al inicio</button>';
    else if (mode === 'client') btn = '<p>Esperando a que el anfitrión empiece la siguiente ronda…</p>';
    else btn = '<button class="primary" data-act="next">Siguiente ronda</button>';
    return '<div class="overlay"><div class="modal"><h2>' +
      (over ? '🏆 Ganó ' + esc(rr.rows[v.winner].name) : 'Fin de la ronda ' + rr.round) + '</h2><p>' + sub + '</p>' +
      '<table><tr><th>Jugador</th><th>Se bajó</th><th class="num">Puntos</th><th class="num">Total</th><th>Sigue en</th></tr>' + rows + '</table>' +
      btn + '</div></div>';
  }

  function helpHTML() {
    return '<div class="overlay" data-act="close"><div class="modal"><h2>El Maldito</h2>' +
      '<table><tr><th>Juego</th><th>Qué hay que bajar</th></tr>' +
      CARD.PHASES.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + CARD.phaseText(i + 1) + '</td></tr>').join('') + '</table>' +
      '<p><b>Turno:</b> robas (mazo o descarte), juegas si puedes y siempre botas una carta.</p>' +
      '<p><b>Comodín:</b> el 2. Nunca más comodines que cartas en un juego, y en escaleras no van dos comodines juntos. ' +
      'Si tienes la carta que reemplaza a un comodín de una escalera, lo cambias y te lo llevas.</p>' +
      '<p><b>Escaleras:</b> mismo palo, mínimo 4 cartas, el As es la carta más alta.</p>' +
      '<p><b>Después de bajarte</b> puedes bajar más juegos y agregar cartas a cualquier juego de la mesa.</p>' +
      '<p><b>Limpio:</b> botas tu última carta y se acaba la ronda. <b>Sucio:</b> te quedas sin cartas sin botar y los demás juegan un turno más.</p>' +
      '<p><b>Puntos</b> (por carta que te queda en la mano): 3 al 9 = 5 · 10, J, Q, K = 10 · As = 20 · 2 = 25. Gana quien completa el juego 10; si empatan, el de menos puntos.</p>' +
      '<button class="primary" data-act="closebtn">Entendido</button></div></div>';
  }

  /* ---------- Ocho Locos ---------- */
  function renderOcho() {
    const v = view;
    const me = v.players[v.you];
    const playing = v.status === 'playing';
    if (mode === 'local' && ui.cover && playing) return renderCover();
    const myTurn = playing && v.turn === v.you;
    const canDraw = myTurn && !v.drew && v.canDrawMore;
    const canPass = myTurn && (v.drew || !v.canDrawMore);
    const hand = sortHand(me.hand);
    const ok = c => M.canPlay(c, v.top, v.suit);
    const any = hand.some(ok);
    const who = mode === 'local' ? esc(me.name) + ': ' : 'Tu turno: ';
    const redSuit = v.suit === 'H' || v.suit === 'D';

    let msg;
    if (!playing) msg = 'Ronda terminada.';
    else if (!myTurn) msg = 'Turno de ' + esc(v.players[v.turn].name) + '.';
    else if (any) msg = who + 'juega una carta del mismo palo o número, o un 8.' + (canDraw ? ' También puedes robar.' : '');
    else if (canDraw) msg = who + 'no tienes jugada. Roba una carta del mazo.';
    else msg = who + 'no tienes jugada. Pasa el turno.';

    const top =
      '<div class="top">' + (net.code ? 'Sala <b>' + esc(net.code) + '</b> ·' : '') + ' <b>Ocho Locos</b> · Ronda <b>' + v.round + '</b> · a <b>' + v.target + '</b> puntos' +
      (mode === 'client' && !net.connected ? ' · <span class="badge off">' + esc(ui.status || 'sin conexión') + '</span>' : '') +
      '<span class="sp"></span><button class="small ghost" data-act="help">Reglas</button>' +
      '<button class="small ghost" data-act="leave">Salir</button></div>';

    const players = '<div class="players">' + v.players.map((p, i) =>
      '<div class="pchip' + (playing && v.turn === i ? ' turn' : '') + '"><div class="n"><span>' + esc(p.name) +
      (i === v.you && mode !== 'local' ? ' (tú)' : '') + '</span><span>' + p.score + ' pts</span></div>' +
      '<div class="m">' + p.count + (p.count === 1 ? ' carta ' : ' cartas ') +
      (p.count === 1 && playing ? '<span class="badge">última carta</span> ' : '') +
      (v.conn && !v.conn[i] ? '<span class="badge off">sin conexión</span>' : '') + '</div></div>').join('') + '</div>';

    const banner = '<div class="banner' + (myTurn ? ' mine' : '') + '"><div class="msg">' + msg + '</div>' +
      '<div class="log">' + esc(v.log.slice(-2).join(' ')) + '</div></div>';

    const center = '<div class="center">' +
      '<div class="pile' + (canDraw ? ' can' : '') + '"' + (canDraw ? ' data-act="odraw"' : '') + '>' +
      (v.canDrawMore ? '<div class="back"></div>' : '<div class="empty"></div>') +
      '<div class="lbl">Mazo (' + v.deckCount + ')</div></div>' +
      '<div class="pile">' + cardHTML(v.top) + '<div class="lbl">Descarte</div></div>' +
      '<div class="pile"><div class="suitbox' + (redSuit ? ' red' : '') + '">' + CARD.SUIT_SYM[v.suit] + '</div><div class="lbl">Palo en juego</div></div>' +
      '</div>';

    let actions = '';
    if (myTurn) actions += '<button class="primary" data-act="opass"' + (canPass ? '' : ' disabled') + '>Pasar</button>';
    actions += '<button class="ghost" data-act="sort">Ordenar por ' + (sortMode === 'rank' ? 'palo' : 'número') + '</button>';
    const hint = myTurn ? 'Toca una carta para jugarla. Con un 8 eliges el palo que sigue.' : '';

    const dock = '<div class="dock"><div class="dock-in"><div class="hand">' +
      hand.map(c => cardHTML(c, { cls: myTurn && !ok(c) ? 'dim' : '', attr: 'data-act="ocard" data-id="' + c.id + '"' })).join('') +
      '</div><div class="actions">' + actions + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div></div>';

    app.innerHTML = '<div class="game-screen">' + top + players + banner + center + '</div>' + dock + overlays();
  }

  function ochoResultHTML() {
    const v = view, rr = v.roundResult, over = v.status === 'gameOver';
    const w = rr.rows[rr.winner].name;
    const sub = (rr.blocked ? 'Nadie podía jugar: gana quien tenía menos puntos en la mano. ' : esc(w) + ' se quedó sin cartas. ') +
      esc(w) + ' suma ' + rr.gain + ' puntos.';
    const rows = rr.rows.map((r, i) => '<tr' + (i === rr.winner ? ' class="win"' : '') + '><td>' + esc(r.name) + '</td><td class="num">' + r.left +
      '</td><td class="num">' + r.pts + '</td><td class="num">' + r.total + '</td></tr>').join('');
    let btn;
    if (over) btn = '<button class="primary" data-act="home">Volver al inicio</button>';
    else if (mode === 'client') btn = '<p>Esperando a que el anfitrión empiece la siguiente ronda…</p>';
    else btn = '<button class="primary" data-act="next">Siguiente ronda</button>';
    return '<div class="overlay"><div class="modal"><h2>' +
      (over ? '🏆 Ganó ' + esc(w) : 'Fin de la ronda ' + rr.round) + '</h2><p>' + sub + '</p>' +
      '<table><tr><th>Jugador</th><th class="num">Cartas</th><th class="num">Valor en mano</th><th class="num">Total</th></tr>' + rows + '</table>' +
      btn + '</div></div>';
  }

  function ochoHelpHTML() {
    return '<div class="overlay" data-act="close"><div class="modal"><h2>Ocho Locos</h2>' +
      '<p><b>Objetivo:</b> quedarte sin cartas antes que los demás.</p>' +
      '<p><b>Reparto:</b> 5 cartas a cada uno (7 si son 2 jugadores). Se voltea una carta para empezar el descarte.</p>' +
      '<p><b>Tu turno:</b> juegas una carta del mismo palo o del mismo número que la de arriba del descarte.</p>' +
      '<p><b>Los 8 son locos:</b> se pueden jugar sobre cualquier carta, y quien lo juega elige el palo que sigue.</p>' +
      '<p><b>Si no puedes (o no quieres) jugar:</b> robas una carta. Si te sirve la puedes jugar; si no, pasas.</p>' +
      '<p><b>Puntos:</b> quien se queda sin cartas suma el valor de las cartas que les quedaron a los demás: ' +
      '8 = 50 · J, Q, K = 10 · As = 1 · el resto vale su número. Gana la partida el primero que llega a 100.</p>' +
      '<button class="primary" data-act="closebtn">Entendido</button></div></div>';
  }

  /* ---------- Solitario ---------- */
  function solSame(a, b) { return a && b && a.t === b.t && a.i === b.i && a.k === b.k; }

  function solDo(fn) {
    const snap = JSON.stringify(sol.st);
    const done = fn();
    if (done) {
      sol.undo.push(snap);
      if (sol.undo.length > 300) sol.undo.shift();
      store(SOLSAVE, sol.st);
    }
    return done;
  }

  function renderSol() {
    const st = sol.st, sel = sol.sel;
    const isSel = (t, i, k) => sel && sel.t === t && (t === 'w' || (sel.i === i && (t === 'f' || k >= sel.k)));
    const wasteTop = st.waste[st.waste.length - 1];

    const top = '<div class="top"><b>Solitario</b> · Movimientos <b>' + st.moves + '</b><span class="sp"></span>' +
      '<button class="small ghost" data-act="solundo"' + (sol.undo.length ? '' : ' disabled') + '>Deshacer</button>' +
      '<button class="small ghost" data-act="solauto">Subir todo</button>' +
      '<button class="small ghost" data-act="solnew">Nueva</button>' +
      '<button class="small ghost" data-act="help">Reglas</button>' +
      '<button class="small ghost" data-act="leave">Salir</button></div>';

    const upper = '<div class="sol-row">' +
      '<div class="slot" data-act="solstock">' + (st.stock.length ? '<div class="back"></div>' : '<div class="empty">↺</div>') + '</div>' +
      '<div class="slot">' + (wasteTop ? cardHTML(wasteTop, { cls: isSel('w') ? 'pick' : '', attr: 'data-act="sol" data-t="w"' }) : '<div class="empty"></div>') + '</div>' +
      '<div class="slot"></div>' +
      st.found.map((p, i) => '<div class="slot">' + (p.length
        ? cardHTML(p[p.length - 1], { cls: isSel('f', i) ? 'pick' : '', attr: 'data-act="sol" data-t="f" data-i="' + i + '"' })
        : '<div class="empty" data-act="sol" data-t="f" data-i="' + i + '">' + CARD.SUIT_SYM[S.SUITS[i]] + '</div>') + '</div>').join('') +
      '</div>';

    const cols = '<div class="sol-row tab">' + st.tab.map((pile, i) => '<div class="slot col">' + (pile.length
      ? pile.map((c, k) => c.up
        ? cardHTML(c, { cls: 'up' + (isSel('t', i, k) ? ' pick' : ''), attr: 'data-act="sol" data-t="t" data-i="' + i + '" data-k="' + k + '"' })
        : '<div class="back"></div>').join('')
      : '<div class="empty" data-act="sol" data-t="t" data-i="' + i + '" data-k="-1"></div>') + '</div>').join('') + '</div>';

    const hint = '<div class="hint">Toca una carta y luego el lugar adonde va. Toca dos veces una carta para subirla a su base.</div>';
    const win = st.won ? '<div class="overlay"><div class="modal"><h2>🏆 ¡Ganaste!</h2><p>Completaste el solitario en ' + st.moves +
      ' movimientos.</p><button class="primary" data-act="solnew">Jugar otra</button><button class="ghost" data-act="leave">Volver al inicio</button></div></div>' : '';

    app.innerHTML = '<div class="game-screen sol">' + top + upper + cols + hint + '</div>' + win + overlays();
  }

  function solHelpHTML() {
    return '<div class="overlay" data-act="close"><div class="modal"><h2>Solitario (Klondike)</h2>' +
      '<p><b>Objetivo:</b> subir todas las cartas a las cuatro bases, una por palo, en orden del As al Rey.</p>' +
      '<p><b>Columnas:</b> se arman hacia abajo alternando colores (rojo sobre negro, negro sobre rojo). Puedes mover una carta o una tira completa.</p>' +
      '<p><b>Columna vacía:</b> solo puede empezar con un Rey.</p>' +
      '<p><b>Mazo:</b> toca el mazo para voltear una carta. Cuando se acaba, tócalo otra vez para volver a pasarlo.</p>' +
      '<p><b>Cómo mover:</b> toca la carta y luego el destino. Dos toques sobre la misma carta la suben a su base si se puede.</p>' +
      '<button class="primary" data-act="closebtn">Entendido</button></div></div>';
  }

  /* ---------- acciones de la interfaz ---------- */
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  function myName() {
    const n = val('name').slice(0, 16);
    if (!n) { toast('Escribe tu nombre primero.'); return null; }
    store('maldito-name', n);
    return n;
  }
  const meNow = () => view.players[view.you];
  const selCards = () => Array.from(sel).map(id => meNow().hand.find(c => c.id === id)).filter(Boolean);

  const handlers = {
    create() {
      const n = myName(); if (!n) return;
      setGame(homeGame);
      net.seats = [{ name: n, token: 'host', conn: null }];
      net.state = null;
      hostStart(newCode(), false);
    },
    join() {
      const n = myName(); if (!n) return;
      const code = val('code').toUpperCase();
      if (code.length !== 4) return toast('El código de sala tiene 4 letras.');
      clientStart(code, n);
    },
    local() {
      const names = val('names').split(',').map(s => s.trim().slice(0, 16)).filter(Boolean);
      if (names.length < 2) return toast('Escribe al menos 2 nombres separados por coma.');
      if (names.length > M.MAX_PLAYERS) return toast('Máximo ' + M.MAX_PLAYERS + ' jugadores.');
      setGame(homeGame);
      mode = 'local';
      local.state = M.newGame(names);
      ui.cover = true;
      refresh();
    },
    resume() {
      const s = load(SAVE);
      if (!s || !s.state) return;
      setGame(s.game);
      if (s.mode === 'local') { mode = 'local'; local.state = s.state; ui.cover = true; refresh(); }
      else {
        net.seats = s.seats.map(x => ({ name: x.name, token: x.token, conn: null }));
        net.state = s.state;
        view = M.viewFor(net.state, 0);
        view.conn = net.seats.map((x, i) => i === 0);
        hostStart(s.code, true);
      }
    },
    rejoin() { const c = load(CLIENT, true); if (c) clientStart(c.code, c.name); },
    dropsave() { store(SAVE, null); render(); },
    dropclient() { store(CLIENT, null, true); render(); },
    start() {
      if (net.seats.length < 2) return;
      net.state = M.newGame(net.seats.map(s => s.name));
      refresh();
    },
    copy() {
      const link = location.origin + location.pathname + '?sala=' + net.code;
      try { navigator.clipboard.writeText(link).then(() => toast('Enlace copiado.'), () => toast(link)); }
      catch (e) { toast(link); }
    },
    leave() {
      const q = mode === 'host' ? '¿Salir? Eres el anfitrión: la partida se termina para todos.' : '¿Salir de la partida?';
      if ((view || mode === 'host') && !window.confirm(q)) return;
      leave();
    },
    home() { leave(); },
    help() { ui.help = mode === 'sol' ? 'sol' : mode ? gameId : homeGame; render(); },
    pickgame(el) {
      ['name', 'code', 'names'].forEach(id => { const x = document.getElementById(id); if (x) homeVals[id] = x.value; });
      homeGame = NAMES[el.dataset.g] ? el.dataset.g : 'maldito';
      store('juegos-sel', homeGame);
      render();
    },
    // Ocho Locos
    odraw() { send({ t: 'draw' }); },
    opass() { send({ t: 'pass' }); },
    ocard(el) {
      const v = view;
      if (!(v.status === 'playing' && v.turn === v.you)) return;
      const c = meNow().hand.find(x => x.id === +el.dataset.id);
      if (!c) return;
      if (!M.canPlay(c, v.top, v.suit)) return toast('Esa carta no coincide en palo ni en número. Juega otra, o roba del mazo.');
      if (c.r !== 8) return send({ t: 'play', id: c.id });
      pick(M.SUITS.map(s => M.SUIT_SYM[s] + ' ' + M.SUIT_NAME[s]), '¿Qué palo pides?', i => send({ t: 'play', id: c.id, suit: M.SUITS[i] }));
    },
    // Solitario
    solnew() {
      if (mode === 'sol' && sol.st && !sol.st.won && sol.st.moves > 0 && !window.confirm('¿Empezar una partida nueva? Se pierde la actual.')) return;
      mode = 'sol';
      sol.st = S.newGame();
      sol.sel = null;
      sol.undo = [];
      store(SOLSAVE, sol.st);
      render();
    },
    solresume() {
      const s = load(SOLSAVE);
      if (!s) return;
      mode = 'sol';
      sol.st = s;
      sol.sel = null;
      sol.undo = [];
      render();
    },
    solundo() {
      const snap = sol.undo.pop();
      if (!snap) return;
      sol.st = JSON.parse(snap);
      sol.sel = null;
      store(SOLSAVE, sol.st);
      render();
    },
    solauto() {
      sol.sel = null;
      if (!solDo(() => S.autoFound(sol.st))) toast('Por ahora no hay cartas que puedan subir a las bases.');
      render();
    },
    solstock() { sol.sel = null; solDo(() => S.draw(sol.st)); render(); },
    sol(el) {
      const d = el.dataset;
      const here = { t: d.t, i: d.i == null ? undefined : +d.i, k: d.k == null ? undefined : +d.k };
      const pickable = S.cardsAt(sol.st, here).length > 0;
      const sel = sol.sel;
      if (!sel) { if (pickable) sol.sel = here; return render(); }
      sol.sel = null;
      if (solSame(sel, here)) {
        if (!solDo(() => S.move(sol.st, sel, { t: 'f' }))) toast('Esa carta todavía no puede subir a su base.');
        return render();
      }
      const to = here.t === 'f' ? { t: 'f' } : here.t === 't' ? { t: 't', i: here.i } : null;
      if (!(to && solDo(() => S.move(sol.st, sel, to))) && pickable) sol.sel = here;
      render();
    },
    close(el, e) { if (e.target === el) { ui.help = false; ui.chooser = null; render(); } },
    closebtn() { ui.help = false; ui.chooser = null; render(); },
    choose(el) { const c = ui.chooser; ui.chooser = null; if (c) c.cb(+el.dataset.i); render(); },
    uncover() { ui.cover = false; render(); },
    sort() { sortMode = sortMode === 'rank' ? 'suit' : 'rank'; render(); },
    card(el) { const id = +el.dataset.id; if (sel.has(id)) sel.delete(id); else sel.add(id); render(); },
    draw(el) { send({ t: 'draw', from: el.dataset.from }); },
    next() { send({ t: 'next' }); },
    unstage(el) { staged.splice(+el.dataset.i, 1); render(); },
    armar() {
      const cards = selCards();
      const opts = M.meldOptions(cards);
      if (!opts.length) return toast('Esas cartas no forman un grupo ni una escalera válida.');
      const ids = cards.map(c => c.id);
      pick(opts.map(M.meldLabel), '¿Cómo quieres armar la escalera?', v => {
        if (meNow().bajado) send({ t: 'meld', ids, v });
        else staged.push({ ids, v, meld: opts[v] });
        sel = new Set();
        render();
      });
    },
    bajar() {
      const melds = staged.map(s => ({ ids: s.ids, v: s.v }));
      staged = [];
      send({ t: 'bajar', melds });
    },
    discard() {
      if (sel.size !== 1) return;
      const id = Array.from(sel)[0];
      sel = new Set();
      send({ t: 'discard', id });
    },
    meld(el) {
      const v = view, me = meNow();
      if (!(v.status === 'playing' && v.turn === v.you && v.stage === 'play')) return;
      if (!me.bajado) return toast('Primero tienes que bajarte con tu juego.');
      if (sel.size !== 1) return toast('Selecciona una sola carta de tu mano y luego toca el juego.');
      const card = selCards()[0];
      const m = v.table.find(x => x.id === +el.dataset.id);
      if (!card || !m) return;
      const opts = M.addOptions(m, card);
      if (!opts.length) return toast('Esa carta no calza en ese juego.');
      pick(opts.map(o => o.label), '¿Cómo quieres jugar esa carta?', i => {
        sel = new Set();
        send({ t: 'add', id: card.id, meldId: m.id, v: i });
      });
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = handlers[el.dataset.act];
    if (fn) fn(el, e);
  });

  // Para pruebas desde la consola.
  window.__maldito = { get state() { return mode === 'sol' ? sol.st : mode === 'local' ? local.state : net.state; }, refresh };

  const savedSel = load('juegos-sel');
  if (NAMES[savedSel]) homeGame = savedSel;
  render();
})();
