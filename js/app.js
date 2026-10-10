// Page rendering and hash routing for the public site.

const $app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function teamName(id) { return (DB.teamsById[id] || { name: id }).name; }
function teamColor(id) { return (DB.teamsById[id] || {}).color || '#888'; }
function teamLabel(id) {
  return `<span class="team-dot" style="background:${esc(teamColor(id))}"></span>${esc(teamName(id))}`;
}
function teamTag(id) {
  return `<span class="team-tag" style="background:${esc(teamColor(id))}">${esc(id)}</span>`;
}
function playerName(id) { return (DB.playersById[id] || { name: id }).name; }
function playerLink(id) { return `<a href="#/player/${encodeURIComponent(id)}">${esc(playerName(id))}</a>`; }
function teamOptions(selected, allLabel = 'All teams') {
  return `<option value="">${allLabel}</option>` + DB.league.teams
    .map(t => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

// ---------- router ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { route: parts[0] || 'home', arg: parts[1], params: new URLSearchParams(query) };
}
function setParams(params) {
  const { route, arg } = parseHash();
  const q = params.toString();
  history.replaceState(null, '', `#/${route}${arg ? '/' + encodeURIComponent(arg) : ''}${q ? '?' + q : ''}`);
}

const routes = {
  home: renderHome,
  schedule: renderSchedule,
  standings: renderStandings,
  rosters: renderRosters,
  team: renderRosters,
  stats: renderStats,
  leaders: renderLeaders,
  game: renderGame,
  player: renderPlayer,
  admin: () => renderAdmin().catch(e => {
    console.error(e);
    $app.innerHTML = `<div class="notice"><strong>Something went wrong on the admin page.</strong><br>${esc(e.message)}</div>`;
  }),
};

function router() {
  const { route, arg, params } = parseHash();
  document.querySelectorAll('.site-nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route || (route === 'team' && a.dataset.route === 'rosters')));
  document.getElementById('site-nav').classList.remove('open');
  const fn = routes[route] || renderNotFound;
  try {
    fn(arg, params);
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="notice"><strong>Something went wrong showing this page.</strong><br>${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

function renderNotFound() {
  $app.innerHTML = `<div class="empty"><h1>Page not found</h1><p><a href="#/">Back to home</a></p></div>`;
}

// ---------- sortable tables ----------

// columns: [{ key, label, value(row), display(row), left, sortable(default true), desc(default true) }]
function sortableTable(id, columns, rows, { sortKey, sortDesc = true, rank = false, footer = '' } = {}) {
  const col = columns.find(c => c.key === sortKey);
  const sorted = col ? [...rows].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sortDesc ? -cmp : cmp;
  }) : rows;
  const head = (rank ? '<th>#</th>' : '') + columns.map(c => {
    const cls = [c.left ? 'l' : '', c.sortable === false ? '' : 'sortable', c.key === sortKey ? 'sorted' : '', c.key === sortKey && !sortDesc ? 'asc' : ''].join(' ');
    return `<th class="${cls}" data-key="${esc(c.key)}" ${c.title ? `title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`;
  }).join('');
  const body = sorted.map((r, i) => '<tr>' + (rank ? `<td class="num-col">${i + 1}</td>` : '') + columns.map(c =>
    `<td class="${c.left ? 'l' : ''}">${c.display ? c.display(r) : esc(c.value(r))}</td>`).join('') + '</tr>').join('');
  return `<div class="table-wrap"><table id="${id}"><thead><tr>${head}</tr></thead><tbody>${body ||
    `<tr><td colspan="${columns.length + (rank ? 1 : 0)}" class="l muted">No data yet.</td></tr>`}</tbody>${footer}</table></div>`;
}
function bindSort(id, columns, current, onChange) {
  document.querySelectorAll(`#${id} th.sortable`).forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.key;
    const c = columns.find(x => x.key === key);
    const desc = key === current.sortKey ? !current.sortDesc : (c.desc !== false);
    onChange(key, desc);
  }));
}

// ---------- column definitions ----------

const BAT_COLS = [
  { key: 'name', label: 'Player', left: true, value: r => playerName(r.player), display: r => playerLink(r.player), desc: false },
  { key: 'team', label: 'Team', left: true, value: r => r.team || '', display: r => teamTag(r.team), desc: false },
  { key: 'g', label: 'G', value: r => r.g },
  { key: 'pa', label: 'PA', value: r => r.pa },
  { key: 'ab', label: 'AB', value: r => r.ab },
  { key: 'r', label: 'R', value: r => r.r },
  { key: 'h', label: 'H', value: r => r.h },
  { key: '2b', label: '2B', value: r => r['2b'] },
  { key: '3b', label: '3B', value: r => r['3b'] },
  { key: 'hr', label: 'HR', value: r => r.hr },
  { key: 'rbi', label: 'RBI', value: r => r.rbi },
  { key: 'bb', label: 'BB', value: r => r.bb },
  { key: 'so', label: 'SO', value: r => r.so },
  { key: 'sb', label: 'SB', value: r => r.sb },
  { key: 'hbp', label: 'HBP', value: r => r.hbp },
  { key: 'avg', label: 'AVG', value: r => r.avg, display: r => fmt.avg(r.avg) },
  { key: 'obp', label: 'OBP', value: r => r.obp, display: r => fmt.avg(r.obp) },
  { key: 'slg', label: 'SLG', value: r => r.slg, display: r => fmt.avg(r.slg) },
  { key: 'ops', label: 'OPS', value: r => r.ops, display: r => fmt.avg(r.ops) },
];
const PIT_COLS = [
  { key: 'name', label: 'Player', left: true, value: r => playerName(r.player), display: r => playerLink(r.player), desc: false },
  { key: 'team', label: 'Team', left: true, value: r => r.team || '', display: r => teamTag(r.team), desc: false },
  { key: 'w', label: 'W', value: r => r.w },
  { key: 'l', label: 'L', value: r => r.l },
  { key: 'era', label: 'ERA', value: r => r.era, display: r => fmt.era(r.era), desc: false },
  { key: 'g', label: 'G', value: r => r.g },
  { key: 'gs', label: 'GS', value: r => r.gs },
  { key: 'sv', label: 'SV', value: r => r.sv },
  { key: 'ip', label: 'IP', value: r => r.outs, display: r => r.ip },
  { key: 'h', label: 'H', value: r => r.h },
  { key: 'r', label: 'R', value: r => r.r },
  { key: 'er', label: 'ER', value: r => r.er },
  { key: 'bb', label: 'BB', value: r => r.bb },
  { key: 'so', label: 'SO', value: r => r.so },
  { key: 'hr', label: 'HR', value: r => r.hr },
  { key: 'whip', label: 'WHIP', value: r => r.whip, display: r => fmt.era(r.whip), desc: false },
  { key: 'k9', label: 'K/9', value: r => r.k9, display: r => r.k9.toFixed(1) },
];

// ---------- shared pieces ----------

// Small print under a game: doubleheader / length, location, notes.
function gameInfo(g) {
  const dh = DB.doubleheaders.get(g.id);
  const inn = scheduledInnings(g);
  const len = dh ? `Doubleheader, Game ${dh.game} (${inn} inn.)` : (inn !== defaultInnings(g) ? `${inn} innings` : '');
  return [len, g.location, g.notes].filter(Boolean).join(' · ');
}

function gameRow(g, { showDate = false } = {}) {
  const final = isFinal(g);
  const as = num(g.awayScore), hs = num(g.homeScore);
  const side = (id, score, win) => `<div class="side ${final && win ? 'winner' : ''}">
      <span>${teamLabel(id)}</span>${final ? `<span class="score">${score}</span>` : ''}</div>`;
  const status = g.status || 'scheduled';
  let meta;
  if (final) {
    meta = `<span class="status final">${finalLabel(g)}</span>${g.mercy ? ' <span class="badge mercy">Mercy</span>' : ''}` +
      (hasBoxScore(g) ? `<br><a href="#/game/${encodeURIComponent(g.id)}">Box score</a>` : '');
  } else if (status === 'postponed' || status === 'cancelled') {
    meta = `<span class="status ${status}">${status}</span>`;
  } else {
    meta = `<span class="status scheduled">${esc(fmtTime(g.time) || 'TBD')}</span>`;
  }
  return `<div class="game-row">
    <div class="matchup">
      ${showDate ? `<div class="muted small">${esc(fmtDate(g.date))}</div>` : ''}
      ${side(g.away, as, as > hs)}
      ${side(g.home, hs, hs > as)}
      ${gameInfo(g) ? `<div class="muted small">${esc(gameInfo(g))}</div>` : ''}
    </div>
    <div class="game-meta">${meta}</div>
  </div>`;
}

function standingsTable(rows, { compact = false } = {}) {
  const anyTies = rows.some(r => r.t);
  const head = compact
    ? `<th class="l">Team</th><th>W</th><th>L</th>${anyTies ? '<th>T</th>' : ''}<th>PCT</th><th>GB</th>`
    : `<th class="l">Team</th><th>GP</th><th>W</th><th>L</th>${anyTies ? '<th>T</th>' : ''}<th>PCT</th><th>GB</th>
       <th>RS</th><th>RA</th><th>DIFF</th><th>Home</th><th>Away</th><th>L10</th><th>STRK</th>`;
  const body = rows.map(r => {
    const name = `<a href="#/team/${encodeURIComponent(r.team.id)}">${teamLabel(r.team.id)}</a>`;
    return compact
      ? `<tr><td class="l">${name}</td><td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}<td>${fmt.pct(r.pct)}</td><td>${fmt.gb(r.gb)}</td></tr>`
      : `<tr><td class="l">${name}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}
         <td>${fmt.pct(r.pct)}</td><td>${fmt.gb(r.gb)}</td><td>${r.rs}</td><td>${r.ra}</td>
         <td class="${r.diff > 0 ? 'result-w' : r.diff < 0 ? 'result-l' : ''}">${fmt.diff(r.diff)}</td>
         <td>${r.hw}-${r.hl}</td><td>${r.aw}-${r.al}</td><td>${r.last10}</td><td>${r.streak}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- leaders ----------

const LEADER_CATS = {
  batting: [
    { key: 'avg', label: 'Batting Average', value: s => s.avg, show: s => fmt.avg(s.avg), qualified: true },
    { key: 'hr', label: 'Home Runs', value: s => s.hr },
    { key: 'rbi', label: 'Runs Batted In', value: s => s.rbi },
    { key: 'h', label: 'Hits', value: s => s.h },
    { key: 'r', label: 'Runs', value: s => s.r },
    { key: 'sb', label: 'Stolen Bases', value: s => s.sb },
    { key: 'obp', label: 'On-Base Pct', value: s => s.obp, show: s => fmt.avg(s.obp), qualified: true },
    { key: 'slg', label: 'Slugging Pct', value: s => s.slg, show: s => fmt.avg(s.slg), qualified: true },
    { key: 'ops', label: 'OPS', value: s => s.ops, show: s => fmt.avg(s.ops), qualified: true },
    { key: '2b', label: 'Doubles', value: s => s['2b'] },
    { key: 'bb', label: 'Walks', value: s => s.bb },
    { key: 'tb', label: 'Total Bases', value: s => s.tb },
  ],
  pitching: [
    { key: 'era', label: 'ERA', value: s => s.era, show: s => fmt.era(s.era), asc: true, qualified: true },
    { key: 'w', label: 'Wins', value: s => s.w },
    { key: 'so', label: 'Strikeouts', value: s => s.so },
    { key: 'sv', label: 'Saves', value: s => s.sv },
    { key: 'whip', label: 'WHIP', value: s => s.whip, show: s => fmt.era(s.whip), asc: true, qualified: true },
    { key: 'ip', label: 'Innings Pitched', value: s => s.outs, show: s => s.ip },
  ],
};

function topN(list, cat, n, isQualified) {
  const pool = (cat.qualified ? list.filter(isQualified) : list).filter(s => cat.asc || cat.value(s) > 0);
  const sorted = [...pool].sort((a, b) => (cat.asc ? cat.value(a) - cat.value(b) : cat.value(b) - cat.value(a)) ||
    playerName(a.player).localeCompare(playerName(b.player)));
  return sorted.slice(0, n);
}

function leaderCard(list, cat, n, isQualified) {
  const top = topN(list, cat, n, isQualified);
  const items = top.map((s, i) => `<li><span><span class="rank">${i + 1}.</span>${playerLink(s.player)} ${teamTag(s.team)}</span>
      <span class="val">${cat.show ? cat.show(s) : cat.value(s)}</span></li>`).join('');
  return `<div class="card"><h3>${esc(cat.label)}</h3>
    ${items ? `<ol class="leader-list">${items}</ol>` : '<p class="muted small">No qualifying players yet.</p>'}</div>`;
}

// ---------- pages ----------

function renderHome() {
  const games = sortedGames();
  const today = todayISO();
  const recent = games.filter(isFinal).slice(-4).reverse();
  const upcoming = games.filter(g => !isFinal(g) && (g.status || 'scheduled') === 'scheduled' && (g.date || '') >= today).slice(0, 4);
  const stats = computePlayerStats();
  const q = qualifiers();
  const homeCats = [LEADER_CATS.batting[0], LEADER_CATS.batting[1], LEADER_CATS.batting[2],
    LEADER_CATS.pitching[0], LEADER_CATS.pitching[1], LEADER_CATS.pitching[2]];

  $app.innerHTML = `
    <section class="hero">
      <h1>${esc(DB.league.fullName || DB.league.name)}</h1>
      <p>${esc(DB.league.season)} Season</p>
    </section>
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Latest Results</h2><a href="#/schedule" class="small">Full schedule</a></div>
        ${recent.map(g => gameRow(g, { showDate: true })).join('') || '<p class="muted">No games played yet.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Upcoming Games</h2><a href="#/schedule" class="small">Full schedule</a></div>
        ${upcoming.map(g => gameRow(g, { showDate: true })).join('') || '<p class="muted">No upcoming games scheduled.</p>'}
      </section>
    </div>
    <section class="card" style="margin-top:1rem">
      <div class="card-head"><h2>Standings</h2><a href="#/standings" class="small">Full standings</a></div>
      ${standingsTable(computeStandings(), { compact: true })}
    </section>
    <div class="card-head"><h2>League Leaders</h2><a href="#/leaders" class="small">All leaders</a></div>
    <div class="grid grid-3">
      ${homeCats.map(c => leaderCard(LEADER_CATS.batting.includes(c) ? stats.batting : stats.pitching, c, 3,
        LEADER_CATS.batting.includes(c) ? q.batter : q.pitcher)).join('')}
    </div>`;
}

function renderSchedule(_, params) {
  const team = params.get('team') || '';
  const show = params.get('show') || 'all';
  const today = todayISO();
  let games = sortedGames().filter(g => !team || g.home === team || g.away === team);
  if (show === 'results') games = games.filter(isFinal).reverse();
  if (show === 'upcoming') games = games.filter(g => !isFinal(g) && (g.date || '') >= today);

  const byDate = new Map();
  for (const g of games) {
    const k = g.date || 'TBD';
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(g);
  }
  const days = [...byDate].map(([d, gs]) => `<div class="day"><h3>${esc(fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</h3>
    ${gs.map(g => gameRow(g)).join('')}</div>`).join('');

  // Team record summary when filtered
  let summary = '';
  if (team) {
    const row = computeStandings().find(r => r.team.id === team);
    if (row) summary = `<p class="muted">${esc(teamName(team))}: ${row.w}-${row.l}${row.t ? '-' + row.t : ''} · RS ${row.rs} · RA ${row.ra}</p>`;
  }

  $app.innerHTML = `
    <div class="page-head"><h1>Schedule &amp; Results</h1>
      <div class="controls">
        <select id="f-team">${teamOptions(team)}</select>
        <div class="seg" id="f-show">
          ${['all', 'results', 'upcoming'].map(s => `<button data-v="${s}" class="${s === show ? 'active' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </div>
      </div>
    </div>
    ${summary}
    ${days || '<div class="empty">No games to show.</div>'}`;

  const update = (k, v) => { const p = new URLSearchParams(params); v && v !== 'all' ? p.set(k, v) : p.delete(k); setParams(p); renderSchedule(_, p); };
  document.getElementById('f-team').onchange = e => update('team', e.target.value);
  document.querySelectorAll('#f-show button').forEach(b => (b.onclick = () => update('show', b.dataset.v)));
}

function renderStandings() {
  const rows = computeStandings();
  const played = DB.games.filter(countsForStandings).length;
  $app.innerHTML = `
    <div class="page-head"><h1>Standings</h1><span class="muted">${played} game${played === 1 ? '' : 's'} played</span></div>
    <div class="card">${standingsTable(rows)}</div>
    <p class="muted small">GB = games behind · RS/RA = runs scored/allowed · L10 = last 10 games · STRK = current streak.
    Ties count as half a win in PCT.</p>`;
}

function renderRosters(teamArg) {
  const teams = DB.league.teams;
  const selected = teamArg && DB.teamsById[teamArg] ? teamArg : '';
  const standings = computeStandings();

  const teamCard = t => {
    const roster = DB.players.filter(p => p.team === t.id).sort((a, b) => num(a.number) - num(b.number));
    const rec = standings.find(r => r.team.id === t.id);
    return `<section class="card" id="team-${esc(t.id)}">
      <div class="card-head"><h2>${teamLabel(t.id)}</h2>
        <span class="muted small">${rec ? `${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}` : ''} ·
        <a href="#/schedule?team=${encodeURIComponent(t.id)}">Schedule</a> ·
        <a href="#/stats?team=${encodeURIComponent(t.id)}">Stats</a></span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th class="l">Name</th><th class="l">Pos</th><th>B/T</th></tr></thead>
        <tbody>${roster.map(p => `<tr><td>${esc(p.number ?? '')}</td><td class="l">${playerLink(p.id)}</td>
          <td class="l">${esc(p.pos || '')}</td><td>${esc(p.bats || '-')}/${esc(p.throws || '-')}</td></tr>`).join('') ||
          '<tr><td colspan="4" class="l muted">No players listed.</td></tr>'}</tbody>
      </table></div></section>`;
  };

  $app.innerHTML = `
    <div class="page-head"><h1>Rosters</h1>
      <div class="controls"><select id="f-team">${teamOptions(selected)}</select></div></div>
    <div class="grid grid-2">${(selected ? teams.filter(t => t.id === selected) : teams).map(teamCard).join('')}</div>`;
  document.getElementById('f-team').onchange = e => { location.hash = e.target.value ? `#/team/${encodeURIComponent(e.target.value)}` : '#/rosters'; };
}

function renderStats(_, params) {
  const view = params.get('view') === 'pitching' ? 'pitching' : 'batting';
  const team = params.get('team') || '';
  const qualOnly = params.get('qual') === '1';
  const cols = view === 'batting' ? BAT_COLS : PIT_COLS;
  const defaultSort = view === 'batting' ? 'avg' : 'era';
  const sortKey = cols.some(c => c.key === params.get('sort')) ? params.get('sort') : defaultSort;
  const sortDesc = params.has('dir') ? params.get('dir') !== 'asc' : (cols.find(c => c.key === sortKey).desc !== false);

  const stats = computePlayerStats({ team: team || null });
  const q = qualifiers();
  let rows = stats[view];
  if (qualOnly) rows = rows.filter(view === 'batting' ? q.batter : q.pitcher);

  $app.innerHTML = `
    <div class="page-head"><h1>Stats</h1>
      <div class="controls">
        <div class="seg" id="f-view">
          <button data-v="batting" class="${view === 'batting' ? 'active' : ''}">Batting</button>
          <button data-v="pitching" class="${view === 'pitching' ? 'active' : ''}">Pitching</button>
        </div>
        <select id="f-team">${teamOptions(team)}</select>
        <label class="check"><input type="checkbox" id="f-qual" ${qualOnly ? 'checked' : ''}> Qualified only</label>
      </div>
    </div>
    <div class="card">${sortableTable('stats-table', cols, rows, { sortKey, sortDesc, rank: true })}</div>
    <p class="muted small">Click a column header to sort. Qualified = at least
      ${view === 'batting' ? `${q.paPerGame} plate appearances` : `${q.ipPerGame} inning${q.ipPerGame === 1 ? '' : 's'} pitched`}
      per team game.${view === 'pitching' ? ` ERA is based on ${DB.league.inningsPerGame || 9}-inning games.` : ''}</p>`;

  const update = changes => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? p.set(k, v) : p.delete(k);
    setParams(p);
    renderStats(_, p);
  };
  document.querySelectorAll('#f-view button').forEach(b => (b.onclick = () => update({ view: b.dataset.v === 'batting' ? '' : b.dataset.v, sort: '', dir: '' })));
  document.getElementById('f-team').onchange = e => update({ team: e.target.value });
  document.getElementById('f-qual').onchange = e => update({ qual: e.target.checked ? '1' : '' });
  bindSort('stats-table', cols, { sortKey, sortDesc }, (key, desc) => update({ sort: key, dir: desc ? 'desc' : 'asc' }));
}

function renderLeaders(_, params) {
  const team = params.get('team') || '';
  const stats = computePlayerStats({ team: team || null });
  const q = qualifiers();
  $app.innerHTML = `
    <div class="page-head"><h1>League Leaders</h1>
      <div class="controls"><select id="f-team">${teamOptions(team)}</select></div></div>
    <h2>Batting</h2>
    <div class="grid grid-3">${LEADER_CATS.batting.map(c => leaderCard(stats.batting, c, 5, q.batter)).join('')}</div>
    <h2 style="margin-top:1.5rem">Pitching</h2>
    <div class="grid grid-3">${LEADER_CATS.pitching.map(c => leaderCard(stats.pitching, c, 5, q.pitcher)).join('')}</div>
    <p class="muted small" style="margin-top:1rem">Rate stats (AVG, OBP, SLG, OPS, ERA, WHIP) require ${q.paPerGame} plate appearances
      or ${q.ipPerGame} inning${q.ipPerGame === 1 ? '' : 's'} pitched per team game.</p>`;
  document.getElementById('f-team').onchange = e => {
    const p = new URLSearchParams(); if (e.target.value) p.set('team', e.target.value);
    setParams(p); renderLeaders(_, p);
  };
}

function boxBattingTable(g, team) {
  const lines = (g.batting || []).filter(l => lineTeam(l) === team);
  const tot = emptyBat();
  lines.forEach(l => addBatLine(tot, l));
  const cols = ['ab', 'r', 'h', 'rbi', 'bb', 'so', '2b', '3b', 'hr', 'sb'];
  return `<div class="table-wrap"><table>
    <thead><tr><th class="l">${esc(teamName(team))} Batting</th>${cols.map(c => `<th>${c.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${lines.map(l => `<tr><td class="l">${playerLink(l.player)}</td>${cols.map(c => `<td>${num(l[c])}</td>`).join('')}</tr>`).join('') ||
      `<tr><td class="l muted" colspan="${cols.length + 1}">No batting stats entered.</td></tr>`}</tbody>
    <tfoot><tr><td class="l">Totals</td>${cols.map(c => `<td>${tot[c]}</td>`).join('')}</tr></tfoot>
  </table></div>`;
}
function boxPitchingTable(g, team) {
  const lines = (g.pitching || []).filter(l => lineTeam(l) === team);
  const cols = ['h', 'r', 'er', 'bb', 'so', 'hr'];
  return `<div class="table-wrap"><table>
    <thead><tr><th class="l">${esc(teamName(team))} Pitching</th><th>IP</th>${cols.map(c => `<th>${c.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${lines.map(l => {
      const d = (l.dec || '').toUpperCase();
      return `<tr><td class="l">${playerLink(l.player)}${d ? ` <span class="muted">(${esc(d === 'SV' ? 'S' : d)})</span>` : ''}</td>
        <td>${esc(outsToIP(ipToOuts(l.ip)))}</td>${cols.map(c => `<td>${num(l[c])}</td>`).join('')}</tr>`;
    }).join('') || `<tr><td class="l muted" colspan="${cols.length + 2}">No pitching stats entered.</td></tr>`}</tbody>
  </table></div>`;
}

function renderGame(id) {
  const g = DB.games.find(x => x.id === id);
  if (!g) return renderNotFound();
  const final = isFinal(g);
  const as = num(g.awayScore), hs = num(g.homeScore);
  $app.innerHTML = `
    <p><a href="#/schedule">&larr; Schedule</a></p>
    <section class="card">
      <p class="muted small" style="text-align:center;margin-top:0">${esc(fmtDate(g.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}
        ${g.time ? ' · ' + esc(fmtTime(g.time)) : ''}${gameInfo(g) ? ' · ' + esc(gameInfo(g)) : ''}</p>
      <div class="scoreboard">
        <div class="team"><div class="team-name">${teamLabel(g.away)}</div><div class="muted small">Away</div>${final ? `<div class="big">${as}</div>` : ''}</div>
        <div class="vs">${final ? esc(finalLabel(g).toUpperCase()) + (g.mercy ? '<br><span class="badge mercy">Mercy</span>' : '') : esc((g.status || 'scheduled').toUpperCase())}</div>
        <div class="team"><div class="team-name">${teamLabel(g.home)}</div><div class="muted small">Home</div>${final ? `<div class="big">${hs}</div>` : ''}</div>
      </div>
    </section>
    ${hasBoxScore(g) ? `
      <div class="grid grid-2">
        <section class="card">${boxBattingTable(g, g.away)}</section>
        <section class="card">${boxBattingTable(g, g.home)}</section>
        <section class="card">${boxPitchingTable(g, g.away)}</section>
        <section class="card">${boxPitchingTable(g, g.home)}</section>
      </div>` : `<div class="empty">No box score has been entered for this game.</div>`}`;
}

function renderPlayer(id) {
  const p = DB.playersById[id];
  const log = playerGameLog(id);
  if (!p && !log.length) return renderNotFound();
  const all = computePlayerStats();
  const bat = all.batting.find(s => s.player === id);
  const pit = all.pitching.find(s => s.player === id);
  const name = p ? p.name : id;
  const statCols = (cols, row) => {
    const use = cols.filter(c => c.key !== 'name' && c.key !== 'team');
    return `<div class="table-wrap"><table><thead><tr>${use.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody><tr>${use.map(c => `<td>${c.display ? c.display(row) : esc(c.value(row))}</td>`).join('')}</tr></tbody></table></div>`;
  };
  const opp = e => (e.game.home === e.team ? `vs ${e.game.away}` : `@ ${e.game.home}`);
  const res = e => {
    const us = e.game.home === e.team ? num(e.game.homeScore) : num(e.game.awayScore);
    const them = e.game.home === e.team ? num(e.game.awayScore) : num(e.game.homeScore);
    const r = us > them ? 'W' : us < them ? 'L' : 'T';
    const extra = e.game.mercy ? ' (mercy)' : finalLabel(e.game) !== 'Final' ? ` (${finalLabel(e.game).slice(6)})` : '';
    return `<a href="#/game/${encodeURIComponent(e.game.id)}" class="${r === 'W' ? 'result-w' : r === 'L' ? 'result-l' : ''}">${r} ${us}-${them}</a>${extra}`;
  };
  const batLog = log.filter(e => e.bat);
  const pitLog = log.filter(e => e.pit);

  $app.innerHTML = `
    <section class="card">
      <h1>${p && p.number !== undefined && p.number !== '' ? `<span class="muted">#${esc(p.number)}</span> ` : ''}${esc(name)}</h1>
      ${p ? `<p class="muted" style="margin:0">${teamLabel(p.team)} · <a href="#/team/${encodeURIComponent(p.team)}">Roster</a>
        ${p.pos ? ' · ' + esc(p.pos) : ''}${p.bats || p.throws ? ` · Bats ${esc(p.bats || '-')} / Throws ${esc(p.throws || '-')}` : ''}</p>` : ''}
    </section>
    ${bat ? `<section class="card"><h2>Batting</h2>${statCols(BAT_COLS, bat)}</section>` : ''}
    ${pit ? `<section class="card"><h2>Pitching</h2>${statCols(PIT_COLS, pit)}</section>` : ''}
    ${!bat && !pit ? '<div class="empty">No stats recorded yet.</div>' : ''}
    ${batLog.length ? `<section class="card"><h2>Batting Game Log</h2><div class="table-wrap"><table>
      <thead><tr><th class="l">Date</th><th class="l">Opp</th><th class="l">Result</th>${['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB'].map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${batLog.slice().reverse().map(e => `<tr><td class="l">${esc(fmtDate(e.game.date, { month: 'short', day: 'numeric' }))}</td>
        <td class="l">${esc(opp(e))}</td><td class="l">${res(e)}</td>
        ${['ab', 'r', 'h', '2b', '3b', 'hr', 'rbi', 'bb', 'so', 'sb'].map(k => `<td>${num(e.bat[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></section>` : ''}
    ${pitLog.length ? `<section class="card"><h2>Pitching Game Log</h2><div class="table-wrap"><table>
      <thead><tr><th class="l">Date</th><th class="l">Opp</th><th class="l">Result</th><th>Dec</th><th>IP</th>${['H', 'R', 'ER', 'BB', 'SO', 'HR'].map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${pitLog.slice().reverse().map(e => `<tr><td class="l">${esc(fmtDate(e.game.date, { month: 'short', day: 'numeric' }))}</td>
        <td class="l">${esc(opp(e))}</td><td class="l">${res(e)}</td><td>${esc(e.pit.dec || '')}</td><td>${esc(outsToIP(ipToOuts(e.pit.ip)))}</td>
        ${['h', 'r', 'er', 'bb', 'so', 'hr'].map(k => `<td>${num(e.pit[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></section>` : ''}`;
}

// ---------- boot ----------

document.querySelector('.nav-toggle').addEventListener('click', e => {
  const nav = document.getElementById('site-nav');
  nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
});

(async function init() {
  try {
    await loadData();
  } catch (e) {
    $app.innerHTML = `<div class="notice"><strong>Could not load league data.</strong><br>${esc(e.message)}
      <br><span class="small">If you just edited a data file, check it for a typo (a missing comma or quote is the usual culprit).</span></div>`;
    return;
  }
  document.title = DB.league.fullName ? `${DB.league.name} · ${DB.league.fullName}` : DB.league.name;
  document.getElementById('brand-name').textContent = DB.league.name;
  document.getElementById('brand-full').textContent = DB.league.fullName || '';
  document.getElementById('footer-text').textContent = `${DB.league.fullName || DB.league.name} · ${DB.league.season} Season`;
  window.addEventListener('hashchange', router);
  router();
})();
