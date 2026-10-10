// Loads the league data files and computes standings / stats from game results.
//
// data/league.json             league-wide settings, the list of seasons and which one is current
// data/seasons/<year>/teams.json, players.json, games.json   one folder per season
//
// One season is loaded at a time. DB.league is league.json plus that season's `season` and `teams`.

const DB = {
  leagueFile: null, // data/league.json as saved
  season: null,     // the season currently loaded
  league: null,
  players: [],
  games: [],
  teamsById: {},
  playersById: {},
};

const BAT_KEYS = ['ab', 'r', 'h', '2b', '3b', 'hr', 'bb', 'so', 'sf'];

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

function seasonPath(season, file) {
  return `data/seasons/${encodeURIComponent(season)}/${file}`;
}
function currentSeason() {
  return DB.leagueFile.currentSeason;
}
// Newest first.
function seasonList() {
  return [...(DB.leagueFile.seasons || [])].sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
}

async function loadData() {
  DB.leagueFile = await fetchJSON('data/league.json');
  await loadSeason(currentSeason());
}

async function loadSeason(season) {
  const [teams, players, games] = await Promise.all(['teams', 'players', 'games'].map(f => fetchJSON(seasonPath(season, `${f}.json`))));
  setSeasonData(season, teams, players, games);
}

function setSeasonData(season, teams, players, games) {
  setData({ ...DB.leagueFile, season, teams }, players, games);
}

function setData(league, players, games) {
  DB.league = league;
  DB.season = league.season;
  DB.players = players;
  DB.games = games;
  DB.teamsById = Object.fromEntries(league.teams.map(t => [t.id, t]));
  DB.playersById = Object.fromEntries(players.map(p => [p.id, p]));
  DB.doubleheaders = findDoubleheaders(games);
}

