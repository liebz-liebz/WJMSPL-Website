// League admin: enter game results / box scores, edit the schedule and rosters, and save
// the data files to the website.
//
// How saving works without everyone needing a GitHub account: the site owner sets up a GitHub
// access token once. It is stored in data/admin.json, encrypted with the admin password.
// Anyone who knows the password can unlock it in their browser and save changes.

const SESSION_KEY = 'wjmspl-admin-session';
const PBKDF2_ITERATIONS = 600000;

const admin = {
  creds: null, // { token, owner, repo, branch } once unlocked
  ready: false,
  loadError: null,
  tab: 'games',
  games: [],
  players: [],
  loadedPlayersJSON: '',
  dirtyGames: new Set(),
  deletedGames: new Set(),
  playersDirty: false,
  currentGameId: null,
  rosterTeam: '',
  message: null, // { kind: 'ok' | 'info' | '', html }
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- sign-in session ----------

function restoreSession() {
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      const c = JSON.parse(window[store].getItem(SESSION_KEY));
      if (c && c.token) return c;
    } catch { /* storage blocked */ }
  }
  return null;
}
function storeSession(creds, remember) {
  try { window[remember ? 'localStorage' : 'sessionStorage'].setItem(SESSION_KEY, JSON.stringify(creds)); } catch { /* storage blocked */ }
}
function clearSession() {
  for (const store of ['sessionStorage', 'localStorage']) {
    try { window[store].removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  }
}
function signOut() {
  if (hasUnsaved() && !confirm('You have unsaved changes. Sign out anyway?')) return;
  clearSession();
  admin.creds = null;
  admin.ready = false;
  admin.dirtyGames.clear();
  admin.deletedGames.clear();
  admin.playersDirty = false;
  admin.teamsDirty = false;
  admin.message = null;
  admin.tab = 'games';
  renderAdmin();
}

function initAdminData(games, players) {
  admin.games = clone(games);
  admin.players = clone(players);
  admin.loadedPlayersJSON = JSON.stringify(players);
  initTeamsDraft();
  admin.currentGameId = defaultGameId();
  admin.ready = true;
}

// The most recent game that still needs a result, else the latest game played, else the first game.
function defaultGameId() {
  const today = todayISO();
  const sorted = sortedAdminGames();
  const pending = sorted.filter(g => g.status !== 'final' && g.status !== 'cancelled' && (g.date || '') <= today);
  return (pending[pending.length - 1] || sorted.filter(isFinal).pop() || sorted[0] || {}).id || null;
}

// Load the latest data straight from GitHub so admins never edit a stale copy of the site.
async function loadAdminData() {
  admin.loadError = null;
  try {
    const [games, players, league] = await Promise.all(['data/games.json', 'data/players.json', 'data/league.json']
      .map(async p => JSON.parse((await ghReadFile(admin.creds, p)).text)));
    setData(league, players, games);
    applyLeagueInfo();
    initAdminData(games, players);
  } catch (e) {
    admin.loadError = e.message;
    initAdminData(DB.games, DB.players);
  }
}

window.addEventListener('beforeunload', e => {
  if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
});

function hasUnsaved() {
  return admin.dirtyGames.size > 0 || admin.deletedGames.size > 0 || admin.playersDirty || admin.teamsDirty;
}
function sortedAdminGames() {
  return [...admin.games].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}
function currentGame() { return admin.games.find(g => g.id === admin.currentGameId); }

// ---------- page ----------

async function renderAdmin() {
  if (!admin.creds) admin.creds = restoreSession();
  if (!admin.creds) return renderSignIn();
  if (!admin.ready) {
    $app.innerHTML = '<p class="muted">Loading the latest league data…</p>';
    await loadAdminData();
    if (parseHash().route !== 'admin') return;
  }
  const tabs = [['games', 'Results'], ['schedule', 'Schedule'], ['rosters', 'Rosters'], ['teams', 'Teams'], ['settings', 'Settings']];
  $app.innerHTML = `
    <div class="admin">
      <div class="page-head"><h1>League Admin</h1>
        <div class="controls">
          <div class="seg" id="admin-tabs">${tabs.map(([k, l]) =>
            `<button data-tab="${k}" class="${admin.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
          <button class="btn secondary" id="sign-out">Sign out</button>
        </div>
      </div>
      ${admin.loadError ? `<div class="notice"><strong>Couldn't connect to GitHub, so saving won't work right now.</strong><br>
        ${esc(admin.loadError)}<br><span class="small">If the GitHub token has expired, the site owner can enter a new one under
        <a href="#" data-goto="settings">Settings</a>.</span></div>` : ''}
      <div id="admin-msg">${admin.message ? `<div class="notice ${admin.message.kind}">${admin.message.html}</div>` : ''}</div>
      <div id="admin-body"></div>
    </div>`;
  document.querySelectorAll('#admin-tabs button').forEach(b => (b.onclick = () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(a => (a.onclick = e => { e.preventDefault(); switchTab(a.dataset.goto); }));
  document.getElementById('sign-out').onclick = signOut;
  renderCurrentTab();
}

async function renderSignIn() {
  $app.innerHTML = '<p class="muted">Loading…</p>';
  let lock = null;
  try {
    lock = await fetchJSON('data/admin.json');
  } catch (e) {
    if (!/\(404\)/.test(e.message)) {
      $app.innerHTML = `<div class="notice"><strong>Couldn't load the admin settings.</strong><br>${esc(e.message)}</div>`;
      return;
    }
  }
  if (parseHash().route !== 'admin') return;
  if (!lock || !lock.data) return renderFirstSetup();

  $app.innerHTML = `
    <section class="card narrow">
      <h1>League Admin</h1>
      <p class="muted">Enter the admin password to update scores, stats, the schedule and rosters.</p>
      <form id="signin" class="form-stack">
        <label class="field">Password<input type="password" id="pw" autocomplete="current-password" required autofocus></label>
        <label class="check"><input type="checkbox" id="remember" checked> Keep me signed in on this device</label>
        <div id="signin-msg"></div>
        <button class="btn" type="submit">Sign in</button>
      </form>
      <p class="muted small">Don't have the password? Ask the league organizer.</p>
    </section>`;
  document.getElementById('signin').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const creds = await decryptCreds(lock, document.getElementById('pw').value);
      admin.creds = creds;
      storeSession(creds, document.getElementById('remember').checked);
      renderAdmin();
    } catch {
      document.getElementById('signin-msg').innerHTML = '<p class="warn">Wrong password. Try again.</p>';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  };
}

