// Page rendering and hash routing for the public site.

const $app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function teamName(id) { return (DB.teamsById[id] || { name: id }).name; }
function teamColor(id) { return (DB.teamsById[id] || {}).color || '#888'; }
// Short display name (e.g. THU). Falls back to the team's ID, which never changes once games reference it.
function teamAbbr(id) { return (DB.teamsById[id] || {}).short || id; }
function teamLabel(id) {
  return `<span class="team-dot" style="background:${esc(teamColor(id))}"></span>${esc(teamName(id))}`;
}
// Dark text on light team colours (e.g. white), white text on dark ones.
function textOn(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1b1f24' : '#fff';
}
function teamTag(id) {
  return `<span class="team-tag" style="background:${esc(teamColor(id))};color:${textOn(teamColor(id))}">${esc(teamAbbr(id))}</span>`;
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

// ---------- seasons ----------

// The season a page shows: ?season= in the address, else the current season. Home always shows the current one.
function wantedSeason(route, params) {
  const s = params.get('season');
  return route === 'home' || !s || !(DB.leagueFile.seasons || []).includes(s) ? currentSeason() : s;
}

// Season dropdown for the page headers.
// Regular season or playoffs, from ?playoffs=1 in the address.
function viewPhase(params) {
  return params.get('playoffs') === '1' ? 'playoffs' : 'regular';
}
function phaseBadge(phase) {
  return phase === 'playoffs' ? ' <span class="badge playoffs">Playoffs</span>' : '';
}

// Season dropdown for the page headers: each season, then its playoffs ("2026", "2026 (Playoffs)").
function seasonPicker() {
  const phase = viewPhase(parseHash().params);
  const options = seasonList().flatMap(y => ['regular', 'playoffs'].map(ph =>
    `<option value="${esc(y)}|${ph}" ${y === DB.season && ph === phase ? 'selected' : ''}>${esc(y)}${ph === 'playoffs' ? ' (Playoffs)' : ''}</option>`));
  return `<label class="season-pick">Season <select id="f-season">${options.join('')}</select></label>`;
}
document.addEventListener('change', e => {
  if (e.target.id !== 'f-season') return;
  const { route, arg, params } = parseHash();
  const p = new URLSearchParams(params);
  const [season, phase] = e.target.value.split('|');
  if (season === currentSeason()) p.delete('season'); else p.set('season', season);
  if (phase === 'playoffs') p.set('playoffs', '1'); else p.delete('playoffs');
  p.delete('month'); // a calendar month belongs to the old view
  const q = p.toString();
  location.hash = `#/${route}${arg ? '/' + encodeURIComponent(arg) : ''}${q ? '?' + q : ''}`;
});

// While viewing a past season or the playoffs, every link keeps ?season= / ?playoffs=1 so moving between
// pages stays in that view. Home always shows the current regular season.
function seasonLinks() {
  if (!DB.leagueFile) return;
  const { route, params } = parseHash();
  const carry = {};
  if (DB.season !== currentSeason()) carry.season = DB.season;
  if (route !== 'home' && viewPhase(params) === 'playoffs') carry.playoffs = '1';
  const keys = Object.keys(carry);
  const withCarry = path => {
    const [p0, q = ''] = path.split('?');
    const p = new URLSearchParams(q);
    for (const k of keys) p.set(k, carry[k]);
    return `${p0}?${p}`;
  };
  document.querySelectorAll('.site-nav a').forEach(a => {
    const r = a.dataset.route;
    a.setAttribute('href', r === 'home' ? '#/' : keys.length ? withCarry(`#/${r}`) : `#/${r}`);
  });
  if (!keys.length) return;
  $app.querySelectorAll('a[href^="#/"]').forEach(a => {
    const href = a.getAttribute('href');
    if (href === '#/' || href.startsWith('#/admin') || a.hasAttribute('data-keep')) return;
    const p = new URLSearchParams(href.split('?')[1] || '');
    if (keys.every(k => p.get(k) === carry[k])) return;
    a.setAttribute('href', withCarry(href));
  });
}
new MutationObserver(seasonLinks).observe($app, { childList: true, subtree: true });

async function router() {
  const hash = location.hash;
  const { route, arg, params } = parseHash();
  document.querySelectorAll('.site-nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route || (route === 'team' && a.dataset.route === 'rosters')));
  document.getElementById('site-nav').classList.remove('open');
  document.querySelector('.nav-toggle').setAttribute('aria-expanded', 'false');
  if (route !== 'admin') {
    const season = wantedSeason(route, params);
    if (season !== DB.season) {
      $app.innerHTML = '<p class="muted">Loading…</p>';
      try {
        await loadSeason(season);
      } catch (e) {
        $app.innerHTML = `<div class="notice"><strong>Could not load the ${esc(season)} season.</strong><br>${esc(e.message)}</div>`;
        return;
      }
      if (location.hash !== hash) return; // the visitor moved on while it loaded
      applyLeagueInfo();
    }
  }
  const fn = routes[route] || renderNotFound;
  try {
    fn(arg, params);
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="notice"><strong>Something went wrong showing this page.</strong><br>${esc(e.message)}</div>`;
  }
  seasonLinks();
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
  { key: 'bb', label: 'BB', value: r => r.bb },
  { key: 'so', label: 'SO', value: r => r.so },
  { key: 'sf', label: 'SF', value: r => r.sf },
  { key: 'avg', label: 'AVG', value: r => r.avg, display: r => fmt.avg(r.avg) },
  { key: 'obp', label: 'OBP', value: r => r.obp, display: r => fmt.avg(r.obp) },
  { key: 'slg', label: 'SLG', value: r => r.slg, display: r => fmt.avg(r.slg) },
  { key: 'ops', label: 'OPS', value: r => r.ops, display: r => fmt.avg(r.ops) },
];
// ---------- shared pieces ----------

// Small print under a game: doubleheader / length, notes.
function gameInfo(g) {
  const dh = DB.doubleheaders.get(g.id);
  const inn = scheduledInnings(g);
  const len = dh ? `Doubleheader, Game ${dh.game} (${inn} inn.)` : (inn !== defaultInnings(g) ? `${inn} innings` : '');
  return [gamePhase(g) === 'playoffs' ? 'Playoffs' : '', len, g.notes].filter(Boolean).join(' · ');
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
       <th>RS</th><th>RA</th><th>DIFF</th><th>L10</th><th>STRK</th>`;
  const body = rows.map(r => {
    const name = `<a href="#/team/${encodeURIComponent(r.team.id)}">${teamLabel(r.team.id)}</a>`;
    return compact
      ? `<tr><td class="l">${name}</td><td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}<td>${fmt.pct(r.pct)}</td><td>${fmt.gb(r.gb)}</td></tr>`
      : `<tr><td class="l">${name}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}
         <td>${fmt.pct(r.pct)}</td><td>${fmt.gb(r.gb)}</td><td>${r.rs}</td><td>${r.ra}</td>
         <td class="${r.diff > 0 ? 'result-w' : r.diff < 0 ? 'result-l' : ''}">${fmt.diff(r.diff)}</td>
         <td>${r.last10}</td><td>${r.streak}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- leaders ----------

const LEADER_CATS = [
  { key: 'avg', label: 'Batting Average', value: s => s.avg, show: s => fmt.avg(s.avg), qualified: true },
  { key: 'hr', label: 'Home Runs', value: s => s.hr },
  { key: 'h', label: 'Hits', value: s => s.h },
  { key: 'r', label: 'Runs', value: s => s.r },
  { key: 'xbh', label: 'Extra-Base Hits', value: s => s.xbh },
  { key: 'obp', label: 'On-Base Pct', value: s => s.obp, show: s => fmt.avg(s.obp), qualified: true },
  { key: 'slg', label: 'Slugging Pct', value: s => s.slg, show: s => fmt.avg(s.slg), qualified: true },
  { key: 'ops', label: 'OPS', value: s => s.ops, show: s => fmt.avg(s.ops), qualified: true },
  { key: '2b', label: 'Doubles', value: s => s['2b'] },
  { key: '3b', label: 'Triples', value: s => s['3b'] },
  { key: 'bb', label: 'Walks', value: s => s.bb },
  { key: 'tb', label: 'Total Bases', value: s => s.tb },
];

function topN(list, cat, n, isQualified) {
  const pool = (cat.qualified ? list.filter(isQualified) : list).filter(s => cat.value(s) > 0);
  const sorted = [...pool].sort((a, b) => cat.value(b) - cat.value(a) ||
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
  const homeCats = ['avg', 'hr', 'h', 'r', 'obp', 'ops'].map(k => LEADER_CATS.find(c => c.key === k));

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
      ${homeCats.map(c => leaderCard(stats.batting, c, 3, q.batter)).join('')}
    </div>`;
}

function renderSchedule(_, params) {
  const phase = viewPhase(params);
  const team = params.get('team') || '';
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const show = params.get('show') || 'all';
  const today = todayISO();
  let games = sortedGames().filter(g => gamePhase(g) === phase && (!team || g.home === team || g.away === team));

  // Team record summary when filtered
  let summary = '';
  if (team) {
    const row = computeStandings(phase).find(r => r.team.id === team);
    if (row) summary = `<p class="muted">${esc(teamName(team))}: ${row.w}-${row.l}${row.t ? '-' + row.t : ''} · RS ${row.rs} · RA ${row.ra}</p>`;
  }

  let content;
  if (view === 'calendar') {
    content = calendarView(games, params.get('month'));
  } else {
    if (show === 'results') games = games.filter(isFinal).reverse();
    if (show === 'upcoming') games = games.filter(g => !isFinal(g) && (g.date || '') >= today);
    content = gameList(games) || `<div class="empty">${phase === 'playoffs' && !team && show === 'all' ? 'No playoff games scheduled yet.' : 'No games to show.'}</div>`;
  }

  $app.innerHTML = `
    <div class="page-head"><h1>Schedule &amp; Results${phaseBadge(phase)}</h1>
      <div class="controls">
        ${seasonPicker()}
        <select id="f-team">${teamOptions(team)}</select>
        <div class="seg" id="f-view">
          ${['list', 'calendar'].map(v => `<button data-v="${v}" class="${v === view ? 'active' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
        ${view === 'list' ? `<div class="seg" id="f-show">
          ${['all', 'results', 'upcoming'].map(s => `<button data-v="${s}" class="${s === show ? 'active' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </div>` : ''}
      </div>
    </div>
    ${summary}
    ${content}`;

  const update = changes => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v && v !== 'all' && v !== 'list' ? p.set(k, v) : p.delete(k);
    setParams(p);
    renderSchedule(_, p);
  };
  document.getElementById('f-team').onchange = e => update({ team: e.target.value });
  document.querySelectorAll('#f-view button').forEach(b => (b.onclick = () => update({ view: b.dataset.v, month: '' })));
  document.querySelectorAll('#f-show button').forEach(b => (b.onclick = () => update({ show: b.dataset.v })));
  document.querySelectorAll('[data-month]').forEach(b => (b.onclick = () => update({ month: b.dataset.month })));
}

function gameList(games) {
  const byDate = new Map();
  for (const g of games) {
    const k = g.date || 'TBD';
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(g);
  }
  return [...byDate].map(([d, gs]) => `<div class="day"><h3>${esc(fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</h3>
    ${gs.map(g => gameRow(g)).join('')}</div>`).join('');
}

// Month to open the calendar on: this month if it has games, else the next month with games, else the last one.
function defaultMonth(games) {
  const now = todayISO().slice(0, 7);
  const months = [...new Set(games.map(g => (g.date || '').slice(0, 7)).filter(Boolean))].sort();
  if (!months.length || months.includes(now)) return now;
  return months.find(m => m > now) || months[months.length - 1];
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function calendarView(games, monthParam) {
  const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : defaultMonth(games);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayISO();
  const byDate = new Map();
  for (const g of games) {
    if (!(g.date || '').startsWith(month)) continue;
    if (!byDate.has(g.date)) byDate.set(g.date, []);
    byDate.get(g.date).push(g);
  }

  const chip = g => {
    const st = g.status || 'scheduled';
    const final = isFinal(g);
    const as = num(g.awayScore), hs = num(g.homeScore);
    const side = (id, score, win) => `<span class="${final && win ? 'cal-win' : ''}"><span class="team-dot" style="background:${esc(teamColor(id))}"></span>${esc(teamAbbr(id))}${final ? ` ${score}` : ''}</span>`;
    const meta = final ? `${finalLabel(g)}${g.mercy ? ' · Mercy' : ''}` : st === 'scheduled' ? (fmtTime(g.time) || 'TBD') : st[0].toUpperCase() + st.slice(1);
    return `<a class="cal-game ${st}" href="#/game/${encodeURIComponent(g.id)}" title="${esc(`${teamName(g.away)} @ ${teamName(g.home)}`)}">
      <span class="cal-meta">${esc(meta)}</span>${side(g.away, as, as > hs)} @ ${side(g.home, hs, hs > as)}</a>`;
  };

  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<div class="cal-day other"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const gs = byDate.get(iso) || [];
    cells.push(`<div class="cal-day ${iso === today ? 'today' : ''} ${gs.length ? 'has-games' : ''}">
      <span class="cal-num">${d}</span>
      ${gs.map(chip).join('')}
      ${gs.length ? `<span class="cal-dots">${gs.map(() => '<i></i>').join('')}</span>` : ''}
    </div>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-day other"></div>');

  const monthGames = [...byDate.values()].flat();
  return `<section class="card">
    <div class="cal-nav">
      <button class="btn secondary" data-month="${shiftMonth(month, -1)}" aria-label="Previous month">‹</button>
      <h2>${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2>
      <button class="btn secondary" data-month="${shiftMonth(month, 1)}" aria-label="Next month">›</button>
    </div>
    <div class="cal">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="cal-head">${w}</div>`).join('')}
      ${cells.join('')}
    </div>
    ${monthGames.length ? '' : '<p class="muted" style="text-align:center;margin-bottom:0">No games this month.</p>'}
  </section>
  ${monthGames.length ? `<div class="cal-list">${gameList(monthGames)}</div>` : ''}`;
}

function renderStandings(_, params) {
  const phase = viewPhase(params);
  const head = `<div class="page-head"><h1>Standings${phaseBadge(phase)}</h1>
      <div class="controls">${seasonPicker()}</div></div>`;
  if (phase === 'playoffs') {
    // Playoff records for the teams that have played; games behind and streaks don't apply.
    const rows = computeStandings('playoffs').filter(r => r.gp);
    const anyTies = rows.some(r => r.t);
    $app.innerHTML = `${head}
      ${rows.length ? `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th class="l">Team</th><th>GP</th><th>W</th><th>L</th>${anyTies ? '<th>T</th>' : ''}<th>RS</th><th>RA</th><th>DIFF</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td class="l"><a href="#/team/${encodeURIComponent(r.team.id)}">${teamLabel(r.team.id)}</a></td>
          <td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}<td>${r.rs}</td><td>${r.ra}</td>
          <td class="${r.diff > 0 ? 'result-w' : r.diff < 0 ? 'result-l' : ''}">${fmt.diff(r.diff)}</td></tr>`).join('')}</tbody>
      </table></div></div>
      <p class="muted small">Playoff records only · RS/RA = runs scored/allowed. See every playoff game on the
        <a href="#/schedule">schedule</a>.</p>` : '<div class="empty">No playoff games played yet.</div>'}`;
    return;
  }
  $app.innerHTML = `${head}
    <div class="card">${standingsTable(computeStandings())}</div>
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
        <thead><tr><th>#</th><th class="l">Name</th></tr></thead>
        <tbody>${roster.map(p => `<tr><td>${esc(p.number ?? '')}</td><td class="l">${playerLink(p.id)}</td>
          </tr>`).join('') ||
          '<tr><td colspan="4" class="l muted">No players listed.</td></tr>'}</tbody>
      </table></div></section>`;
  };

  $app.innerHTML = `
    <div class="page-head"><h1>Rosters</h1>
      <div class="controls">${seasonPicker()}<select id="f-team">${teamOptions(selected)}</select></div></div>
    <div class="grid grid-2">${(selected ? teams.filter(t => t.id === selected) : teams).map(teamCard).join('')}</div>`;
  document.getElementById('f-team').onchange = e => {
    const season = DB.season !== currentSeason() ? `?season=${encodeURIComponent(DB.season)}` : '';
    location.hash = (e.target.value ? `#/team/${encodeURIComponent(e.target.value)}` : '#/rosters') + season;
  };
}

function renderStats(_, params) {
  const team = params.get('team') || '';
  const qualOnly = params.get('qual') === '1';
  const cols = BAT_COLS;
  const sortKey = cols.some(c => c.key === params.get('sort')) ? params.get('sort') : 'avg';
  const sortDesc = params.has('dir') ? params.get('dir') !== 'asc' : (cols.find(c => c.key === sortKey).desc !== false);

  const phase = viewPhase(params);
  const stats = computePlayerStats({ team: team || null, phase });
  const q = qualifiers(phase);
  let rows = stats.batting;
  if (qualOnly) rows = rows.filter(q.batter);

  $app.innerHTML = `
    <div class="page-head"><h1>Stats${phaseBadge(phase)}</h1>
      <div class="controls">
        ${seasonPicker()}
        <select id="f-team">${teamOptions(team)}</select>
        <label class="check"><input type="checkbox" id="f-qual" ${qualOnly ? 'checked' : ''}> Qualified only</label>
      </div>
    </div>
    <div class="card">${sortableTable('stats-table', cols, rows, { sortKey, sortDesc, rank: true })}</div>
    <p class="muted small">Click a column header to sort. Qualified = at least ${q.paPerGame} plate appearances per team game.</p>`;

  const update = changes => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? p.set(k, v) : p.delete(k);
    setParams(p);
    renderStats(_, p);
  };
  document.getElementById('f-team').onchange = e => update({ team: e.target.value });
  document.getElementById('f-qual').onchange = e => update({ qual: e.target.checked ? '1' : '' });
  bindSort('stats-table', cols, { sortKey, sortDesc }, (key, desc) => update({ sort: key, dir: desc ? 'desc' : 'asc' }));
}

function renderLeaders(_, params) {
  const phase = viewPhase(params);
  const team = params.get('team') || '';
  const stats = computePlayerStats({ team: team || null, phase });
  const q = qualifiers(phase);
  $app.innerHTML = `
    <div class="page-head"><h1>League Leaders${phaseBadge(phase)}</h1>
      <div class="controls">${seasonPicker()}<select id="f-team">${teamOptions(team)}</select></div></div>
    <div class="grid grid-3">${LEADER_CATS.map(c => leaderCard(stats.batting, c, 5, q.batter)).join('')}</div>
    <p class="muted small" style="margin-top:1rem">Rate stats (AVG, OBP, SLG, OPS) require ${q.paPerGame} plate appearances per team game.</p>`;
  document.getElementById('f-team').onchange = e => {
    const p = new URLSearchParams(params);
    if (e.target.value) p.set('team', e.target.value); else p.delete('team');
    setParams(p); renderLeaders(_, p);
  };
}

function boxBattingTable(g, team) {
  const lines = (g.batting || []).filter(l => lineTeam(l) === team);
  const tot = emptyBat();
  lines.forEach(l => addBatLine(tot, l));
  const cols = ['ab', 'r', 'h', '2b', '3b', 'hr', 'bb', 'so', 'sf'];
  return `<div class="table-wrap"><table>
    <thead><tr><th class="l">${esc(teamName(team))} Batting</th>${cols.map(c => `<th>${c.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${lines.map(l => `<tr><td class="l">${playerLink(l.player)}</td>${cols.map(c => `<td>${num(l[c])}</td>`).join('')}</tr>`).join('') ||
      `<tr><td class="l muted" colspan="${cols.length + 1}">No batting stats entered.</td></tr>`}</tbody>
    <tfoot><tr><td class="l">Totals</td>${cols.map(c => `<td>${tot[c]}</td>`).join('')}</tr></tfoot>
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
      <section class="card">${boxBattingTable(g, g.away)}</section>
      <section class="card">${boxBattingTable(g, g.home)}</section>` : `<div class="empty">No box score has been entered for this game.</div>`}`;
}

function renderPlayer(id, params) {
  const phase = viewPhase(params);
  const p = DB.playersById[id];
  const log = playerGameLog(id, phase);
  if (!p && !log.length) return renderNotFound();
  const all = computePlayerStats({ phase });
  const bat = all.batting.find(s => s.player === id);
  const name = p ? p.name : id;
  const statCols = (cols, row) => {
    const use = cols.filter(c => c.key !== 'name' && c.key !== 'team');
    return `<div class="table-wrap"><table><thead><tr>${use.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody><tr>${use.map(c => `<td>${c.display ? c.display(row) : esc(c.value(row))}</td>`).join('')}</tr></tbody></table></div>`;
  };
  const opp = e => (e.game.home === e.team ? `vs ${teamAbbr(e.game.away)}` : `@ ${teamAbbr(e.game.home)}`);
  const res = e => {
    const us = e.game.home === e.team ? num(e.game.homeScore) : num(e.game.awayScore);
    const them = e.game.home === e.team ? num(e.game.awayScore) : num(e.game.homeScore);
    const r = us > them ? 'W' : us < them ? 'L' : 'T';
    const extra = e.game.mercy ? ' (mercy)' : finalLabel(e.game) !== 'Final' ? ` (${finalLabel(e.game).slice(6)})` : '';
    return `<a href="#/game/${encodeURIComponent(e.game.id)}" class="${r === 'W' ? 'result-w' : r === 'L' ? 'result-l' : ''}">${r} ${us}-${them}</a>${extra}`;
  };
  const batLog = log.filter(e => e.bat);
  // Link to the player's other view: their playoff stats, or back to the regular season.
  const otherParams = new URLSearchParams(params);
  if (phase === 'playoffs') otherParams.delete('playoffs'); else otherParams.set('playoffs', '1');
  const otherHref = `#/player/${encodeURIComponent(id)}${otherParams.toString() ? '?' + otherParams : ''}`;
  const otherView = phase === 'playoffs'
    ? `<p><a href="${esc(otherHref)}" data-keep>&larr; Regular season stats</a></p>`
    : playerGameLog(id, 'playoffs').length ? `<p><a href="${esc(otherHref)}" data-keep>Playoff stats &rarr;</a></p>` : '';

  $app.innerHTML = `
    <section class="card">
      <h1>${p && p.number !== undefined && p.number !== '' ? `<span class="muted">#${esc(p.number)}</span> ` : ''}${esc(name)}</h1>
      ${p ? `<p class="muted" style="margin:0">${teamLabel(p.team)} · <a href="#/team/${encodeURIComponent(p.team)}">Roster</a>
</p>` : ''}
    </section>
    ${otherView}
    ${bat ? `<section class="card"><h2>${esc(DB.season)} ${phase === 'playoffs' ? 'Playoffs' : 'Batting'}</h2>${statCols(BAT_COLS, bat)}</section>`
      : `<div class="empty">No ${phase === 'playoffs' ? 'playoff ' : ''}stats recorded yet.</div>`}
    ${batLog.length ? `<section class="card"><h2>Game Log${phaseBadge(phase)}</h2><div class="table-wrap"><table>
      <thead><tr><th class="l">Date</th><th class="l">Opp</th><th class="l">Result</th>${['AB', 'R', 'H', '2B', '3B', 'HR', 'BB', 'SO', 'SF'].map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${batLog.slice().reverse().map(e => `<tr><td class="l">${esc(fmtDate(e.game.date, { month: 'short', day: 'numeric' }))}</td>
        <td class="l">${esc(opp(e))}</td><td class="l">${res(e)}</td>
        ${['ab', 'r', 'h', '2b', '3b', 'hr', 'bb', 'so', 'sf'].map(k => `<td>${num(e.bat[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></section>` : ''}`;
}

// ---------- boot ----------

document.querySelector('.nav-toggle').addEventListener('click', e => {
  const nav = document.getElementById('site-nav');
  nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
});

// League name and season in the header, footer and browser tab.
function applyLeagueInfo() {
  document.title = DB.league.fullName ? `${DB.league.name} · ${DB.league.fullName}` : DB.league.name;
  document.getElementById('brand-name').textContent = DB.league.name;
  document.getElementById('brand-full').textContent = DB.league.fullName || '';
  document.getElementById('footer-text').textContent = `${DB.league.fullName || DB.league.name} · ${DB.league.season} Season`;
}

(async function init() {
  try {
    await loadData();
  } catch (e) {
    $app.innerHTML = `<div class="notice"><strong>Could not load league data.</strong><br>${esc(e.message)}
      <br><span class="small">If you just edited a data file, check it for a typo (a missing comma or quote is the usual culprit).</span></div>`;
    return;
  }
  applyLeagueInfo();
  window.addEventListener('hashchange', router);
  router();
})();