// Two games between the same teams on the same day form a doubleheader.
// Returns a Map of game id -> { game: 1 or 2, of: number of games that day }.
function findDoubleheaders(games) {
  const groups = new Map();
  for (const g of games) {
    if (!g.date || g.status === 'cancelled') continue;
    const key = `${g.date}|${[g.away, g.home].sort().join('|')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  const out = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    list.forEach((g, i) => out.set(g.id, { game: i + 1, of: list.length }));
  }
  return out;
}

// Scheduled length: a game's own "innings" if set, else the league default for single games / doubleheaders.
function defaultInnings(g) {
  const cfg = DB.league.scheduledInnings || {};
  return DB.doubleheaders.has(g.id) ? (cfg.doubleheader ?? 6) : (cfg.singleGame ?? 9);
}
function scheduledInnings(g) {
  return num(g.innings) || defaultInnings(g);
}
// "Final", or "Final/5" when the game ended early (mercy) or went to extra innings.
function finalLabel(g) {
  const played = num(g.inningsPlayed);
  return played && played !== scheduledInnings(g) ? `Final/${played}` : 'Final';
}

// ---------- helpers ----------

const num = v => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);

function isFinal(g) {
  return g.status === 'final' && g.awayScore !== undefined && g.homeScore !== undefined;
}
// Each season has two phases: the regular season and the playoffs (games with "type": "playoff").
// Standings, stats and leaders are always for one phase.
function gamePhase(g) {
  return g.type === 'playoff' ? 'playoffs' : 'regular';
}
function countsForStandings(g, phase = 'regular') {
  return isFinal(g) && gamePhase(g) === phase;
}
function hasBoxScore(g) {
  return isFinal(g) && !!(g.batting && g.batting.length);
}

function sortedGames() {
  return [...DB.games].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}

function lineTeam(line) {
  return line.team || (DB.playersById[line.player] || {}).team;
}

// ---------- standings ----------

function computeStandings(phase = 'regular') {
  const rows = Object.fromEntries(DB.league.teams.map(t => [t.id, {
    team: t, w: 0, l: 0, t: 0, rs: 0, ra: 0, results: [],
  }]));

  for (const g of sortedGames()) {
    if (!countsForStandings(g, phase)) continue;
    const home = rows[g.home], away = rows[g.away];
    if (!home || !away) continue;
    const hs = num(g.homeScore), as = num(g.awayScore);
    home.rs += hs; home.ra += as;
    away.rs += as; away.ra += hs;
    if (hs > as) {
      home.w++; away.l++;
      home.results.push('W'); away.results.push('L');
    } else if (as > hs) {
      away.w++; home.l++;
      away.results.push('W'); home.results.push('L');
    } else {
      home.t++; away.t++;
      home.results.push('T'); away.results.push('T');
    }
  }

  const list = Object.values(rows).map(r => {
    const gp = r.w + r.l + r.t;
    r.gp = gp;
    r.pct = gp ? (r.w + r.t / 2) / gp : 0;
    r.diff = r.rs - r.ra;
    const last = r.results[r.results.length - 1];
    let n = 0;
    for (let i = r.results.length - 1; i >= 0 && r.results[i] === last; i--) n++;
    r.streak = last ? `${last}${n}` : '-';
    const l10 = r.results.slice(-10);
    r.last10 = `${l10.filter(x => x === 'W').length}-${l10.filter(x => x === 'L').length}` +
      (l10.includes('T') ? `-${l10.filter(x => x === 'T').length}` : '');
    return r;
  });

  list.sort((a, b) => b.pct - a.pct || b.w - a.w || b.diff - a.diff || a.team.name.localeCompare(b.team.name));
  const lead = list[0];
  for (const r of list) {
    r.gb = lead ? ((lead.w - r.w) + (r.l - lead.l)) / 2 : 0;
  }
  return list;
}

// ---------- player stats ----------

function emptyBat() {
  const o = { g: 0 };
  BAT_KEYS.forEach(k => (o[k] = 0));
  return o;
}
function finishBat(s) {
  s.pa = s.ab + s.bb + s.sf;
  s.tb = s.h + s['2b'] + 2 * s['3b'] + 3 * s.hr;
  s.xbh = s['2b'] + s['3b'] + s.hr;
  s.avg = s.ab ? s.h / s.ab : 0;
  s.obp = s.pa ? (s.h + s.bb) / s.pa : 0;
  s.slg = s.ab ? s.tb / s.ab : 0;
  s.ops = s.obp + s.slg;
  return s;
}
function addBatLine(s, line) {
  s.g++;
  BAT_KEYS.forEach(k => (s[k] += num(line[k])));
}
// Returns { batting: [...] } with one row per player who has appeared.
function computePlayerStats({ team = null, phase = 'regular' } = {}) {
  const bat = {};
  for (const g of DB.games) {
    if (!hasBoxScore(g) || gamePhase(g) !== phase) continue;
    for (const line of g.batting || []) {
      const t = lineTeam(line);
      if (team && t !== team) continue;
      const key = line.player;
      bat[key] = bat[key] || Object.assign(emptyBat(), { player: key, team: t });
      addBatLine(bat[key], line);
    }
  }
  return {
    batting: Object.values(bat).map(finishBat),
  };
}

// Number of games each team has a box score for (used for leader qualification).
function teamBoxScoreGames(phase = 'regular') {
  const counts = Object.fromEntries(DB.league.teams.map(t => [t.id, 0]));
  for (const g of DB.games) {
    if (!hasBoxScore(g) || gamePhase(g) !== phase) continue;
    if (g.home in counts) counts[g.home]++;
    if (g.away in counts) counts[g.away]++;
  }
  return counts;
}

function qualifiers(phase = 'regular') {
  const mins = DB.league.leaderMinimums || {};
  const pa = mins.plateAppearancesPerTeamGame ?? 2;
  const tg = teamBoxScoreGames(phase);
  return {
    batter: s => s.pa >= Math.max(1, pa * (tg[s.team] || 0)),
    paPerGame: pa,
  };
}

// Per-game lines for one player, oldest first.
function playerGameLog(playerId, phase = 'regular') {
  const log = [];
  for (const g of sortedGames()) {
    if (!hasBoxScore(g) || gamePhase(g) !== phase) continue;
    const b = (g.batting || []).find(l => l.player === playerId);
    if (b) log.push({ game: g, bat: b, team: lineTeam(b) });
  }
  return log;
}

// ---------- formatting ----------

const fmt = {
  avg: v => (v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, '')),
  pct: v => (v >= 1 ? '1.000' : v.toFixed(3).replace(/^0/, '')),
  gb: v => (v === 0 ? '-' : v % 1 ? v.toFixed(1) : String(v)),
  diff: v => (v > 0 ? `+${v}` : String(v)),
};

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return 'TBD';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Flat object on one line: {"a": 1, "b": "x"}
function inlineJSON(o) {
  return `{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
}

// Serializes games.json in a hand-editable layout: one field per line, one stat line per line.
function serializeGames(games) {
  const blocks = games.map(g => {
    const parts = Object.entries(g).map(([k, v]) => {
      if (Array.isArray(v)) {
        if (!v.length) return `    ${JSON.stringify(k)}: []`;
        return `    ${JSON.stringify(k)}: [\n${v.map(x => '      ' + inlineJSON(x)).join(',\n')}\n    ]`;
      }
      return `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    });
    return `  {\n${parts.join(',\n')}\n  }`;
  });
  return `[\n${blocks.join(',\n')}\n]\n`;
}
// teams.json uses the same one-row-per-line layout as players.json.
function serializeTeams(teams) {
  return serializePlayers(teams);
}
function serializePlayers(players) {
  return `[\n${players.map(p => '  ' + inlineJSON(p)).join(',\n')}\n]\n`;
}
