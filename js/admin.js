// League admin: enter game results / box scores, edit the schedule and rosters,
// then save the data files straight to GitHub (or download them to upload by hand).

const STORE_KEY = 'wjmspl-admin';
const PIT_INPUT_KEYS = ['ip', 'h', 'r', 'er', 'bb', 'so', 'hr'];

const admin = {
  ready: false,
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

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
function repoConfig() {
  const s = loadSettings();
  const gh = DB.league.github || {};
  return {
    token: s.token || '',
    owner: s.owner || gh.owner || '',
    repo: s.repo || gh.repo || '',
    branch: s.branch || gh.branch || 'main',
  };
}

function initAdmin() {
  if (admin.ready) return;
  admin.games = clone(DB.games);
  admin.players = clone(DB.players);
  admin.loadedPlayersJSON = JSON.stringify(DB.players);
  const today = todayISO();
  const sorted = sortedAdminGames();
  // Default to the most recent game that still needs a result, else the latest game played.
  const pending = sorted.filter(g => g.status !== 'final' && g.status !== 'cancelled' && (g.date || '') <= today);
  admin.currentGameId = (pending[pending.length - 1] || sorted.filter(isFinal).pop() || sorted[0] || {}).id || null;
  admin.ready = true;
  window.addEventListener('beforeunload', e => {
    if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
}

function hasUnsaved() {
  return admin.dirtyGames.size > 0 || admin.deletedGames.size > 0 || admin.playersDirty;
}
function sortedAdminGames() {
  return [...admin.games].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}
function currentGame() { return admin.games.find(g => g.id === admin.currentGameId); }

// ---------- page ----------

function renderAdmin() {
  initAdmin();
  const cfg = repoConfig();
  const tabs = [['games', 'Games & Results'], ['rosters', 'Rosters'], ['settings', 'Setup']];
  $app.innerHTML = `
    <div class="admin">
      <div class="page-head"><h1>League Admin</h1>
        <div class="seg admin-tabs" id="admin-tabs">${tabs.map(([k, l]) =>
          `<button data-tab="${k}" class="${admin.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      ${!cfg.token && admin.tab !== 'settings' ? `<div class="notice info">To save changes directly to the website, add a GitHub access token under
        <a href="#" data-goto="settings">Setup</a>. Without one you can still download the updated file and upload it to GitHub yourself.</div>` : ''}
      <div id="admin-msg">${admin.message ? `<div class="notice ${admin.message.kind}">${admin.message.html}</div>` : ''}</div>
      <div id="admin-body"></div>
    </div>`;
  document.querySelectorAll('#admin-tabs button').forEach(b => (b.onclick = () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(a => (a.onclick = e => { e.preventDefault(); switchTab(a.dataset.goto); }));
  ({ games: renderGamesTab, rosters: renderRostersTab, settings: renderSettingsTab })[admin.tab]();
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

function saveBar(kind) {
  const n = kind === 'games' ? admin.dirtyGames.size + admin.deletedGames.size : (admin.playersDirty ? 1 : 0);
  const label = kind === 'games' ? `${n} game${n === 1 ? '' : 's'} changed` : (n ? 'Roster changed' : '');
  return `<div class="save-bar">
    <button class="btn" id="save-gh" ${n ? '' : 'disabled'}>Save to website</button>
    <button class="btn secondary" id="save-dl">Download ${kind === 'games' ? 'games' : 'players'}.json</button>
    <span class="${n ? 'warn' : 'muted'}" id="dirty-label">${n ? `Unsaved: ${label}` : 'No unsaved changes'}</span>
  </div>`;
}
function refreshDirtyLabel(kind) {
  const el = document.getElementById('dirty-label');
  const btn = document.getElementById('save-gh');
  if (!el) return;
  const n = kind === 'games' ? admin.dirtyGames.size + admin.deletedGames.size : (admin.playersDirty ? 1 : 0);
  el.className = n ? 'warn' : 'muted';
  el.textContent = n ? `Unsaved: ${kind === 'games' ? `${n} game${n === 1 ? '' : 's'} changed` : 'Roster changed'}` : 'No unsaved changes';
  btn.disabled = !n;
}

// ---------- games tab ----------

function gameLabel(g) {
  const score = isFinal(g) ? ` ${num(g.awayScore)}-${num(g.homeScore)}` : '';
  const st = g.status && g.status !== 'scheduled' ? ` (${g.status}${score})` : '';
  return `${g.date || 'TBD'} · ${teamName(g.away)} @ ${teamName(g.home)}${st}${admin.dirtyGames.has(g.id) ? ' *' : ''}`;
}

function renderGamesTab() {
  const games = sortedAdminGames();
  const g = currentGame();
  const body = document.getElementById('admin-body');
  body.innerHTML = `
    <div class="card">
      <div class="controls">
        <label class="field" style="flex:1;min-width:min(100%,320px)">Choose a game
          <select id="game-pick">${games.map(x => `<option value="${esc(x.id)}" ${x.id === admin.currentGameId ? 'selected' : ''}>${esc(gameLabel(x))}</option>`).join('')}</select>
        </label>
        <button class="btn secondary" id="game-new" style="align-self:flex-end">+ New game</button>
      </div>
    </div>
    ${g ? gameForm(g) : '<div class="empty">No games yet. Click “+ New game” to add one to the schedule.</div>'}
    ${saveBar('games')}`;

  document.getElementById('game-pick').onchange = e => {
    collectGameForm();
    admin.currentGameId = e.target.value;
    renderGamesTab();
  };
  document.getElementById('game-new').onclick = () => {
    collectGameForm();
    const used = new Set(admin.games.map(x => x.id));
    let n = admin.games.length + 1, id;
    do { id = `g${String(n++).padStart(3, '0')}`; } while (used.has(id));
    const teams = DB.league.teams;
    admin.games.push({ id, date: todayISO(), time: '', location: '', away: teams[0]?.id, home: teams[1]?.id, status: 'scheduled' });
    admin.dirtyGames.add(id);
    admin.currentGameId = id;
    renderGamesTab();
  };
  document.getElementById('save-gh').onclick = saveGamesToGitHub;
  document.getElementById('save-dl').onclick = () => {
    collectGameForm();
    download('games.json', serializeGames(mergeGames(DB.games)));
  };
  if (!g) return;

  const form = document.getElementById('game-form');
  form.addEventListener('input', () => { collectGameForm(); updateChecks(); });
  form.addEventListener('change', e => {
    collectGameForm();
    if (e.target.id === 'g-away' || e.target.id === 'g-home') renderGamesTab();
    else updateChecks();
  });
  document.getElementById('game-delete').onclick = () => {
    if (!confirm(`Delete this game from the schedule?\n\n${gameLabel(g)}`)) return;
    admin.games = admin.games.filter(x => x.id !== g.id);
    admin.dirtyGames.delete(g.id);
    if (DB.games.some(x => x.id === g.id)) admin.deletedGames.add(g.id);
    admin.currentGameId = (sortedAdminGames()[0] || {}).id || null;
    renderGamesTab();
  };
  document.getElementById('box-clear').onclick = () => {
    if (!confirm('Clear all batting and pitching stats for this game?')) return;
    form.querySelectorAll('input[data-kind]').forEach(i => (i.value = ''));
    form.querySelectorAll('select[data-kind]').forEach(s => (s.value = ''));
    collectGameForm();
    updateChecks();
  };
  updateChecks();
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

function pitchingInputs(g, team) {
  const lines = g.pitching || [];
  const ids = rosterFor(team, lines);
  // Pitchers listed on the roster as P come first among those without stats.
  const withStats = ids.filter(id => lines.some(l => l.player === id && lineTeam(l) === team));
  const rest = ids.filter(id => !withStats.includes(id));
  const isP = id => /(^|\W)P(\W|$)|RHP|LHP/.test((admin.players.find(p => p.id === id) || {}).pos || '');
  const order = withStats.concat(rest.filter(isP), rest.filter(id => !isP(id)));
  const starter = (lines.find(l => lineTeam(l) === team) || {}).player;
  return `<div class="table-wrap"><table>
    <thead><tr><th class="l">${esc(teamName(team))} pitching</th><th title="Starting pitcher">SP</th>
      ${PIT_INPUT_KEYS.map(c => `<th>${c.toUpperCase()}</th>`).join('')}<th>Dec</th></tr></thead>
    <tbody>${order.map(pid => {
      const l = lines.find(x => x.player === pid && lineTeam(x) === team) || {};
      return `<tr><td class="l">${esc(adminPlayerName(pid))}</td>
        <td><input type="radio" name="sp-${esc(team)}" data-sp="${esc(team)}" value="${esc(pid)}" ${pid === starter ? 'checked' : ''}></td>
        ${PIT_INPUT_KEYS.map(k => k === 'ip'
          ? `<td><input class="stat-input" type="text" inputmode="decimal" placeholder="0.0" data-kind="pit" data-team="${esc(team)}" data-player="${esc(pid)}" data-key="ip" value="${esc(l.ip ?? '')}"></td>`
          : `<td><input class="stat-input" type="number" min="0" inputmode="numeric" data-kind="pit" data-team="${esc(team)}" data-player="${esc(pid)}" data-key="${k}" value="${l[k] ?? ''}"></td>`).join('')}
        <td><select data-kind="pit" data-team="${esc(team)}" data-player="${esc(pid)}" data-key="dec">
          ${['', 'W', 'L', 'S'].map(d => `<option value="${d}" ${(l.dec || '').toUpperCase().replace('SV', 'S') === d ? 'selected' : ''}>${d || '-'}</option>`).join('')}
        </select></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function gameForm(g) {
  const teamSel = (id, val) => `<select id="${id}">${DB.league.teams.map(t =>
    `<option value="${esc(t.id)}" ${t.id === val ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  return `<form id="game-form" onsubmit="return false">
    <section class="card">
      <div class="card-head"><h2>Game details</h2><button type="button" class="btn danger" id="game-delete">Delete game</button></div>
      <div class="form-grid">
        <label>Date<input type="date" id="g-date" value="${esc(g.date || '')}"></label>
        <label>Time<input type="time" id="g-time" value="${esc(g.time || '')}"></label>
        <label>Location<input type="text" id="g-location" value="${esc(g.location || '')}"></label>
        <label>Away team${teamSel('g-away', g.away)}</label>
        <label>Home team${teamSel('g-home', g.home)}</label>
        <label>Game type<select id="g-type">
          <option value="regular" ${(g.type || 'regular') === 'regular' ? 'selected' : ''}>Regular season</option>
          <option value="playoff" ${g.type === 'playoff' ? 'selected' : ''}>Playoff (not in standings)</option>
        </select></label>
      </div>
    </section>
    <section class="card">
      <h2>Result</h2>
      <div class="form-grid">
        <label>Status<select id="g-status">
          ${['scheduled', 'final', 'postponed', 'cancelled'].map(s => `<option value="${s}" ${(g.status || 'scheduled') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select></label>
        <label>${esc(teamName(g.away))} runs<input type="number" min="0" id="g-ascore" value="${g.awayScore ?? ''}"></label>
        <label>${esc(teamName(g.home))} runs<input type="number" min="0" id="g-hscore" value="${g.homeScore ?? ''}"></label>
        <label style="grid-column:1/-1">Notes (shown on schedule)<input type="text" id="g-notes" value="${esc(g.notes || '')}" placeholder="e.g. Shortened to 5 innings (rain)"></label>
      </div>
      <p class="muted small">Standings update from the final score alone. The box score below is optional, but it's what feeds player stats and leaders.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Box score</h2><button type="button" class="btn secondary" id="box-clear">Clear box score</button></div>
      <p class="muted small">Only fill in rows for players who played — blank rows are ignored. Type 0 where needed (e.g. a player who
        walked in their only plate appearance has AB 0, BB 1). Innings use baseball notation: 5.1 = 5⅓, 5.2 = 5⅔.
        Tick “SP” for each team's starting pitcher.</p>
      <div id="checks"></div>
      ${battingInputs(g, g.away)}
      <div style="height:1rem"></div>
      ${battingInputs(g, g.home)}
      <div style="height:1rem"></div>
      ${pitchingInputs(g, g.away)}
      <div style="height:1rem"></div>
      ${pitchingInputs(g, g.home)}
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

  const lines = (kind, keys) => {
    const out = [];
    const rows = new Map();
    form.querySelectorAll(`[data-kind="${kind}"]`).forEach(el => {
      const k = `${el.dataset.team}|${el.dataset.player}`;
      if (!rows.has(k)) rows.set(k, { team: el.dataset.team, player: el.dataset.player, vals: {} });
      rows.get(k).vals[el.dataset.key] = el.value.trim();
    });
    for (const r of rows.values()) {
      if (!keys.some(k => r.vals[k] !== '' && r.vals[k] !== undefined)) continue;
      const line = { player: r.player, team: r.team };
      for (const k of keys) {
        line[k] = k === 'ip' ? outsToIP(ipToOuts(r.vals[k])) : num(r.vals[k]);
      }
      if (kind === 'pit') line.dec = r.vals.dec || '';
      out.push(line);
    }
    return out;
  };
  const batting = lines('bat', BAT_KEYS);
  let pitching = lines('pit', PIT_INPUT_KEYS);
  // Starting pitcher goes first for their team.
  for (const team of [g.away, g.home]) {
    const sp = form.querySelector(`input[data-sp="${CSS.escape(team)}"]:checked`);
    if (!sp) continue;
    const i = pitching.findIndex(l => l.team === team && l.player === sp.value);
    const first = pitching.findIndex(l => l.team === team);
    if (i > first && first >= 0) {
      const [line] = pitching.splice(i, 1);
      pitching.splice(first, 0, line);
    }
  }
  // Keep the away team's pitchers before the home team's.
  pitching = pitching.filter(l => l.team === val('g-away')).concat(pitching.filter(l => l.team !== val('g-away')));

  const known = ['id', 'date', 'time', 'location', 'away', 'home', 'type', 'status', 'awayScore', 'homeScore', 'notes', 'batting', 'pitching'];
  const extra = Object.fromEntries(Object.entries(g).filter(([k]) => !known.includes(k)));
  const next = { id: g.id, date: val('g-date'), time: val('g-time'), location: val('g-location'), away: val('g-away'), home: val('g-home') };
  if (val('g-type') !== 'regular') next.type = val('g-type');
  next.status = val('g-status');
  if (val('g-ascore') !== '') next.awayScore = num(val('g-ascore'));
  if (val('g-hscore') !== '') next.homeScore = num(val('g-hscore'));
  if (val('g-notes')) next.notes = val('g-notes');
  if (batting.length) next.batting = batting;
  if (pitching.length) next.pitching = pitching;
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
  } else if (g.batting || g.pitching) {
    problems.push('Box score entered but status is not Final — stats only count once the game is marked Final.');
  }
  if (!g.batting && !g.pitching) return problems;
  for (const [team, opp, score, oppScore] of [[g.away, g.home, g.awayScore, g.homeScore], [g.home, g.away, g.homeScore, g.awayScore]]) {
    const bat = (g.batting || []).filter(l => l.team === team);
    const pit = (g.pitching || []).filter(l => l.team === team);
    const oppBat = (g.batting || []).filter(l => l.team === opp);
    const name = teamName(team);
    const sum = (arr, k) => arr.reduce((s, l) => s + num(l[k]), 0);
    if (bat.length && score !== undefined && sum(bat, 'r') !== num(score)) problems.push(`${name}: batters' runs add up to ${sum(bat, 'r')}, but the score says ${num(score)}.`);
    if (pit.length && oppScore !== undefined && sum(pit, 'r') !== num(oppScore)) problems.push(`${name}: pitchers allowed ${sum(pit, 'r')} runs, but ${teamName(opp)} scored ${num(oppScore)}.`);
    if (pit.length && oppBat.length && sum(pit, 'h') !== sum(oppBat, 'h')) problems.push(`${name}: pitchers allowed ${sum(pit, 'h')} hits, but ${teamName(opp)} batters have ${sum(oppBat, 'h')}.`);
    for (const l of bat) {
      const xbh = num(l['2b']) + num(l['3b']) + num(l.hr);
      if (xbh > num(l.h)) problems.push(`${adminPlayerName(l.player)}: more extra-base hits than hits.`);
      if (num(l.h) > num(l.ab)) problems.push(`${adminPlayerName(l.player)}: more hits than at-bats.`);
    }
    for (const l of pit) if (num(l.er) > num(l.r)) problems.push(`${adminPlayerName(l.player)}: more earned runs than runs.`);
  }
  if (g.status === 'final' && g.pitching && num(g.awayScore) !== num(g.homeScore)) {
    const decs = g.pitching.map(l => l.dec);
    if (decs.filter(d => d === 'W').length !== 1 || decs.filter(d => d === 'L').length !== 1) problems.push('Pitching decisions: expected exactly one W and one L.');
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
  const badIP = [...form.querySelectorAll('[data-key="ip"]')].filter(i => i.value.trim() && !/^\d+(\.[0-2])?$/.test(i.value.trim()));
  if (badIP.length) problems.push('Innings pitched must look like 6, 5.1 or 5.2.');
  document.getElementById('checks').innerHTML = problems.length
    ? `<div class="notice"><strong>Double-check:</strong><ul style="margin:.3rem 0 0;padding-left:1.2rem">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : (g.batting || g.pitching ? '<p class="ok-text small">✓ Box score adds up.</p>' : '');
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
  const cfg = repoConfig();
  if (!cfg.token) return showMessage('Add a GitHub access token in <a href="#" onclick="switchTab(\'settings\');return false">Setup</a> first, or use “Download games.json”.');

  const changed = [...admin.dirtyGames].map(id => admin.games.find(g => g.id === id)).filter(Boolean);
  const summary = changed.length === 1 ? gameLabel(changed[0]).replace(/ \*$/, '') : `${changed.length + admin.deletedGames.size} games`;
  setBusy(true);
  try {
    // Merge into the latest copy on GitHub so two people entering different games don't overwrite each other.
    const merged = await ghUpdateFile(cfg, 'data/games.json', remote => serializeGames(mergeGames(JSON.parse(remote))),
      `Update results: ${summary}`);
    const fresh = JSON.parse(merged);
    admin.dirtyGames.clear();
    admin.deletedGames.clear();
    admin.games = clone(fresh);
    setData(DB.league, DB.players, fresh);
    renderGamesTab();
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
  const hand = (i, f, val, opts) => `<select data-i="${i}" data-f="${f}">${opts.map(o => `<option ${o === (val || '') ? 'selected' : ''}>${o}</option>`).join('')}</select>`;

  document.getElementById('admin-body').innerHTML = `
    <div class="card">
      <div class="controls" style="justify-content:space-between">
        <select id="r-team">${teamOptions(team)}</select>
        <button class="btn secondary" id="r-add">+ Add player</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap"><table id="roster-table">
      <thead><tr><th>#</th><th class="l">Name</th><th class="l">Team</th><th class="l">Pos</th><th>Bats</th><th>Throws</th><th class="l">ID</th><th></th></tr></thead>
      <tbody>${list.map(({ p, i }) => `<tr>
        <td><input class="stat-input" type="number" min="0" data-i="${i}" data-f="number" value="${esc(p.number ?? '')}"></td>
        <td class="l"><input type="text" data-i="${i}" data-f="name" value="${esc(p.name || '')}" placeholder="First Last"></td>
        <td class="l">${teamSel(i, p.team)}</td>
        <td class="l"><input type="text" data-i="${i}" data-f="pos" value="${esc(p.pos || '')}" style="width:4.5rem;min-width:0"></td>
        <td>${hand(i, 'bats', p.bats, ['', 'R', 'L', 'S'])}</td>
        <td>${hand(i, 'throws', p.throws, ['', 'R', 'L'])}</td>
        <td class="l muted small">${esc(p.id)}</td>
        <td><button class="btn danger" data-del="${i}" title="Remove player">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="8" class="l muted">No players.</td></tr>'}</tbody>
    </table></div>
    <p class="muted small">Moving a player to another team keeps their past stats with the team they played for.
      The ID links a player to their stats and never changes once created.</p></div>
    ${saveBar('players')}`;

  document.getElementById('r-team').onchange = e => { admin.rosterTeam = e.target.value; renderRostersTab(); };
  document.getElementById('r-add').onclick = () => {
    const name = prompt('New player name (First Last):');
    if (!name || !name.trim()) return;
    admin.players.push({ id: slugify(name.trim()), name: name.trim(), number: '', team: team || DB.league.teams[0].id, pos: '', bats: '', throws: '' });
    admin.playersDirty = true;
    renderRostersTab();
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
    const played = admin.games.some(g => (g.batting || []).concat(g.pitching || []).some(l => l.player === p.id));
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
    const o = { id: p.id, name: p.name, number: p.number, team: p.team, pos: p.pos, bats: p.bats, throws: p.throws };
    for (const k of Object.keys(o)) if (o[k] === '' || o[k] === undefined) delete o[k];
    return Object.assign(o, Object.fromEntries(Object.entries(p).filter(([k]) => !(k in o) && !['number', 'pos', 'bats', 'throws'].includes(k))));
  });
}

async function savePlayersToGitHub() {
  const missing = admin.players.find(p => !p.name);
  if (missing) return showMessage('Every player needs a name before saving.');
  const cfg = repoConfig();
  if (!cfg.token) return showMessage('Add a GitHub access token in <a href="#" onclick="switchTab(\'settings\');return false">Setup</a> first, or use “Download players.json”.');
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

// ---------- setup tab ----------

function renderSettingsTab() {
  const cfg = repoConfig();
  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <h2>Save directly to the website</h2>
      <p>The site's data lives in your GitHub repository. With a GitHub access token saved on this device, the
        <strong>Save to website</strong> button publishes your changes immediately — no file uploads needed.</p>
      <details><summary>How to create a token (one time, about 2 minutes)</summary>
        <ol>
          <li>On GitHub, go to <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong>
            (<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">direct link</a>).</li>
          <li>Name it something like “League website”, and pick an expiration (e.g. end of season).</li>
          <li>Under <strong>Repository access</strong>, choose <em>Only select repositories</em> and pick
            <code>${esc(cfg.owner)}/${esc(cfg.repo)}</code>.</li>
          <li>Under <strong>Permissions → Repository permissions</strong>, set <strong>Contents</strong> to <em>Read and write</em>.</li>
          <li>Click <strong>Generate token</strong>, copy it, and paste it below.</li>
        </ol>
        <p class="muted small">The token is stored only in this browser on this device. Anyone who gets it can edit the repository,
          so only save it on your own device. You can revoke it on GitHub at any time.</p>
      </details>
      <div class="form-grid" style="margin-top:1rem">
        <label style="grid-column:1/-1">GitHub token<input type="password" id="s-token" value="${esc(cfg.token)}" placeholder="github_pat_…" autocomplete="off"></label>
        <label>Repository owner<input type="text" id="s-owner" value="${esc(cfg.owner)}"></label>
        <label>Repository name<input type="text" id="s-repo" value="${esc(cfg.repo)}"></label>
        <label>Branch<input type="text" id="s-branch" value="${esc(cfg.branch)}"></label>
      </div>
      <div class="controls" style="margin-top:1rem">
        <button class="btn" id="s-save">Save &amp; test connection</button>
        <button class="btn secondary" id="s-forget">Forget token</button>
      </div>
    </section>
    <section class="card">
      <h2>Without a token</h2>
      <p>Use <strong>Download games.json</strong> (or players.json), then on GitHub open the <code>data</code> folder,
        choose <strong>Add file → Upload files</strong>, drop the downloaded file in, and click <strong>Commit changes</strong>.</p>
    </section>`;

  document.getElementById('s-save').onclick = async () => {
    const s = {
      token: document.getElementById('s-token').value.trim(),
      owner: document.getElementById('s-owner').value.trim(),
      repo: document.getElementById('s-repo').value.trim(),
      branch: document.getElementById('s-branch').value.trim() || 'main',
    };
    if (!saveSettings(s)) return showMessage('This browser blocked saving settings (private browsing?). The token will not be remembered.');
    if (!s.token) return showMessage('Settings saved, but no token entered.', 'info');
    setBusy(true);
    try {
      const res = await ghFetch(s, `/repos/${s.owner}/${s.repo}`);
      const repo = await res.json();
      if (!repo.permissions?.push) throw new Error('This token can read the repository but cannot write to it. Set Contents to “Read and write”.');
      await ghFetch(s, `/repos/${s.owner}/${s.repo}/contents/data/games.json?ref=${encodeURIComponent(s.branch)}`);
      showMessage(`<strong>Connected.</strong> Saves will go to <code>${esc(s.owner)}/${esc(s.repo)}</code> on branch <code>${esc(s.branch)}</code>.`, 'ok');
    } catch (e) {
      showMessage(`<strong>Connection failed:</strong> ${esc(e.message)}`);
    } finally {
      setBusy(false);
    }
  };
  document.getElementById('s-forget').onclick = () => {
    const s = loadSettings();
    delete s.token;
    saveSettings(s);
    renderAdmin();
    showMessage('Token removed from this device.', 'info');
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
    const hints = { 401: 'The token is invalid or expired.', 403: 'The token does not have permission for this repository.', 404: 'Repository, branch or file not found (or the token cannot see it).' };
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

// Reads a file from GitHub, transforms it, and commits the result. Retries once if someone else saved in between.
async function ghUpdateFile(cfg, path, transform, message) {
  const base = `/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await ghFetch(cfg, `${base}?ref=${encodeURIComponent(cfg.branch)}`);
    const file = await res.json();
    const next = transform(b64decode(file.content));
    try {
      await ghFetch(cfg, base, {
        method: 'PUT',
        body: JSON.stringify({ message, content: b64encode(next), sha: file.sha, branch: cfg.branch }),
      });
      return next;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
      throw e;
    }
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