// Shown only until the site owner has set an admin password.
function renderFirstSetup() {
  const gh = DB.league.github || {};
  $app.innerHTML = `
    <section class="card narrow">
      <h1>Set up League Admin</h1>
      <p>This is a one-time setup for the site owner. It connects the admin page to GitHub (where the website is stored)
        and sets the password everyone else will use. After this, entering results needs only the password, not a GitHub account.</p>
      <h2>1. Create a GitHub token</h2>
      <ol>
        <li>Signed in to GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">New fine-grained token</a>.</li>
        <li>Name it “League website” and choose the longest expiration allowed.</li>
        <li><strong>Repository access:</strong> <em>Only select repositories</em> → <code>${esc(gh.owner)}/${esc(gh.repo)}</code>.</li>
        <li><strong>Permissions → Repository permissions → Contents:</strong> <em>Read and write</em>.</li>
        <li>Click <strong>Generate token</strong> and copy it.</li>
      </ol>
      <h2>2. Connect and choose the admin password</h2>
      <form id="setup" class="form-stack">
        <label class="field">GitHub token<input type="password" id="su-token" placeholder="github_pat_…" autocomplete="off" required></label>
        <div class="form-grid">
          <label>Repository owner<input type="text" id="su-owner" value="${esc(gh.owner || '')}" required></label>
          <label>Repository name<input type="text" id="su-repo" value="${esc(gh.repo || '')}" required></label>
          <label>Branch<input type="text" id="su-branch" value="${esc(gh.branch || 'main')}" required></label>
        </div>
        <div class="form-grid">
          <label>Admin password<input type="password" id="su-pw" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm password<input type="password" id="su-pw2" autocomplete="new-password" required></label>
        </div>
        <div id="setup-msg"></div>
        <button class="btn" type="submit">Connect &amp; save</button>
      </form>
      <p class="muted small">Pick a password that's hard to guess (e.g. three or four random words). It's the only thing protecting the
        site's data from edits. If it ever leaks, change it under Settings. Every save is recorded on GitHub, so anything can be undone.</p>
    </section>`;
  document.getElementById('setup').onsubmit = async e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value.trim();
    const msg = document.getElementById('setup-msg');
    if (v('su-pw') !== v('su-pw2')) { msg.innerHTML = '<p class="warn">The passwords don\'t match.</p>'; return; }
    const creds = { token: v('su-token'), owner: v('su-owner'), repo: v('su-repo'), branch: v('su-branch') };
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    msg.innerHTML = '<p class="muted">Connecting…</p>';
    try {
      await saveLockFile(creds, v('su-pw'), 'Set up league admin password');
      admin.creds = creds;
      storeSession(creds, true);
      admin.message = { kind: 'ok', html: '<strong>All set!</strong> Share the website link and the admin password with whoever enters results. They sign in using <em>League admin</em> at the bottom of any page.' };
      renderAdmin();
    } catch (err) {
      msg.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
      btn.disabled = false;
    }
  };
}

function renderCurrentTab() {
  ({ games: renderGamesTab, schedule: renderScheduleTab, rosters: renderRostersTab, teams: renderTeamsTab, settings: renderSettingsTab })[admin.tab]();
}

function switchTab(tab) {
  if (admin.tab === 'games') collectGameForm();
  admin.tab = tab;
  admin.message = null;
  renderAdmin();
}

function showMessage(html, kind = '') {
  admin.message = { html, kind };
  const el = document.getElementById('admin-msg');
  if (el) {
    el.innerHTML = `<div class="notice ${kind}">${html}</div>`;
    el.scrollIntoView({ block: 'nearest' });
  }
}

