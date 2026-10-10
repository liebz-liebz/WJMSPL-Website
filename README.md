# WJMSPL League Website

A simple, free-to-host website for the league with **Schedule, Standings, Rosters, Stats and League Leaders**.

There's no database or server. Everything comes from three data files, and the site works out
standings, player stats and leaders automatically from the game results:

| File | What's in it |
| --- | --- |
| `data/league.json` | League name, season, teams (name, short ID, color), settings |
| `data/players.json` | Every player: name, number, team, position |
| `data/games.json` | The schedule, final scores, and (optionally) each game's box score |

> The data that ships with the site is **made-up sample data** so you can see how everything looks.
> Replace it with your real teams, players and schedule before the season (see below).

---

## After each game (the easy way)

1. Go to the website and click **League admin** at the bottom of any page.
2. Under **Games & Results**, pick the game from the dropdown.
3. Set **Status** to *Final* and enter both teams' runs.
4. Optional but recommended: fill in the box score. Every player on each roster has a row; fill in only the players who played.
   The page warns you if the numbers don't add up (e.g. batters' runs ≠ the final score).
5. Click **Save to website**. The site updates within a few minutes.

Standings only need the final score. The box score is what feeds player stats and league leaders.

### One-time setup to enable "Save to website"

The Save button writes to this GitHub repository, so it needs a GitHub access token on your device:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access:** *Only select repositories* → this repository
   - **Permissions → Repository permissions → Contents:** *Read and write*
2. On the website, open **League admin → Setup**, paste the token, and click **Save & test connection**.

The token stays in that browser only. Anyone can open the admin page, but only someone with a token can save changes.
Each person who enters results can make their own token.

**No token?** Use **Download games.json**, then on GitHub open the `data` folder → **Add file → Upload files** →
drop the file in → **Commit changes**.

## Other common edits

- **Add, edit or move players:** League admin → **Rosters**. Moving a player to a new team keeps their past stats with the old team.
- **Add, reschedule, postpone or delete a game:** League admin → **Games & Results** (use **+ New game** to add one).
  A *Playoff* game shows on the schedule but doesn't count in standings or season stats.
- **Teams, league name, season:** edit `data/league.json` directly on GitHub (click the file → pencil icon).
  Each team needs a short `id` (like `THU`) that the other files use to refer to it.

### Settings in `league.json`

- `inningsPerGame`: used for ERA and K/9 (e.g. set to `7` for 7-inning games).
- `leaderMinimums`: how much a player must play to qualify for the rate-stat leaderboards (AVG, OBP, ERA, WHIP).
  `plateAppearancesPerTeamGame: 2` means 2 plate appearances for every game their team has a box score for.
- `github`: the repository the admin page saves to.

## Starting the real season

1. In `data/league.json`, set the league name, season and your teams.
2. In `data/games.json`, replace everything with `[]`, then add your schedule using **+ New game** on the admin page
   (or edit the file directly; each game needs `id`, `date`, `time`, `location`, `away`, `home` and `"status": "scheduled"`).
3. Replace `data/players.json` with `[]` and add your players under League admin → **Rosters**.

## Hosting (GitHub Pages, free)

1. In this repository on GitHub: **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute, the site is live at `https://<your-github-username>.github.io/<repository-name>/`.

GitHub Pages is free for public repositories. Private repositories need a paid GitHub plan for Pages.

## Previewing on your own computer

From this folder, run `python3 -m http.server` and open http://localhost:8000. (Opening `index.html` directly
won't work because browsers block loading the data files that way.)

## How the files fit together

```
index.html        page shell + navigation
css/style.css     all styling (colors are at the top)
js/data.js        loads data files; computes standings, stats, leaders
js/app.js         public pages: home, schedule, standings, rosters, stats, leaders, box scores, player pages
js/admin.js       League admin page
data/*.json       the league's data
```
