// League admin → Teams tab (the season's teams: names, abbreviations, colours; saves teams.json)
// and Seasons tab (start a new season, choose the current one; saves league.json).
//
// A team's ID links it to games and players, so it never changes once created. What people see
// is the name and the abbreviation ("short"), which can be edited freely.

const TEAM_COLORS = ['#1d4ed8', '#047857', '#b45309', '#b91c1c', '#7c3aed', '#0e7490', '#be185d', '#4d7c0f', '#334155', '#a16207'];

function initTeamsDraft() {
  admin.teams = clone(DB.league.teams).map(t => ({ ...t, short: t.short || t.id }));
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
  return problems;
}

function renderTeamsTab() {
  const problems = teamProblems();
  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <div class="card-head"><h2>${esc(admin.season)} teams</h2><button class="btn secondary" id="t-add">+ Add team</button></div>
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
      <p class="muted small">Teams belong to a season, so changes here only affect ${esc(admin.season)}.
        The abbreviation appears next to player names in stats and on the calendar.
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
    download('teams.json', serializeTeams(assignTeamIds(admin.teams)));
  };
}

async function saveTeamsToGitHub() {
  const problems = teamProblems();
  if (problems.length) return showMessage(`Can't save yet: ${esc(problems[0])}`);
  setBusy(true);
  try {
    const saved = await ghUpdateFile(admin.creds, seasonPath(admin.season, 'teams.json'),
      () => serializeTeams(assignTeamIds(admin.teams)), `Update ${admin.season} teams`);
    adminSetData({ ...DB.league, teams: JSON.parse(saved) }, DB.players, DB.games);
    initTeamsDraft();
    renderTeamsTab();
    showMessage('<strong>Teams saved!</strong> The live site updates within a few minutes.', 'ok');
  } catch (e) {
    showMessage(`<strong>Save failed:</strong> ${esc(e.message)}`);
  } finally {
    setBusy(false);
  }
}

// ---------- seasons tab ----------

// Writes a change to league.json (season list / current season) and applies it here.
async function updateLeagueFile(change, message) {
  const saved = JSON.parse(await ghUpdateFile(admin.creds, 'data/league.json',
    remote => JSON.stringify(change(JSON.parse(remote)), null, 2) + '\n', message));
  DB.leagueFile = saved;
  adminSetData({ ...saved, season: DB.league.season, teams: DB.league.teams }, DB.players, DB.games);
  applyLeagueInfo();
  return saved;
}

function suggestNextSeason() {
  const years = seasonList().map(Number).filter(Number.isFinite);
  return years.length ? String(Math.max(...years) + 1) : String(new Date().getFullYear());
}

function renderSeasonsTab() {
  const from = admin.season;
  document.getElementById('admin-body').innerHTML = `
    <section class="card">
      <h2>Seasons</h2>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">Season</th><th class="l"></th><th></th></tr></thead>
        <tbody>${seasonList().map(y => `<tr>
          <td class="l"><strong>${esc(y)}</strong></td>
          <td class="l">${y === currentSeason() ? '<span class="badge current">Current season</span>' : ''}
            ${y === admin.season ? '<span class="muted small">Editing now</span>' : ''}</td>
          <td>${y === admin.season ? '' : `<button class="btn secondary" data-edit="${esc(y)}">Edit</button>`}
            ${y === currentSeason() ? '' : `<button class="btn secondary" data-current="${esc(y)}">Make current</button>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">The <strong>current season</strong> is what the home page shows and what the site opens to.
        Visitors can look at other seasons with the Season dropdown on the Schedule, Standings, Rosters, Stats and Leaders pages.
        Use <em>Edit</em> to fix or fill in a past season's games, rosters or teams.</p>
    </section>
    <section class="card">
      <h2>Start a new season</h2>
      <form id="new-season" class="form-stack">
        <div class="form-grid" style="max-width:220px">
          <label>Season<input type="text" id="ns-name" value="${esc(suggestNextSeason())}" required pattern="[0-9A-Za-z-]{2,20}"
            title="Letters, numbers and dashes, e.g. 2027"></label>
        </div>
        <label class="check"><input type="checkbox" id="ns-teams" checked> Copy the teams from ${esc(from)}</label>
        <label class="check"><input type="checkbox" id="ns-players" checked> Copy the rosters from ${esc(from)}</label>
        <label class="check"><input type="checkbox" id="ns-current" checked> Make it the current season</label>
        <div><button class="btn" type="submit">Start season</button></div>
      </form>
      <p class="muted small">The new season starts with no games; add them in the Schedule tab. Copied teams and players can be
        changed afterwards without affecting ${esc(from)}. Players keep the same ID from season to season when copied.</p>
    </section>`;

  const teamsBox = document.getElementById('ns-teams'), playersBox = document.getElementById('ns-players');
  teamsBox.onchange = () => {
    // Rosters point at teams, so they can only be copied along with them.
    playersBox.disabled = !teamsBox.checked;
    if (!teamsBox.checked) playersBox.checked = false;
  };
  document.querySelectorAll('[data-edit]').forEach(b => (b.onclick = () => switchSeason(b.dataset.edit)));
  document.querySelectorAll('[data-current]').forEach(b => (b.onclick = async () => {
    const y = b.dataset.current;
    if (!confirm(`Make ${y} the current season? The home page will show ${y}, and the site will open to it.`)) return;
    setBusy(true);
    try {
      await updateLeagueFile(l => ({ ...l, currentSeason: y }), `Make ${y} the current season`);
      renderSeasonsTab();
      showMessage(`<strong>${esc(y)} is now the current season.</strong> The live site updates within a few minutes.`, 'ok');
    } catch (e) {
      showMessage(`<strong>Couldn't save:</strong> ${esc(e.message)}`);
    } finally {
      setBusy(false);
    }
  }));
  document.getElementById('new-season').onsubmit = async e => {
    e.preventDefault();
    const name = document.getElementById('ns-name').value.trim();
    if (!/^[0-9A-Za-z-]{2,20}$/.test(name)) return showMessage('Use letters, numbers and dashes for the season name, e.g. 2027.');
    if (seasonList().includes(name)) return showMessage(`There is already a ${esc(name)} season.`);
    if (hasUnsaved()) return showMessage(`Save or discard your changes to ${esc(admin.season)} first.`);
    const teams = teamsBox.checked ? DB.league.teams : [];
    const players = playersBox.checked ? DB.players : [];
    const makeCurrent = document.getElementById('ns-current').checked;
    setBusy(true);
    try {
      const create = (file, text) => ghUpdateFile(admin.creds, seasonPath(name, file), remote => {
        if (remote !== null) throw new Error(`data/seasons/${name}/${file} already exists.`);
        return text;
      }, `Start ${name} season: ${file}`);
      // Season files first, so the season is complete by the time league.json lists it.
      await create('teams.json', serializeTeams(teams));
      await create('players.json', serializePlayers(players));
      await create('games.json', '[]\n');
      await updateLeagueFile(l => ({
        ...l,
        seasons: [...new Set([...(l.seasons || []), name])],
        ...(makeCurrent ? { currentSeason: name } : {}),
      }), `Add the ${name} season`);
      switchSeason(name, { kind: 'ok', html: `<strong>${esc(name)} season started.</strong> You're now editing it. Add its games in the Schedule tab.` });
    } catch (err) {
      showMessage(`<strong>Couldn't start the season:</strong> ${esc(err.message)}`);
    } finally {
      setBusy(false);
    }
  };
}
