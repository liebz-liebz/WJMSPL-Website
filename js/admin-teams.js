// League admin → Teams tab: team names, abbreviations and colours, plus the season. Saves data/league.json.
//
// A team's ID links it to games and players, so it never changes once created. What people see
// is the name and the abbreviation ("short"), which can be edited freely.

const TEAM_COLORS = ['#1d4ed8', '#047857', '#b45309', '#b91c1c', '#7c3aed', '#0e7490', '#be185d', '#4d7c0f', '#334155', '#a16207'];

function initTeamsDraft() {
  admin.teams = clone(DB.league.teams).map(t => ({ ...t, short: t.short || t.id }));
  admin.season = DB.league.season || '';
  admin.teamsDirty = false;
}

function teamRefs(id) {
  return {
    players: admin.players.filter(p => p.team === id).length,
    games: admin.games.filter(g => g.away === id || g.home === id).length,
    savedPlayers: DB.players.filter(p => p.team === id).length,
    savedGames: DB.games.filter(g => g.away === id || g.home === id).length,
  };
}

// New teams get an ID from their abbreviation (THU, THU2, …), unique among current and saved teams.
function assignTeamIds(teams) {
  const used = new Set(teams.map(t => t.id).filter(Boolean).concat(DB.league.teams.map(t => t.id)));
  for (const t of teams) {
    if (t.id) continue;
    const base = (t.short || t.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'TEAM';
    let id = base, n = 2;
    while (used.has(id)) id = `${base}${n++}`;
    used.add(id);
    t.id = id;
  }
  return teams;
}

function teamProblems() {
  const problems = [];
  const seen = { name: new Map(), short: new Map() };
  admin.teams.forEach((t, i) => {
    const label = t.name || `Row ${i + 1}`;
    if (!t.name) problems.push(`Row ${i + 1}: enter a team name.`);
    if (!t.short) problems.push(`${label}: enter an abbreviation.`);
    else if (t.short.length > 5) problems.push(`${label}: keep the abbreviation to 5 characters or fewer.`);
    for (const f of ['name', 'short']) {
      const k = (t[f] || '').toLowerCase();
      if (!k) continue;
      if (seen[f].has(k)) problems.push(`${label} and ${seen[f].get(k)} have the same ${f === 'name' ? 'name' : 'abbreviation'}.`);
      else seen[f].set(k, label);
    }
  });
  if (!String(admin.season).trim()) problems.push('Enter the season (e.g. 2027).');
  return problems;
}

function renderTeamsTab() {
  const problems = teamProblems();
  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <h2>Season</h2>
      <div class="form-grid" style="max-width:220px">
        <label>Season<input type="text" id="t-season" value="${esc(admin.season)}" placeholder="2027"></label>
      </div>
      <p class="muted small">Shown at the bottom of every page. When you paste a schedule, dates without a year use this year.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Teams</h2><button class="btn secondary" id="t-add">+ Add team</button></div>
      <div class="table-wrap"><table id="teams-table">
        <thead><tr><th class="l">Colour</th><th class="l">Name</th><th class="l">Abbreviation</th><th>Players</th><th>Games</th><th></th></tr></thead>
        <tbody>${admin.teams.map((t, i) => {
          const r = t.id ? teamRefs(t.id) : { players: 0, games: 0 };
          return `<tr>
            <td class="l"><input type="color" data-i="${i}" data-f="color" value="${esc(t.color || '#888888')}" aria-label="Colour"></td>
            <td class="l"><input type="text" data-i="${i}" data-f="name" value="${esc(t.name || '')}" placeholder="Team name"></td>
            <td class="l"><input type="text" data-i="${i}" data-f="short" value="${esc(t.short || '')}" maxlength="5" style="width:6rem;min-width:0;text-transform:uppercase" placeholder="ABC"></td>
            <td>${r.players}</td>
            <td>${r.games}</td>
            <td><button class="btn danger" data-del="${i}" title="Delete team">✕</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="6" class="l muted">No teams yet.</td></tr>'}</tbody>
      </table></div>
      <p class="muted small">The abbreviation appears next to player names in stats and on the calendar.
        After adding a new team, save here before adding its games or players.
        A team can only be deleted once it has no players or games.</p>
      <div id="team-checks">${problems.length ? `<div class="notice"><ul style="margin:0;padding-left:1.2rem">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}</div>
    </section>
    ${saveBar('teams')}`;

  const changed = () => {
    admin.teamsDirty = true;
    refreshDirtyLabel('teams');
    const ps = teamProblems();
    document.getElementById('team-checks').innerHTML = ps.length
      ? `<div class="notice"><ul style="margin:0;padding-left:1.2rem">${ps.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
  };
  document.getElementById('t-season').oninput = e => { admin.season = e.target.value.trim(); changed(); };
  const table = document.getElementById('teams-table');
  table.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset.f) return;
    const t = admin.teams[Number(el.dataset.i)];
    t[el.dataset.f] = el.dataset.f === 'short' ? el.value.trim().toUpperCase() : el.value.trim();
    changed();
  });
  document.getElementById('t-add').onclick = () => {
    const usedColors = new Set(admin.teams.map(t => (t.color || '').toLowerCase()));
    admin.teams.push({ id: '', name: '', short: '', color: TEAM_COLORS.find(c => !usedColors.has(c)) || '#888888' });
    admin.teamsDirty = true;
    renderTeamsTab();
    const inputs = document.querySelectorAll('#teams-table input[data-f="name"]');
    inputs[inputs.length - 1].focus();
  };
  table.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => {
    const t = admin.teams[Number(b.dataset.del)];
    if (t.id) {
      const r = teamRefs(t.id);
      if (r.players || r.games) {
        return showMessage(`${esc(t.name)} still has ${r.players} player${r.players === 1 ? '' : 's'} and ${r.games} game${r.games === 1 ? '' : 's'}.
          Move or remove them in the Rosters and Schedule tabs first.`);
      }
      if (r.savedPlayers || r.savedGames) {
        return showMessage(`${esc(t.name)}'s players or games were removed but not saved yet. Save the Rosters and Schedule tabs first, then delete the team.`);
      }
    }
    if (!confirm(`Delete ${t.name || 'this team'}?`)) return;
    admin.teams.splice(Number(b.dataset.del), 1);
    admin.teamsDirty = true;
    renderTeamsTab();
  }));
  document.getElementById('save-gh').onclick = saveTeamsToGitHub;
  document.getElementById('save-dl').onclick = () => {
    if (teamProblems().length) return showMessage('Fix the problems listed under Teams first.');
    download('league.json', leagueWithTeams(DB.league));
  };
}

// Applies the season and teams from the Teams tab onto a league.json object, keeping its other settings.
function leagueWithTeams(base) {
  const league = clone(base);
  league.season = admin.season;
  league.teams = clone(assignTeamIds(admin.teams));
  return JSON.stringify(league, null, 2) + '\n';
}

async function saveTeamsToGitHub() {
  const problems = teamProblems();
  if (problems.length) return showMessage(`Can't save yet: ${esc(problems[0])}`);
  setBusy(true);
  try {
    const saved = await ghUpdateFile(admin.creds, 'data/league.json', remote => leagueWithTeams(JSON.parse(remote)), 'Update teams');
    setData(JSON.parse(saved), DB.players, DB.games);
    applyLeagueInfo();
    initTeamsDraft();
    renderTeamsTab();
    showMessage('<strong>Teams saved!</strong> The live site updates within a few minutes.', 'ok');
  } catch (e) {
    showMessage(`<strong>Save failed:</strong> ${esc(e.message)}`);
  } finally {
    setBusy(false);
  }
}