// kind: 'games' (games.json), 'players' (players.json) or 'teams' (league.json)
function dirtyCount(kind) {
  if (kind === 'games') return admin.dirtyGames.size + admin.deletedGames.size;
  return (kind === 'players' ? admin.playersDirty : admin.teamsDirty) ? 1 : 0;
}
function dirtyText(kind) {
  const n = dirtyCount(kind);
  if (!n) return 'No unsaved changes';
  return `Unsaved: ${{ games: `${n} game${n === 1 ? '' : 's'} changed`, players: 'Roster changed', teams: 'Teams changed' }[kind]}`;
}
function saveBar(kind) {
  const n = dirtyCount(kind);
  const file = { games: 'games', players: 'players', teams: 'league' }[kind];
  return `<div class="save-bar">
    <button class="btn" id="save-gh" ${n ? '' : 'disabled'}>Save to website</button>
    <button class="btn secondary" id="save-dl">Download ${file}.json</button>
    <span class="${n ? 'warn' : 'muted'}" id="dirty-label">${dirtyText(kind)}</span>
  </div>`;
}
function refreshDirtyLabel(kind) {
  const el = document.getElementById('dirty-label');
  const btn = document.getElementById('save-gh');
  if (!el) return;
  const n = dirtyCount(kind);
  el.className = n ? 'warn' : 'muted';
  el.textContent = dirtyText(kind);
  btn.disabled = !n;
}

// ---------- games tab ----------

function gameLabel(g) {
  const score = isFinal(g) ? ` ${num(g.awayScore)}-${num(g.homeScore)}${g.mercy ? ', mercy' : ''}` : '';
  const st = g.status && g.status !== 'scheduled' ? ` (${g.status}${score})` : '';
  return `${g.date || 'TBD'} · ${teamName(g.away)} @ ${teamName(g.home)}${st}${admin.dirtyGames.has(g.id) ? ' *' : ''}`;
}

function renderGamesTab() {
  if (!currentGame()) admin.currentGameId = defaultGameId();
  const games = sortedAdminGames();
  const g = currentGame();
  const body = document.getElementById('admin-body');
  body.innerHTML = `
    <div class="card">
      <div class="controls">
        <label class="field" style="flex:1;min-width:min(100%,320px)">Choose a game
          <select id="game-pick">${games.map(x => `<option value="${esc(x.id)}" ${x.id === admin.currentGameId ? 'selected' : ''}>${esc(gameLabel(x))}</option>`).join('')}</select>
        </label>
      </div>
      <p class="muted small" style="margin:.5rem 0 0">To add, reschedule or delete games, use the <a href="#" data-goto="schedule">Schedule</a> tab.</p>
    </div>
    ${g ? gameForm(g) : '<div class="empty">No games on the schedule yet. Add them in the <a href="#" data-goto="schedule">Schedule</a> tab.</div>'}
    ${saveBar('games')}`;

  document.getElementById('game-pick').onchange = e => {
    collectGameForm();
    admin.currentGameId = e.target.value;
    renderGamesTab();
  };
  document.querySelectorAll('#admin-body [data-goto]').forEach(a => (a.onclick = e => { e.preventDefault(); switchTab(a.dataset.goto); }));
  document.getElementById('save-gh').onclick = saveGamesToGitHub;
  document.getElementById('save-dl').onclick = () => {
    collectGameForm();
    download('games.json', serializeGames(mergeGames(DB.games)));
  };
  if (!g) return;

  const form = document.getElementById('game-form');
  form.addEventListener('input', e => {
    if (e.target.id === 'g-innings') e.target.dataset.explicit = '1';
    collectGameForm();
    updateChecks();
  });
  form.addEventListener('change', () => { collectGameForm(); updateChecks(); });
  document.getElementById('box-clear').onclick = () => {
    if (!confirm('Clear all batting stats for this game?')) return;
    form.querySelectorAll('input[data-kind]').forEach(i => (i.value = ''));
    form.querySelectorAll('select[data-kind]').forEach(s => (s.value = ''));
    collectGameForm();
    updateChecks();
  };
  updateChecks();
}

// Same rules as the public site, but using the admin's working copy (edits can create a doubleheader).
function defaultInningsAdmin(g) {
  const cfg = DB.league.scheduledInnings || {};
  const others = admin.games.filter(x => x.id !== g.id);
  return findDoubleheaders([...others, g]).has(g.id) ? (cfg.doubleheader ?? 6) : (cfg.singleGame ?? 9);
}
function scheduledInningsAdmin(g) {
  return num(g.innings) || defaultInningsAdmin(g);
}

function rosterFor(team, existingLines) {
  const ids = new Set();
  const out = [];
  // Players already in the box score keep their order, then the rest of the roster.
  for (const l of existingLines) if (lineTeam(l) === team && !ids.has(l.player)) { ids.add(l.player); out.push(l.player); }
  const roster = admin.players.filter(p => p.team === team && !ids.has(p.id))
    .sort((a, b) => num(a.number) - num(b.number));
  return out.concat(roster.map(p => p.id));
}
function adminPlayerName(id) {
  const p = admin.players.find(x => x.id === id) || DB.playersById[id];
  return p ? `${p.number !== undefined && p.number !== '' ? '#' + p.number + ' ' : ''}${p.name}` : id;
}

