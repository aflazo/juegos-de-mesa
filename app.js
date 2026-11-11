/* El Maldito — interfaz, modo en la misma pantalla y modo en línea (PeerJS, el anfitrión manda). */
(function () {
  'use strict';

  const M = window.Maldito;
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
      store(SAVE, { mode: 'local', state: local.state });
      view = M.viewFor(local.state, local.state.turn);
    } else if (mode === 'host') {
      store(SAVE, { mode: 'host', code: net.code, seats: net.seats.map(s => ({ name: s.name, token: s.token })), state: net.state });
      const on = net.seats.map((s, i) => i === 0 || !!(s.conn && s.conn.open));
      net.seats.forEach((s, i) => {
        if (i === 0 || !s.conn || !s.conn.open) return;
        if (net.state) {
          const v = M.viewFor(net.state, i);
          v.conn = on;
          s.conn.send({ t: 'state', view: v });
        } else {
          s.conn.send({ t: 'lobby', you: i, players: net.seats.map((x, j) => ({ name: x.name, on: on[j] })) });
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
    if (d.t === 'lobby') { lobby = d; view = null; render(); }
    else if (d.t === 'state') { view = d.view; lobby = null; render(); }
    else if (d.t === 'err') {
      toast(d.msg || 'Error');
      if (d.fatal) leave();
    }
  }

  function leave() {
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
    return '<div class="card' + (red ? ' red' : '') + (c.r === 2 ? ' wildc' : '') + (o.sel ? ' sel' : '') + '" ' + (o.attr || '') + '>' +
      '<span class="r">' + M.rankLabel(c.r) + '</span><span class="s">' + M.SUIT_SYM[c.s] + '</span>' +
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
    if (mode === 'host' && !net.state) return renderLobby();
    if (mode === 'client' && !view) return lobby ? renderLobby() : renderWaiting();
    if (!view) return;
    renderGame();
  }

  function renderHome() {
    const save = load(SAVE), cl = load(CLIENT, true);
    const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().slice(0, 4);
    const name = load('maldito-name') || '';
    let resume = '';
    if (save && save.state) {
      resume += '<div class="box"><h2>Tienes una partida guardada</h2><p>' +
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
      '<div class="games"><div class="game on"><b>El Maldito</b><span>2 a 6 jugadores · 10 juegos · el 2 es comodín</span></div>' +
      '<div class="game off"><span>Más juegos pronto</span></div></div>' +
      resume +
      '<div class="box"><h2>Jugar en línea</h2>' +
      '<input id="name" maxlength="16" placeholder="Tu nombre" value="' + esc(name) + '">' +
      '<button class="primary" data-act="create">Crear una sala</button>' +
      '<div class="row"><input id="code" maxlength="4" placeholder="Código de sala" value="' + esc(sala) + '" style="text-transform:uppercase">' +
      '<button data-act="join">Unirme</button></div>' +
      '<p>Cada jugador entra desde su propio teléfono o computadora y solo ve sus cartas.</p></div>' +
      '<div class="box"><h2>Jugar en esta misma pantalla</h2>' +
      '<input id="names" placeholder="Nombres separados por coma (ej. Ana, Luis, Marta)">' +
      '<button data-act="local">Empezar</button>' +
      '<p>Se van pasando el dispositivo; la mano se oculta entre turnos.</p></div>' +
      '<button class="ghost" data-act="help">Ver reglas y juegos</button>' +
      '</div>' + overlays();
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
      '<div class="home"><h1>El Maldito</h1>' +
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
      '<p>Juego ' + p.phase + ': ' + M.phaseText(p.phase) + '</p>' +
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
    if (view && mode && (view.status === 'roundEnd' || view.status === 'gameOver')) h += resultHTML();
    if (ui.help) h += helpHTML();
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
      M.PHASES.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + M.phaseText(i + 1) + '</td></tr>').join('') + '</table>' +
      '<p><b>Turno:</b> robas (mazo o descarte), juegas si puedes y siempre botas una carta.</p>' +
      '<p><b>Comodín:</b> el 2. Nunca más comodines que cartas en un juego, y en escaleras no van dos comodines juntos. ' +
      'Si tienes la carta que reemplaza a un comodín de una escalera, lo cambias y te lo llevas.</p>' +
      '<p><b>Escaleras:</b> mismo palo, mínimo 4 cartas, el As es la carta más alta.</p>' +
      '<p><b>Después de bajarte</b> puedes bajar más juegos y agregar cartas a cualquier juego de la mesa.</p>' +
      '<p><b>Limpio:</b> botas tu última carta y se acaba la ronda. <b>Sucio:</b> te quedas sin cartas sin botar y los demás juegan un turno más.</p>' +
      '<p><b>Puntos</b> (por carta que te queda en la mano): 3 al 9 = 5 · 10, J, Q, K = 10 · As = 20 · 2 = 25. Gana quien completa el juego 10; si empatan, el de menos puntos.</p>' +
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
      mode = 'local';
      local.state = M.newGame(names);
      ui.cover = true;
      refresh();
    },
    resume() {
      const s = load(SAVE);
      if (!s || !s.state) return;
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
    help() { ui.help = true; render(); },
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
  window.__maldito = { get state() { return mode === 'local' ? local.state : net.state; }, refresh };

  render();
})();
