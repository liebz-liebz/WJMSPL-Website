# WJMSPL League Website

The website for the Winnipeg Jewish Men's Slo Pitch League: a simple, free-to-host site with **Schedule, Standings, Rosters, Stats and League Leaders**.

There's no database or server. Everything comes from data files, and the site works out standings, player stats
and leaders automatically from the game results. Each season has its own folder, so past seasons stay on the site:

| File | What's in it |
| --- | --- |
| `data/league.json` | League name, settings, the list of seasons and which one is current |
| `data/seasons/<year>/teams.json` | That season's teams: name, abbreviation, colour |
| `data/seasons/<year>/players.json` | That season's rosters: name, jersey number, team |
| `data/seasons/<year>/games.json` | That season's schedule, final scores, and (optionally) each game's box score |
| `data/admin.json` | Created by the admin setup: the GitHub connection, locked with the admin password and secret key |

Everything in the admin page edits one season at a time: the **Editing season** dropdown at the top picks which.

---

## After each game

Anyone with the admin password can do this. No GitHub account needed.

1. Go to the website and click **League admin** at the bottom of any page, then enter the admin password.
2. Under **Results**, pick the game from the dropdown.
3. Set **Status** to *Final* and enter both teams' runs.
4. If the game was shortened by the mercy rule, tick **Mercy rule** and enter **Innings played** (e.g. 5).
   The result then shows as e.g. "Final/5 · Mercy".
5. Optional but recommended: fill in the box score. Every player on each roster has a row; fill in only the players who played.
   The page warns you if the numbers don't add up (e.g. batters' runs ≠ the final score).
6. Click **Save to website**. The site updates within a few minutes.

Standings only need the final score. The box score is what feeds player stats and league leaders.
Only batting stats are tracked; team runs allowed show in the standings (RA).

### Game length

Two games between the same teams on the same day are treated as a doubleheader and scheduled for 6 innings each.
Every other game is 9 innings. The schedule labels doubleheader games automatically. To change a single game's length,
edit **Scheduled innings** on the admin page. To change the league defaults, edit `scheduledInnings` in `data/league.json`.

### One-time setup (site owner)

The website is stored on GitHub, so saving needs a GitHub access token. The owner sets it up once, and it gets stored
in `data/admin.json`, encrypted. Two passwords unlock it:

- the **admin password**, shared with everyone who enters results, and
- the **super secret key**, known only to the owner. It's required to change the admin password, change the secret key,
  or replace the GitHub token. It also signs in, so the owner can always get back in and reset a forgotten admin password.

1. Open the website's **League admin** page. Before setup, it shows the setup form.
2. Follow the steps on that page to create a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   with access to only this repository and **Contents: Read and write**. Pick the longest expiration allowed.
3. Paste the token, choose the admin password and the super secret key, and click **Connect & save**.

Later, under League admin → **Settings**, the owner can change either password or enter a new token when the old one
expires (other signed-in admins pick up the new token automatically). If the token expires, the admin page says so.
Sites set up before the secret key existed show a **Set the super secret key** form in Settings; do that once.

**About security:** the admin password is what stops people from editing the league data, so pick one that's hard to
guess (three or four random words works well) and change it if it leaks. The secret key stops admins from changing
passwords through the admin page; it isn't a hard barrier against a technical admin, because a signed-in browser holds
the GitHub token in order to save. Every save is recorded in the GitHub history, so any bad edit can be undone.
The token can only change this one repository.

## Other common edits

- **Add, edit or move players:** League admin → **Rosters**. Add one at a time, or open *Add many players at once* and paste
  one player per line (`name, team, jersey number`). Moving a player to a new team keeps their past stats with the old team.
- **Add, reschedule or delete games:** League admin → **Schedule**. Add one game with the form, or paste many at once
  (see below). Every game is listed underneath and can be edited in place. A game's *Type* can be Regular or *Playoff*;
  playoff games are kept separate (see Playoffs below).
- **Postpone or cancel a game:** League admin → **Results**, pick the game, and change its status.

### Adding a whole schedule at once

League admin → **Schedule** → *Add many games at once*. Paste one game per line, in this order:

```
date, time, away team, home team
2027-05-12, 6:30 PM, Thunder, Riverhawks
5/12/2027, 8:00 PM, THU, RIV
May 19, 6:30 PM, Hornets, Pioneers
```

Copying those four columns straight out of a spreadsheet works too. Teams can be names or abbreviations; dates with no year use the
year of the season you're editing; times without AM/PM between 1 and 7 are read as PM. Click **Check** to see how every line
was read (and which ones couldn't be), then **Add** and **Save to website**.

### Teams

League admin → **Teams** edits the teams of the season you're editing: names, abbreviations (shown next to players in
stats and on the calendar) and colours. A team can be deleted once it has no players or games. Renaming a team keeps
all its games and stats. The league's name lives in `data/league.json` (edit on GitHub).

### Settings in `league.json`

- `scheduledInnings`: default game length for single games (`singleGame`) and doubleheaders (`doubleheader`).
- `leaderMinimums`: how much a player must play to qualify for the rate-stat leaderboards (AVG, OBP, SLG, OPS).
  `plateAppearancesPerTeamGame: 2` means 2 plate appearances for every game their team has a box score for.
- `github`: the repository the admin page saves to (pre-fills the setup form).

## Seasons

Visitors pick a season with the **Season** dropdown on the Schedule, Standings, Rosters, Stats and Leaders pages (the
choice stays as they move between those pages, and is part of the page address, so links can be shared). The home page
always shows the **current season**.

**Starting a new season:** League admin → **Seasons** → *Start a new season*. Give it a name (e.g. `2027`), choose
whether to copy the teams and rosters from the season you're editing, and whether to make it the current season.
It starts with no games; add them in the **Schedule** tab. Copied players keep their IDs, and copied teams and
rosters can be edited without affecting the old season.

**Past seasons:** use the **Editing season** dropdown (or *Edit* on the Seasons tab) to fix or fill in an older
season. To add a season from before the site existed, start it from the Seasons tab with *Make it the current season*
unticked, then fill in its teams, rosters and games. *Make current* on the Seasons tab switches the current season.

## Playoffs

Playoff games live in the same season as the regular season, marked as *Playoff*. The Season dropdown lists each season
twice, e.g. **2026** and **2026 (Playoffs)**. The regular-season view leaves playoff games out entirely; the playoffs
view shows only them: its own schedule and calendar, playoff records instead of the standings table, and playoff-only
stats, leaders and player game logs. The home page shows the current regular season's standings and leaders, with
playoff games appearing in its latest results and upcoming games.

**Scheduling playoffs:** League admin → **Schedule**. Add one game with *Type: Playoff*, or paste a round of games and
tick **These are playoff games** before adding them. Enter results in the **Results** tab as usual (playoff games are
labelled there). The Schedule list's filter can show just the playoffs.

## Hosting (GitHub Pages, free)

1. In this repository on GitHub: **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute, the site is live at `https://<your-github-username>.github.io/<repository-name>/`.

GitHub Pages is free for public repositories. Private repositories need a paid GitHub plan for Pages.

## Previewing on your own computer

From this folder, run `python3 -m http.server` and open http://localhost:8000. (Opening `index.html` directly
won't work because browsers block loading the data files that way.) Saving from a local copy still writes to GitHub.

## Changing the site's code

Browsers keep copies of the site's files for a few minutes. Whenever you change anything in `css/` or `js/`, bump the
`?v=` number on every stylesheet and script link in `index.html` (e.g. `?v=2` → `?v=3`). Otherwise visitors can get the
new page with old styles or scripts, which looks broken until their copy expires. Data files don't need this.

## How the files fit together

```
index.html        page shell + navigation
css/style.css     all styling (colors are at the top)
js/data.js        loads data files; computes standings, stats, leaders
js/app.js         public pages: home, schedule (list + calendar), standings, rosters, stats, leaders, box scores, player pages
js/admin.js       League admin page (sign-in, editing season, results entry, rosters)
js/admin-lock.js  admin password + super secret key (data/admin.json) and the Settings tab
js/admin-schedule.js  League admin → Schedule tab (add, paste and edit games)
js/admin-teams.js League admin → Teams and Seasons tabs
data/             the league's data (league.json, admin.json, seasons/<year>/)
```