function battingInputs(g, team) {
  const lines = g.batting || [];
  const ids = rosterFor(team, lines);
  const cols = BAT_KEYS;
  return `<div class="table-wrap"><table>
    <thead><tr><th class="l">${esc(teamName(team))} batting</th>${cols.map(c => `<th>${c.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${ids.map(pid => {
      const l = lines.find(x => x.player === pid && lineTeam(x) === team) || {};
      return `<tr><td class="l">${esc(adminPlayerName(pid))}</td>${cols.map(k =>
        `<td><input class="stat-input" type="number" min="0" inputmode="numeric" data-kind="bat" data-team="${esc(team)}" data-player="${esc(pid)}" data-key="${k}" value="${l[k] ?? ''}"></td>`).join('')}</tr>`;
    }).join('') || `<tr><td class="l muted" colspan="${cols.length + 1}">No players on this roster yet — add them in the Rosters tab.</td></tr>`}</tbody>
    <tfoot><tr><td class="l">Totals</td>${cols.map(k => `<td data-total="${esc(team)}-${k}">0</td>`).join('')}</tr></tfoot>
  </table></div>`;
}

function gameForm(g) {
  const dh = findDoubleheaders(admin.games).get(g.id);
  return `<form id="game-form" onsubmit="return false">
    <section class="card">
      <h2 style="margin:0">${esc(teamName(g.away))} @ ${esc(teamName(g.home))}</h2>
      <p class="muted" style="margin:.25rem 0 0">${esc([fmtDate(g.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        fmtTime(g.time), dh ? `Doubleheader, game ${dh.game}` : '', g.type === 'playoff' ? 'Playoff' : ''].filter(Boolean).join(' · '))}</p>
    </section>
    <section class="card">
      <h2>Result</h2>
      <div class="form-grid">
        <label>Status<select id="g-status">
          ${['scheduled', 'final', 'postponed', 'cancelled'].map(s => `<option value="${s}" ${(g.status || 'scheduled') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select></label>
        <label>${esc(teamName(g.away))} runs<input type="number" min="0" id="g-ascore" value="${g.awayScore ?? ''}"></label>
        <label>${esc(teamName(g.home))} runs<input type="number" min="0" id="g-hscore" value="${g.homeScore ?? ''}"></label>
        <label>Scheduled innings<input type="number" min="1" id="g-innings" value="${scheduledInningsAdmin(g)}" ${g.innings ? 'data-explicit="1"' : ''}></label>
        <label>Innings played<input type="number" min="1" id="g-played" value="${g.inningsPlayed ?? ''}" placeholder="${scheduledInningsAdmin(g)}"></label>
        <label class="check" style="align-self:end;padding-bottom:.45rem"><input type="checkbox" id="g-mercy" ${g.mercy ? 'checked' : ''}> Mercy rule</label>
        <label style="grid-column:1/-1">Notes (shown on schedule)<input type="text" id="g-notes" value="${esc(g.notes || '')}" placeholder="e.g. Shortened to 5 innings (rain)"></label>
      </div>
      <p class="muted small">Doubleheader games (same two teams twice in one day) are scheduled for
        ${esc(String((DB.league.scheduledInnings || {}).doubleheader ?? 6))} innings, other games
        ${esc(String((DB.league.scheduledInnings || {}).singleGame ?? 9))}. Fill in <em>Innings played</em> only if the game
        was shortened (mercy, rain) or went to extra innings.
        Standings update from the final score alone. The box score below is optional, but it's what feeds player stats and leaders.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Box score</h2><button type="button" class="btn secondary" id="box-clear">Clear box score</button></div>
      <p class="muted small">Only fill in rows for players who played — blank rows are ignored. Type 0 where needed (e.g. a player who
        walked in their only plate appearance has AB 0, BB 1). </p>
      <div id="checks"></div>
      ${battingInputs(g, g.away)}
      <div style="height:1rem"></div>
      ${battingInputs(g, g.home)}
    </section>
  </form>`;
}

// Reads the form back into the working copy of the current game.
function collectGameForm() {
  const form = document.getElementById('game-form');
  const g = currentGame();
  if (!form || !g) return;
  const val = id => document.getElementById(id).value.trim();
  const before = JSON.stringify(g);

  // One line per player row with anything filled in; blank rows are skipped.
  const rows = new Map();
  form.querySelectorAll('[data-kind="bat"]').forEach(el => {
    const k = `${el.dataset.team}|${el.dataset.player}`;
    if (!rows.has(k)) rows.set(k, { team: el.dataset.team, player: el.dataset.player, vals: {} });
    rows.get(k).vals[el.dataset.key] = el.value.trim();
  });
  const batting = [];
  for (const r of rows.values()) {
    if (!BAT_KEYS.some(k => r.vals[k])) continue;
    const line = { player: r.player, team: r.team };
    for (const k of BAT_KEYS) line[k] = num(r.vals[k]);
    batting.push(line);
  }

  const known = ['id', 'date', 'time', 'location', 'away', 'home', 'type', 'innings', 'status', 'awayScore', 'homeScore',
    'inningsPlayed', 'mercy', 'notes', 'batting'];
  const extra = Object.fromEntries(Object.entries(g).filter(([k]) => !known.includes(k)));
  // Date, teams and type are edited on the Schedule tab. Location isn't tracked (one field), so it's dropped.
  const next = { id: g.id, date: g.date || '', time: g.time || '', away: g.away, home: g.home };
  if (g.type && g.type !== 'regular') next.type = g.type;
  // Only store a length when it differs from the league default for this kind of game.
  const inn = document.getElementById('g-innings');
  if (inn.dataset.explicit && num(inn.value) && num(inn.value) !== defaultInningsAdmin({ ...g, ...next })) next.innings = num(inn.value);
  next.status = val('g-status');
  if (val('g-ascore') !== '') next.awayScore = num(val('g-ascore'));
  if (val('g-hscore') !== '') next.homeScore = num(val('g-hscore'));
  if (num(val('g-played'))) next.inningsPlayed = num(val('g-played'));
  if (document.getElementById('g-mercy').checked) next.mercy = true;
  if (val('g-notes')) next.notes = val('g-notes');
  if (batting.length) next.batting = batting;
  Object.assign(next, extra);

  if (JSON.stringify(next) !== before) {
    for (const k of Object.keys(g)) delete g[k];
    Object.assign(g, next);
    admin.dirtyGames.add(g.id);
    refreshDirtyLabel('games');
    const opt = document.querySelector(`#game-pick option[value="${CSS.escape(g.id)}"]`);
    if (opt) opt.textContent = gameLabel(g);
  }
}

// Live sanity checks so typos get caught before saving.
function gameProblems(g) {
  const problems = [];
  if (!g.date) problems.push('No date set.');
  if (g.away === g.home) problems.push('Away and home team are the same.');
  if (g.status === 'final') {
    if (g.awayScore === undefined || g.homeScore === undefined) problems.push('Status is Final but the score is missing.');
  } else if (g.batting) {
    problems.push('Box score entered but status is not Final — stats only count once the game is marked Final.');
  }
  if (g.mercy && g.status !== 'final') problems.push('Mercy rule is checked but the game is not marked Final.');
  if (g.mercy && g.inningsPlayed && g.inningsPlayed > scheduledInningsAdmin(g)) problems.push('A mercy-rule game can\'t go longer than its scheduled innings.');
  if (!g.batting) return problems;
  for (const [team, score] of [[g.away, g.awayScore], [g.home, g.homeScore]]) {
    const bat = g.batting.filter(l => l.team === team);
    const runs = bat.reduce((sum, l) => sum + num(l.r), 0);
    if (bat.length && score !== undefined && runs !== num(score)) problems.push(`${teamName(team)}: batters' runs add up to ${runs}, but the score says ${num(score)}.`);
    for (const l of bat) {
      const xbh = num(l['2b']) + num(l['3b']) + num(l.hr);
      if (xbh > num(l.h)) problems.push(`${adminPlayerName(l.player)}: more extra-base hits than hits.`);
      if (num(l.h) > num(l.ab)) problems.push(`${adminPlayerName(l.player)}: more hits than at-bats.`);
    }
  }
  return problems;
}

function updateChecks() {
  const g = currentGame();
  const form = document.getElementById('game-form');
  if (!g || !form) return;
  // Batting totals row
  for (const team of [g.away, g.home]) {
    for (const k of BAT_KEYS) {
      const cell = form.querySelector(`[data-total="${CSS.escape(team)}-${k}"]`);
      if (cell) cell.textContent = (g.batting || []).filter(l => l.team === team).reduce((s, l) => s + num(l[k]), 0);
    }
  }
  const problems = gameProblems(g);
  document.getElementById('checks').innerHTML = problems.length
    ? `<div class="notice"><strong>Double-check:</strong><ul style="margin:.3rem 0 0;padding-left:1.2rem">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : (g.batting ? '<p class="ok-text small">✓ Box score adds up.</p>' : '');
}

// Applies local edits (changed + deleted games) on top of a base list.
function mergeGames(base) {
  const out = base.filter(g => !admin.deletedGames.has(g.id) && !admin.dirtyGames.has(g.id));
  for (const id of admin.dirtyGames) {
    const g = admin.games.find(x => x.id === id);
    if (g) out.push(clone(g));
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}

async function saveGamesToGitHub() {
  collectGameForm();
  const blocking = [...admin.dirtyGames].map(id => admin.games.find(g => g.id === id)).filter(Boolean)
    .filter(g => g.status === 'final' && (g.awayScore === undefined || g.homeScore === undefined));
  if (blocking.length) return showMessage(`Can't save: ${esc(gameLabel(blocking[0]))} is marked Final but has no score.`);
  const cfg = admin.creds;

  const changed = [...admin.dirtyGames].map(id => admin.games.find(g => g.id === id)).filter(Boolean);
  const n = changed.length + admin.deletedGames.size;
  const message = n === 1 && changed.length === 1 ? `Update game: ${gameLabel(changed[0]).replace(/ \*$/, '')}` : `Update schedule/results (${n} games)`;
  setBusy(true);
  try {
    // Merge into the latest copy on GitHub so two people entering different games don't overwrite each other.
    const merged = await ghUpdateFile(cfg, 'data/games.json', remote => serializeGames(mergeGames(JSON.parse(remote))),
      message);
    const fresh = JSON.parse(merged);
    admin.dirtyGames.clear();
    admin.deletedGames.clear();
    admin.games = clone(fresh);
    setData(DB.league, DB.players, fresh);
    renderCurrentTab();
    showMessage(`<strong>Saved!</strong> The live site updates within a few minutes.`, 'ok');
  } catch (e) {
    showMessage(`<strong>Save failed:</strong> ${esc(e.message)}`);
  } finally {
    setBusy(false);
  }
}

// ---------- rosters tab ----------

function slugify(name) {
  const parts = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().split(/\s+/);
  const base = parts.length > 1 ? `${parts[0][0]}-${parts.slice(1).join('-')}` : parts[0] || 'player';
  const used = new Set(admin.players.map(p => p.id));
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

function renderRostersTab() {
  const team = admin.rosterTeam;
  const list = admin.players.map((p, i) => ({ p, i }))
    .filter(({ p }) => !team || p.team === team)
    .sort((a, b) => (a.p.team || '').localeCompare(b.p.team || '') || num(a.p.number) - num(b.p.number));
  const teamSel = (i, val) => `<select data-i="${i}" data-f="team">${DB.league.teams.map(t =>
    `<option value="${esc(t.id)}" ${t.id === val ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;

  document.getElementById('admin-body').innerHTML = `
    <div class="card">
      <div class="controls" style="justify-content:space-between">
        <select id="r-team">${teamOptions(team)}</select>
        <div class="controls">
          <button class="btn secondary" id="r-add">+ Add player</button>
          ${admin.players.length ? '<button class="btn danger" id="r-clear">Remove all players</button>' : ''}
        </div>
      </div>
      <details style="margin-top:1rem" ${admin.playerBulkText ? 'open' : ''}><summary>Add many players at once</summary>
        <p class="small">One player per line: <strong>name, team, jersey number</strong> (number optional), or paste those columns from a spreadsheet.
          Teams can be names or abbreviations (${DB.league.teams.map(t => esc(teamAbbr(t.id))).join(', ')}).
          ${team ? `Lines without a team go to the ${esc(teamName(team))}.` : ''}</p>
        <textarea id="r-bulk" rows="6" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:.85rem"
          placeholder="Sam Cohen, ${esc(DB.league.teams[0]?.name || 'Team')}, 12">${esc(admin.playerBulkText || '')}</textarea>
        <div class="controls" style="margin-top:.5rem"><button class="btn secondary" id="r-bulk-add">Add players</button></div>
        <div id="r-bulk-msg"></div>
      </details>
    </div>
    <div class="card"><div class="table-wrap"><table id="roster-table">
      <thead><tr><th>#</th><th class="l">Name</th><th class="l">Team</th><th class="l">ID</th><th></th></tr></thead>
      <tbody>${list.map(({ p, i }) => `<tr>
        <td><input class="stat-input" type="number" min="0" data-i="${i}" data-f="number" value="${esc(p.number ?? '')}"></td>
        <td class="l"><input type="text" data-i="${i}" data-f="name" value="${esc(p.name || '')}" placeholder="First Last"></td>
        <td class="l">${teamSel(i, p.team)}</td>
        <td class="l muted small">${esc(p.id)}</td>
        <td><button class="btn danger" data-del="${i}" title="Remove player">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="l muted">No players.</td></tr>'}</tbody>
    </table></div>
    <p class="muted small">Moving a player to another team keeps their past stats with the team they played for.
      The ID links a player to their stats and never changes once created.</p></div>
    ${saveBar('players')}`;

  document.getElementById('r-team').onchange = e => { admin.rosterTeam = e.target.value; renderRostersTab(); };
  document.getElementById('r-add').onclick = () => {
    const name = prompt('New player name (First Last):');
    if (!name || !name.trim()) return;
    admin.players.push({ id: slugify(name.trim()), name: name.trim(), number: '', team: team || DB.league.teams[0].id });
    admin.playersDirty = true;
    renderRostersTab();
  };
  const bulk = document.getElementById('r-bulk');
  bulk.oninput = () => (admin.playerBulkText = bulk.value);
  document.getElementById('r-bulk-add').onclick = () => {
    const errors = [], added = [];
    bulk.value.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const [name = '', teamText = '', number = ''] = (line.includes('\t') ? line.split('\t') : line.split(',')).map(x => x.trim());
      if (!name || /^name$/i.test(name)) return;
      const t = teamText ? matchTeam(teamText) : (team ? { id: team } : { error: 'no team given' });
      if (t.error) return errors.push(`Line ${i + 1} (${name}): ${t.error}`);
      if (number && !/^\d+$/.test(number)) return errors.push(`Line ${i + 1} (${name}): jersey number “${number}” isn't a number`);
      const p = { id: slugify(name), name, number: number ? num(number) : '', team: t.id };
      admin.players.push(p);
      added.push(p);
    });
    if (added.length) {
      admin.playersDirty = true;
      admin.playerBulkText = errors.length ? bulk.value : '';
      renderRostersTab();
      showMessage(`Added ${added.length} player${added.length === 1 ? '' : 's'}.${errors.length ? ` ${errors.length} line${errors.length === 1 ? '' : 's'} skipped:<br>${errors.map(esc).join('<br>')}` : ''}
        Click <strong>Save to website</strong> when you're done.`, errors.length ? '' : 'info');
    } else {
      document.getElementById('r-bulk-msg').innerHTML = `<p class="warn small">${errors.length ? errors.map(esc).join('<br>') : 'Nothing to add.'}</p>`;
    }
  };
  const clearAll = document.getElementById('r-clear');
  if (clearAll) clearAll.onclick = () => {
    if (!confirm(`Remove all ${admin.players.length} players from every roster?\n\nUse this to clear out the rosters before a new season. Nothing changes on the website until you click Save.`)) return;
    admin.players = [];
    admin.playersDirty = true;
    renderRostersTab();
    showMessage('All players removed. Click <strong>Save to website</strong> to publish, or reload the page to undo.', 'info');
  };
  const table = document.getElementById('roster-table');
  table.addEventListener('change', e => {
    const el = e.target;
    if (!el.dataset.f) return;
    const p = admin.players[Number(el.dataset.i)];
    p[el.dataset.f] = el.dataset.f === 'number' ? (el.value === '' ? '' : num(el.value)) : el.value.trim();
    admin.playersDirty = true;
    refreshDirtyLabel('players');
  });
  table.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => {
    const p = admin.players[Number(b.dataset.del)];
    const played = admin.games.some(g => (g.batting || []).some(l => l.player === p.id));
    const msg = played
      ? `${p.name} has stats in past games. Removing them from the roster will make those stats show their ID instead of their name.\n\nTo keep their history, consider leaving them listed. Remove anyway?`
      : `Remove ${p.name} from the roster?`;
    if (!confirm(msg)) return;
    admin.players.splice(Number(b.dataset.del), 1);
    admin.playersDirty = true;
    renderRostersTab();
  }));
  document.getElementById('save-gh').onclick = savePlayersToGitHub;
  document.getElementById('save-dl').onclick = () => download('players.json', serializePlayers(cleanPlayers()));
}

function cleanPlayers() {
  return admin.players.map(p => {
    // Position and handedness aren't tracked; drop them if an older file still has them.
    const o = { id: p.id, name: p.name, number: p.number, team: p.team };
    if (o.number === '' || o.number === undefined) delete o.number;
    return Object.assign(o, Object.fromEntries(Object.entries(p).filter(([k]) => !(k in o) && !['number', 'pos', 'bats', 'throws'].includes(k))));
  });
}

async function savePlayersToGitHub() {
  const missing = admin.players.find(p => !p.name);
  if (missing) return showMessage('Every player needs a name before saving.');
  const cfg = admin.creds;
  setBusy(true);
  try {
    const saved = await ghUpdateFile(cfg, 'data/players.json', remote => {
      if (JSON.stringify(JSON.parse(remote)) !== admin.loadedPlayersJSON &&
        !confirm('Someone else changed the roster file since you opened this page. Save anyway and replace their changes?')) {
        throw new Error('Cancelled — reload the page to get the latest roster.');
      }
      return serializePlayers(cleanPlayers());
    }, 'Update rosters');
    const fresh = JSON.parse(saved);
    admin.players = clone(fresh);
    admin.loadedPlayersJSON = JSON.stringify(fresh);
    admin.playersDirty = false;
    setData(DB.league, fresh, DB.games);
    renderRostersTab();
    showMessage('<strong>Roster saved!</strong> The live site updates within a few minutes.', 'ok');
  } catch (e) {
    showMessage(`<strong>Save failed:</strong> ${esc(e.message)}`);
  } finally {
    setBusy(false);
  }
}

// ---------- settings tab ----------

function renderSettingsTab() {
  const c = admin.creds;
  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <h2>Who can update the site</h2>
      <p>Anyone with the admin password. Send them the website link and the password; they click
        <strong>League admin</strong> at the bottom of any page and sign in. No GitHub account needed.</p>
    </section>
    <section class="card">
      <h2>Change the admin password</h2>
      <p class="muted small">Everyone currently signed in stays signed in. New sign-ins need the new password
        (it takes a few minutes for the change to reach the live site).</p>
      <form id="pw-form" class="form-stack">
        <div class="form-grid">
          <label>New password<input type="password" id="np" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm new password<input type="password" id="np2" autocomplete="new-password" required></label>
        </div>
        <div><button class="btn" type="submit">Change password</button></div>
      </form>
    </section>
    <section class="card">
      <h2>GitHub connection <span class="muted small">(site owner)</span></h2>
      <p>Saving to <code>${esc(c.owner)}/${esc(c.repo)}</code> on branch <code>${esc(c.branch)}</code>.
        GitHub tokens expire; when this one does, saving stops working until the owner creates a new token
        (same steps as the first setup: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">new fine-grained token</a>,
        this repository only, <em>Contents: Read and write</em>) and enters it here.</p>
      <form id="tok-form" class="form-stack">
        <div class="form-grid">
          <label style="grid-column:1/-1">New GitHub token<input type="password" id="nt" placeholder="github_pat_…" autocomplete="off" required></label>
          <label>Admin password (current or new)<input type="password" id="tp" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm password<input type="password" id="tp2" autocomplete="new-password" required></label>
        </div>
        <div><button class="btn" type="submit">Update token</button></div>
      </form>
    </section>`;

  const run = async (form, creds, pw, pw2, commitMsg, okMsg) => {
    if (pw !== pw2) return showMessage("The passwords don't match.");
    setBusy(true);
    try {
      await saveLockFile(creds, pw, commitMsg);
      admin.creds = creds;
      // Keep this device signed in with the (possibly new) token.
      let remembered = false;
      try { remembered = !!localStorage.getItem(SESSION_KEY); } catch { /* storage blocked */ }
      storeSession(creds, remembered);
      form.reset();
      showMessage(okMsg, 'ok');
      if (admin.loadError) { admin.ready = false; admin.message = { kind: 'ok', html: okMsg }; renderAdmin(); }
    } catch (e) {
      showMessage(`<strong>Couldn't save:</strong> ${esc(e.message)}`);
    } finally {
      setBusy(false);
    }
  };
  document.getElementById('pw-form').onsubmit = e => {
    e.preventDefault();
    run(e.target, admin.creds, document.getElementById('np').value, document.getElementById('np2').value,
      'Change league admin password', '<strong>Password changed.</strong> Remember to tell the other admins.');
  };
  document.getElementById('tok-form').onsubmit = e => {
    e.preventDefault();
    run(e.target, { ...admin.creds, token: document.getElementById('nt').value.trim() },
      document.getElementById('tp').value, document.getElementById('tp2').value,
      'Update league admin GitHub token', '<strong>GitHub token updated.</strong> Saving works again.');
  };
}

