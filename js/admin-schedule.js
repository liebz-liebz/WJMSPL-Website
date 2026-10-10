// League admin → Schedule tab: add games one at a time or paste a whole season, and edit or delete games.

admin.scheduleTeam = '';
admin.addDraft = { date: '', time: '', away: '', home: '', type: 'regular' };
admin.bulkText = '';
admin.bulkPlayoffs = false;
admin.scheduleType = ''; // '', 'regular' or 'playoffs'

function newGameId(taken) {
  // Never reuse an ID, even one deleted in this session, so saves can't mix up old and new games.
  const used = new Set(admin.games.map(g => g.id).concat(DB.games.map(g => g.id), [...admin.deletedGames], taken || []));
  let n = 1 + Math.max(0, ...[...used].map(id => Number((/^g(\d+)$/.exec(id) || [])[1]) || 0));
  let id;
  do { id = `g${String(n++).padStart(3, '0')}`; } while (used.has(id));
  return id;
}

function sameGame(a, b) {
  return a.date === b.date && (a.time || '') === (b.time || '') && a.away === b.away && a.home === b.home;
}

function addGames(games) {
  for (const g of games) {
    admin.games.push(g);
    admin.dirtyGames.add(g.id);
  }
}

// ---------- parsing pasted schedules ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function seasonYear() {
  return Number(String(DB.league.season).match(/\d{4}/)?.[0]) || new Date().getFullYear();
}
function isoDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Accepts 2027-05-12, 5/12/2027, 5/12, May 12, Sat May 12 2027, May 12th 2027.
// A missing year means the league's season year.
function parseDate(s) {
  s = s.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(s))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : seasonYear();
    return isoDate(y, +m[1], +m[2]);
  }
  if ((m = /^(?:[a-z]+\.?,? )?([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/i.exec(s))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (!month) return null;
    return isoDate(m[3] ? +m[3] : seasonYear(), month, +m[2]);
  }
  return null;
}
// Accepts 18:30, 6:30 PM, 6:30pm, 6pm. Without AM/PM, 1–7 o'clock is taken as evening.
function parseTime(s) {
  s = s.trim().toLowerCase().replace(/\./g, '');
  if (!s) return '';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3][0] === 'p' && h < 12) h += 12;
    if (m[3][0] === 'a' && h === 12) h = 0;
  } else if (h >= 1 && h <= 7) {
    h += 12;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function matchTeam(s) {
  const q = s.trim().toLowerCase().replace(/^the /, '');
  if (!q) return { error: 'missing team' };
  const teams = DB.league.teams;
  const exact = teams.find(t => t.id.toLowerCase() === q || (t.short || '').toLowerCase() === q || t.name.toLowerCase().replace(/^the /, '') === q);
  if (exact) return { id: exact.id };
  const partial = teams.filter(t => t.name.toLowerCase().includes(q));
  if (partial.length === 1) return { id: partial[0].id };
  return { error: partial.length ? `“${s.trim()}” matches more than one team` : `unknown team “${s.trim()}”` };
}

// One game per line: date, time, away team, home team. Any extra columns are ignored.
// Columns can be separated by commas or tabs (pasting from a spreadsheet gives tabs).
function parseSchedule(text) {
  const rows = [];
  const pending = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map(x => x.trim());
    // "May 12, 2027" contains a comma: rejoin the date when the next piece is its year (or completes it).
    if (parts.length > 1 && parseDate(`${parts[0]}, ${parts[1]}`) && (/^\d{4}$/.test(parts[1]) || !parseDate(parts[0]))) {
      parts = [`${parts[0]}, ${parts[1]}`, ...parts.slice(2)];
    }
    const row = { line: i + 1, raw: line };
    rows.push(row);
    const [d, t = '', away = '', home = ''] = parts;
    const date = parseDate(d || '');
    if (!date) {
      row.error = /date|time|away|home/i.test(line) && rows.length === 1 ? 'header row (skipped)' : `can't read the date “${d}”`;
      row.skip = row.error.startsWith('header');
      return;
    }
    const time = parseTime(t);
    if (time === null) { row.error = `can't read the time “${t}”`; return; }
    const a = matchTeam(away), h = matchTeam(home);
    if (a.error || h.error) {
      row.error = [a.error && `away team: ${a.error}`, h.error && `home team: ${h.error}`].filter(Boolean).join('; ');
      return;
    }
    if (a.id === h.id) { row.error = 'away and home are the same team'; return; }
    row.game = { date, time, away: a.id, home: h.id, status: 'scheduled' };
    if (admin.games.some(g => sameGame(g, row.game)) || pending.some(g => sameGame(g, row.game))) {
      row.error = 'already on the schedule';
      row.duplicate = true;
      delete row.game;
      return;
    }
    pending.push(row.game);
  });
  return rows;
}