// ---------- GitHub + file helpers ----------

async function ghFetch(cfg, path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message; } catch { /* ignore */ }
    const hints = {
      401: "The website's GitHub token has expired or been revoked. The site owner needs to enter a new one under Settings.",
      403: "The website's GitHub token doesn't have permission to change this repository.",
      404: 'Repository, branch or file not found (or the GitHub token cannot see it).',
    };
    const err = new Error(`${hints[res.status] || 'GitHub error.'} (${res.status}${detail ? ': ' + detail : ''})`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function ghReadFile(cfg, path) {
  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);
  const file = await res.json();
  return { sha: file.sha, text: b64decode(file.content) };
}

// Reads a file from GitHub, transforms it, and commits the result. Retries once if someone else saved in between.
// A missing file is passed to transform as null and created.
async function ghUpdateFile(cfg, path, transform, message) {
  const base = `/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  for (let attempt = 0; ; attempt++) {
    let file = null;
    try {
      file = await ghReadFile(cfg, path);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const next = transform(file ? file.text : null);
    try {
      await ghFetch(cfg, base, {
        method: 'PUT',
        body: JSON.stringify({ message, content: b64encode(next), branch: cfg.branch, ...(file ? { sha: file.sha } : {}) }),
      });
      return next;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
      throw e;
    }
  }
}

// ---------- admin password lock ----------
// data/admin.json holds the GitHub connection encrypted with the admin password (AES-GCM, key from PBKDF2).

function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
async function passwordKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptCreds(creds, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(creds)));
  return { version: 1, iterations: PBKDF2_ITERATIONS, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(data)) };
}
// Throws if the password is wrong.
async function decryptCreds(lock, password) {
  const key = await passwordKey(password, b64ToBytes(lock.salt), lock.iterations);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(lock.iv) }, key, b64ToBytes(lock.data));
  return JSON.parse(new TextDecoder().decode(data));
}

// Encrypts the GitHub connection with the password and commits it. Doubles as a check that the token can write.
async function saveLockFile(creds, password, message) {
  if (!password || password.length < 8) throw new Error('The password must be at least 8 characters.');
  if (!creds.token) throw new Error('Enter a GitHub token.');
  const lock = await encryptCreds(creds, password);
  try {
    await ghUpdateFile(creds, 'data/admin.json', () => JSON.stringify(lock, null, 2) + '\n', message);
  } catch (e) {
    if (e.status === 403) throw new Error(`The token can't write to ${creds.owner}/${creds.repo}. Make sure it has access to that repository with Contents set to “Read and write”.`);
    throw e;
  }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMessage(`Downloaded <code>${esc(name)}</code>. Upload it to the <code>data</code> folder on GitHub to publish it.`, 'info');
}

function setBusy(busy) {
  document.querySelectorAll('.admin button').forEach(b => {
    if (busy) {
      b.dataset.wasDisabled = b.disabled;
      b.disabled = true;
    } else if (b.dataset.wasDisabled !== undefined) {
      b.disabled = b.dataset.wasDisabled === 'true';
      delete b.dataset.wasDisabled;
    }
  });
  document.body.style.cursor = busy ? 'progress' : '';
}