// ---------- tab ----------

function renderScheduleTab() {
  const d = admin.addDraft;
  const teamSel = (id, val, blank) => `<select id="${id}">${blank ? `<option value="">${blank}</option>` : ''}${DB.league.teams.map(t =>
    `<option value="${esc(t.id)}" ${t.id === val ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  const team = admin.scheduleTeam;
  const games = sortedAdminGames().filter(g => (!team || g.away === team || g.home === team) &&
    (!admin.scheduleType || gamePhase(g) === admin.scheduleType));
  const dhs = findDoubleheaders(admin.games);
  const example = DB.league.teams.length >= 2
    ? `${seasonYear()}-05-12, 6:30 PM, ${DB.league.teams[0].name}, ${DB.league.teams[1].name}`
    : `${seasonYear()}-05-12, 6:30 PM, Away Team, Home Team`;

  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <h2>Add one game</h2>
      <form id="add-one" class="form-grid">
        <label>Date<input type="date" id="a-date" value="${esc(d.date)}" required></label>
        <label>Time<input type="time" id="a-time" value="${esc(d.time)}"></label>
        <label>Away team${teamSel('a-away', d.away, 'Choose…')}</label>
        <label>Home team${teamSel('a-home', d.home, 'Choose…')}</label>
        <label>Type<select id="a-type">
          <option value="regular">Regular season</option>
          <option value="playoff" ${d.type === 'playoff' ? 'selected' : ''}>Playoff</option>
        </select></label>
        <div style="align-self:end"><button class="btn" type="submit">Add game</button></div>
      </form>
    </section>

    <section class="card">
      <h2>Add many games at once</h2>
      <p class="small">Paste the season schedule, one game per line: <strong>date, time, away team, home team</strong>.
        You can copy rows straight from a spreadsheet with the columns in that order.
        Teams can be written as names or abbreviations (${DB.league.teams.map(t => esc(teamAbbr(t.id))).join(', ')}).
        Dates can look like <code>2027-05-12</code>, <code>5/12/2027</code> (month first) or <code>May 12</code>; a missing year means ${seasonYear()}.
        Doubleheaders are just two lines with the same teams on the same day.</p>
      <textarea id="bulk" rows="8" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:.85rem"
        placeholder="${esc(example)}">${esc(admin.bulkText)}</textarea>
      <div class="controls" style="margin-top:.5rem">
        <button class="btn secondary" id="bulk-check">Check</button>
        <label class="check"><input type="checkbox" id="bulk-playoffs" ${admin.bulkPlayoffs ? 'checked' : ''}> These are playoff games</label>
      </div>
      <div id="bulk-preview"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Schedule <span class="muted small">(${admin.games.length} game${admin.games.length === 1 ? '' : 's'})</span></h2>
        <div class="controls">
          <select id="s-type">
            <option value="">All games</option>
            <option value="regular" ${admin.scheduleType === 'regular' ? 'selected' : ''}>Regular season</option>
            <option value="playoffs" ${admin.scheduleType === 'playoffs' ? 'selected' : ''}>Playoffs</option>
          </select>
          <select id="s-team">${teamOptions(team)}</select>
          ${admin.games.length ? '<button class="btn danger" id="s-clear">Delete all games</button>' : ''}
        </div>
      </div>
      <p class="muted small" style="margin-top:0">Changes here apply right away; click <strong>Save to website</strong> when you're done.</p>
      <div class="table-wrap"><table id="sched-table">
        <thead><tr><th class="l">Date</th><th class="l">Time</th><th class="l">Away</th><th class="l">Home</th>
          <th class="l">Type</th><th class="l">Result</th><th></th></tr></thead>
        <tbody>${games.map(g => {
          const dh = dhs.get(g.id);
          const sel = (f, val) => `<select data-id="${esc(g.id)}" data-f="${f}">${DB.league.teams.map(t =>
            `<option value="${esc(t.id)}" ${t.id === val ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
          const result = isFinal(g) ? `Final ${num(g.awayScore)}-${num(g.homeScore)}${g.mercy ? ' (mercy)' : ''}`
            : g.status && g.status !== 'scheduled' ? g.status[0].toUpperCase() + g.status.slice(1) : '';
          return `<tr>
            <td class="l"><input type="date" data-id="${esc(g.id)}" data-f="date" value="${esc(g.date || '')}"></td>
            <td class="l"><input type="time" data-id="${esc(g.id)}" data-f="time" value="${esc(g.time || '')}">${dh ? `<div class="muted small">DH game ${dh.game}</div>` : ''}</td>
            <td class="l">${sel('away', g.away)}</td>
            <td class="l">${sel('home', g.home)}</td>
            <td class="l"><select data-id="${esc(g.id)}" data-f="type">
              <option value="regular">Regular</option><option value="playoff" ${g.type === 'playoff' ? 'selected' : ''}>Playoff</option></select></td>
            <td class="l small">${esc(result)} <a href="#" data-result="${esc(g.id)}">${isFinal(g) ? 'Edit' : 'Enter'} result</a></td>
            <td><button class="btn danger" data-del="${esc(g.id)}" title="Delete game">✕</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="7" class="l muted">${admin.games.length ? 'No games match these filters.' : 'No games yet. Add them above.'}</td></tr>`}</tbody>
      </table></div>
    </section>
    ${saveBar('games')}`;

  // Add one game
  const draft = () => {
    const v = id => document.getElementById(id).value.trim();
    Object.assign(admin.addDraft, { date: v('a-date'), time: v('a-time'), away: v('a-away'), home: v('a-home'), type: v('a-type') });
  };
  document.getElementById('add-one').addEventListener('change', draft);
  document.getElementById('add-one').onsubmit = e => {
    e.preventDefault();
    draft();
    const { date, time, away, home, type } = admin.addDraft;
    if (!away || !home) return showMessage('Choose both teams.');
    if (away === home) return showMessage('Away and home are the same team.');
    const g = { id: newGameId(), date, time, away, home, ...(type === 'playoff' ? { type } : {}), status: 'scheduled' };
    if (admin.games.some(x => sameGame(x, g))) return showMessage('That game is already on the schedule.');
    addGames([g]);
    // Keep date and time for the next entry; teams usually change.
    admin.addDraft.away = admin.addDraft.home = '';
    renderScheduleTab();
    showMessage(`Added ${esc(teamName(away))} @ ${esc(teamName(home))} on ${esc(fmtDate(date))}. Click <strong>Save to website</strong> when you're done.`, 'info');
  };

  // Paste many
  const bulk = document.getElementById('bulk');
  bulk.oninput = () => { admin.bulkText = bulk.value; document.getElementById('bulk-preview').innerHTML = ''; };
  document.getElementById('bulk-check').onclick = () => {
    const rows = parseSchedule(bulk.value);
    const good = rows.filter(r => r.game);
    const bad = rows.filter(r => r.error && !r.skip && !r.duplicate);
    const preview = document.getElementById('bulk-preview');
    if (!rows.length) { preview.innerHTML = '<p class="muted">Nothing to check: paste some games first.</p>'; return; }
    preview.innerHTML = `
      <div class="table-wrap" style="margin-top:1rem"><table>
        <thead><tr><th>Line</th><th class="l">Date</th><th class="l">Time</th><th class="l">Away</th><th class="l">Home</th><th class="l"></th></tr></thead>
        <tbody>${rows.map(r => r.game
          ? `<tr><td>${r.line}</td><td class="l">${esc(fmtDate(r.game.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</td>
              <td class="l">${esc(fmtTime(r.game.time) || 'TBD')}</td><td class="l">${teamLabel(r.game.away)}</td><td class="l">${teamLabel(r.game.home)}</td>
              <td class="l ok-text">✓</td></tr>`
          : `<tr><td>${r.line}</td><td class="l ${r.skip || r.duplicate ? 'muted' : 'warn'}" colspan="5">${esc(r.error)}: <code>${esc(r.raw)}</code></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="controls" style="margin-top:.75rem">
        <button class="btn" id="bulk-add" ${good.length ? '' : 'disabled'}>Add ${good.length} ${document.getElementById('bulk-playoffs').checked ? 'playoff ' : ''}game${good.length === 1 ? '' : 's'}</button>
        ${bad.length ? `<span class="warn">${bad.length} line${bad.length === 1 ? '' : 's'} can't be read. Fix them above and click Check again, or add the rest now.</span>`
          : '<span class="muted small">Check the dates and times look right, then add.</span>'}
      </div>`;
    const btn = document.getElementById('bulk-add');
    if (btn) btn.onclick = () => {
      const ids = [];
      const playoffs = document.getElementById('bulk-playoffs').checked;
      addGames(good.map(r => {
        const id = newGameId(ids);
        ids.push(id);
        const { status, ...rest } = r.game;
        return { id, ...rest, ...(playoffs ? { type: 'playoff' } : {}), status };
      }));
      admin.bulkText = '';
      renderScheduleTab();
      showMessage(`Added ${good.length} ${playoffs ? 'playoff ' : ''}game${good.length === 1 ? '' : 's'}. Click <strong>Save to website</strong> to publish the schedule.`, 'info');
    };
  };

  // Table edits
  document.getElementById('s-team').onchange = e => { admin.scheduleTeam = e.target.value; renderScheduleTab(); };
  document.getElementById('s-type').onchange = e => { admin.scheduleType = e.target.value; renderScheduleTab(); };
  document.getElementById('bulk-playoffs').onchange = e => {
    admin.bulkPlayoffs = e.target.checked;
    document.getElementById('bulk-preview').innerHTML = '';
  };
  const table = document.getElementById('sched-table');
  table.addEventListener('change', e => {
    const el = e.target;
    const g = admin.games.find(x => x.id === el.dataset.id);
    if (!g || !el.dataset.f) return;
    const v = el.value.trim();
    if (el.dataset.f === 'type') {
      if (v === 'playoff') g.type = v; else delete g.type;
    } else {
      g[el.dataset.f] = v;
    }
    admin.dirtyGames.add(g.id);
    refreshDirtyLabel('games');
    if (g.away === g.home) showMessage(`Heads up: ${esc(teamName(g.away))} is listed as both away and home on ${esc(fmtDate(g.date))}.`);
  });
  table.querySelectorAll('[data-result]').forEach(a => (a.onclick = e => {
    e.preventDefault();
    admin.currentGameId = a.dataset.result;
    switchTab('games');
  }));
  table.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => {
    const g = admin.games.find(x => x.id === b.dataset.del);
    if (!confirm(`Delete this game${isFinal(g) ? ' and its result' : ''}?\n\n${gameLabel(g)}`)) return;
    deleteGames([g.id]);
    renderScheduleTab();
  }));
  const clear = document.getElementById('s-clear');
  if (clear) clear.onclick = () => {
    const n = admin.games.length;
    const played = admin.games.filter(isFinal).length;
    if (!confirm(`Delete all ${n} games${played ? `, including ${played} with results` : ''}?\n\nUse this to clear out a schedule before entering a new season. Nothing changes on the website until you click Save.`)) return;
    deleteGames(admin.games.map(g => g.id));
    renderScheduleTab();
    showMessage('All games removed. Click <strong>Save to website</strong> to publish, or reload the page to undo.', 'info');
  };
  document.getElementById('save-gh').onclick = saveGamesToGitHub;
  document.getElementById('save-dl').onclick = () => download('games.json', serializeGames(mergeGames(DB.games)));
}

function deleteGames(ids) {
  const set = new Set(ids);
  admin.games = admin.games.filter(g => !set.has(g.id));
  for (const id of ids) {
    admin.dirtyGames.delete(id);
    if (DB.games.some(x => x.id === id)) admin.deletedGames.add(id);
  }
  if (set.has(admin.currentGameId)) admin.currentGameId = null;
  refreshDirtyLabel('games');
}
