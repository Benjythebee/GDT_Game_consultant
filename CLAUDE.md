# Game Dev Tycoon Helper

A static web page that helps plan games in *Game Dev Tycoon*. The user picks topic / genre / second genre /
audience / platform(s); every other list is re-rated against those picks and poor matches are hidden. Once a genre
is picked, the side panel shows a development plan (Tech/Design target, slider priorities per stage) and an
engine-feature recommender.

The user's stated goal is "a tool that makes game development in Game Dev Tycoon a breeze". The original request
was numbered "1." (the filtering tool). The second is the in-game mod "Game Consultant" in `mods/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: header controls, `#fields` (left column), `#summary` (right column), footer. Loads `data.js` then `app.js`. |
| `app.js` | All logic, one IIFE, vanilla JS, no dependencies. Scoring, rendering, URL-hash state. |
| `styles.css` | Color tokens on `:root` with dark mode (`prefers-color-scheme` + `[data-theme]`). Rating classes `r-great/r-good/r-okay/r-neutral/r-bad/r-terrible` set `--rc`. |
| `data.js` | **Generated**: `window.GDT_DATA = {...}`. Do not edit by hand. |
| `scripts/build_data.py` | Downloads the wiki pages through the MediaWiki API and regenerates `data.js`. |
| `.claude/launch.json` | `static` (web page, port 8765) and `game` (the real game in a browser via `mods/dev/serve_game.py`, port 8766). |
| `mods/game-consultant/` | In-game mod (request "2."): `package.json` + one ES5 script `consultant.js`. See "Game mod" below. |
| `mods/dev/` | `serve_game.py` (browser harness for the installed game) and `dev_tools.js` (`GDTDev.newCompany/openConcept/openStage`). |
| `mods/install.ps1` | Junctions (or `-Copy`) a mod into `<game>\mods`. |
| `mods/workshop/` | Steam Workshop material: `PUBLISHING.md` checklist, `description.bbcode.txt`, `screenshots/` (1600x900). |
| `mods/dev/screenshots.mjs` | Headless Chrome/Edge over the DevTools protocol (Node 24 built-in WebSocket) drives the harness and writes the Workshop screenshots; `make_preview.py` builds `game-consultant/image.png` (Pillow). |

The mod folder ships as-is to the Workshop, so keep only `package.json`, `consultant.js` and `image.png` in it.

No build step, no package manager, no tests. The page also works when opened straight from disk (`file://`), which
is why data is a `.js` global and not fetched JSON. Keep it that way.

## Data pipeline

```
python scripts/build_data.py
```

Sources (fetched via `https://gamedevtycoon.fandom.com/api.php?action=parse&prop=wikitext&formatversion=2&page=...`):

- `Game_Development_Based_on_Experience/1.4.3`, which has 7 wikitables, read by index `T[0]..T[6]`:
  0. Topic -> genre (6) + audience (Y/E/M) ratings, 66 topics
  1. Platform -> genre + audience ratings, 29 platforms (last row `Custom Console` is all `???` -> `null`)
  2. Dev ratio: Design/Tech % of points produced by each of the 9 sliders
  3. Single-genre focus: T/D target + importance of each slider
  4. Multi-genre focus: same, keyed `"Genre1/Genre2"` (30 ordered pairs, first genre weighs 2x)
  5. "For dummies" slider presets (0/50/80/100) per single genre
  6. Specialization requirements (Design/Tech stats) per slider
- `Custom_Game_Engine`: one table per `===Section===`, giving 68 engine features. DRM (pirate mode only) is skipped.
  Sections map to slider areas (`Dialogue` -> `Dialogues`, `Artificial Intelligence` -> `AI`).

Parsing notes / gotchas:
- Ratings are read from the cell **background color**, not the text (the wiki has a stray `-` where `~` was meant):
  `rgb(50,150,50)`=3 (+++), `60,120,60`=2 (++), `70,90,70`=1 (+), `80,80,80`=0 (~), `120,60,60`=-2 (−−), `150,50,50`=-3 (−−−).
- Spacer cells (`border: 0`) are dropped.
- Some topics carry an unexplained `*` on the wiki (Detective, Law, Music, Mystery, Racing, Rhythm, Sports); it is stripped.
- Feature tables have inconsistent markup (`|  |value`, multi-line cells, optional `Group` column); `fcell()` and the
  continuation-line join in `tables()` handle this. All graphics features share group `Graphics` except Advanced Stereoscopic 3D.
- `Software Development Kit` and `Multi-Platform Optimization` have benefit 0 (shown as "utility").

`GDT_DATA` shape: `genres`, `audiences` (`Y/E/M`), `focus` (9 slider names in stage order), `topics[name].{genre,audience}`,
`platforms[name].{genre,audience}`, `devRatio.{Design,Tech}[slider]`, `genreFocus[g].{td,f}`, `multiFocus["A/B"].{td,f}`,
`sliders[g].{td,f}` (percent presets), `specialization[slider].{design,tech}`,
`features[] {name, area, group, benefit, rp, engineCost, devCost, after}`, `source`, `featuresSource`.

## How the app scores options (app.js)

- `sel = {topic, genre, genre2, audience, platforms[]}`. Platforms are multi-select.
- **Links** (`eachLink`): topic×genre, topic×genre2, topic×audience, platform×genre(s), platform×audience. Null ratings
  (Custom Console) are ignored. There is no topic×platform or genre×audience relation in the data.
- **Badge on an option** = the worst *direct* link between that option and what is already picked. If the option has no
  direct link (e.g. platforms when only a topic is picked) the badge is the best reachable full combination
  (`bestCompletion`, brute force over the empty fields, ~33k combos max) and is drawn **outlined** (`.indirect`).
  An earlier version used best-reachable for everything; it was changed because it showed Airplane+Strategy as `++`
  when the direct match is `+++`, which confused things.
- Combinations compare lexicographically by `[worst link, sum of links]`.
- Filtering: hide when the rating is below the "Hide options rated below" threshold (default Okay, which hides Bad and
  Terrible). Selected options always show. Custom Console is never rated or filtered (`?` badge).
- Badges only appear when some *other* field is picked.
- "Fill in the best rest" applies `bestCompletion(sel)`.
- Search boxes: type to filter, Enter picks the first visible match, Escape clears. Only chip containers and the summary
  are re-rendered, so the input keeps focus. Keep it that way.
- State lives in the URL hash (`#topic=Airplane&genre=Action&platforms=PC,G64`), restored on load and on `hashchange`.
- Verdict: "Great combo" needs **every** topic/genre link to be +++ (the wiki says multi-genre great combos need both
  genres to be great with the topic).

## Game mechanics knowledge (from wiki research)

Review score / quality:
- Reviews compare your *game score* against your own previous best (+~10–20%), not an absolute bar, so consistency
  matters more than one-off quality. Game score ≈ (Design + Tech) / size modifier × quality modifiers (~0.6–1 each).
- Quality modifiers: Tech/Design balance vs the genre target (|t| ≤ 0.25 gives a bonus), slider time allocation,
  topic/genre combo, genre/platform combo, trends, bugs.
- Slider rules: for `+++`/`++` areas give at least two of them 40%+ of the stage bar and none 20% or less; `~` is free;
  `−−`/`−−−` should never get 40%+.
- Topic/audience and platform/audience mostly affect **sales**; platform/genre slightly affects reviews.
- Avoid: same topic+genre twice in a row; sequel before 40 weeks; sequel on the same engine; Large without 2D V4 / 3D V3+;
  AAA without 3D V5+; AAA without 3 specialists in the genre's important fields. Perfect 10/10/10/10 needs ≥2 experts
  in ≥0.9-importance fields (so Small games cap at 10/10/10/9).
- Custom consoles: genre/audience ratings come from your release history (two most-used genres +++, third ++, 4th–5th +, 6th −−).

Engine features (no genre affinity exists in the game code):
- Each feature belongs to one slider area and adds "benefit" points only while that area is being developed.
- Benefit is capped by time allocated to the area × game size (`Mission Feature Efficiency = 20 × mission% / (Σbenefit × sizeFactor)`,
  clamped 0–100). An in-game **%** on an area means more feature benefit than the time can absorb, i.e. wasted money.
  Hence: features in a genre's `−−`/`−−−` areas are mostly wasted; in `+++`/`++` areas they pay off.
- Features shift T/D balance by their area's split: Engine/AI 20/80 D/T, Gameplay/Story 80/20, Dialogues 90/10,
  Level Design 40/60, World Design/Sound 60/40, Graphics 50/50.
- One feature per group (Story, Cut Scenes, Multiplayer, Sound, Soundtrack, Voice acting, Body language, Graphics).
- Graphics: tech level = average of all graphics features in the engine + platform tech level, so use only the newest one.
- Cooperative Play costs more than Skill trees + Character progression combined and gives less.
- MMO needs a +++ topic/genre combo (otherwise −0.15 quality); expansions within 40 weeks of each other cost −0.4.
- Guide advice: add features gradually (cheapest first) so the game score doesn't jump and raise the bar for later games.

Per genre (single) — invest / skip areas:
- Action (T/D 1.8): invest Engine, Gameplay, Level Design, AI, Graphics, Sound; skip Story, Dialogues
- Adventure (0.4): invest Story, Dialogues, World Design, Graphics; skip Engine, AI
- RPG (0.6): invest Gameplay, Story, Dialogues, Level Design, World Design, Graphics; skip Engine
- Simulation (1.6): invest Engine, Gameplay, Level Design, AI, Graphics, Sound; skip Dialogues
- Strategy (1.4): invest Engine, Gameplay, Level Design, AI, World Design, Sound; skip Dialogues
- Casual (0.5): invest Gameplay, Level Design, Graphics, Sound; skip Engine, Story, Dialogues, AI, World Design

Useful wiki pages: `Review_Algorithm/1.4.4`, `Tech_and_Design_Points_Generation_Algorithm`, `Success_Guide`,
`Success_Guild_updated_for_1.7.8`, `Raw_Data_for_Review_Algorithm/1.4.3`, `Game_Development_Based_on_Experience/1.6.11`
(newer topics/consoles, not yet used here), `Research_Unlocks`, `Sales_Algorithm`.

## Game mod (mods/game-consultant)

- The game is installed at `D:\SteamLibrary\steamapps\common\Game Dev Tycoon` (1.7.9). Its source is
  `compressed\codeNw.js` (beautify with `npx js-beautify` into the scratchpad to read it); templates are in
  `defaultBrowser.html`, CSS in `css\layout.css`. Mods load from `mods\` and Workshop mods from `mods_ws\`.
- It runs on node-webkit with **Chromium 30**: ES5 only, keep the file **ASCII** (write `\u00b7` etc.; the Edit tool
  turns `\u` escapes into literal characters, so re-escape afterwards) and check with acorn `ecmaVersion: 5`.
- Scoring mirrors `Reviews.rateGame`, `Sales.calculateSales` and point generation (`General.getD/getT`), using the game's
  live objects (topics incl. `missionOverrides`, platforms, `Missions.getGenreWeighting`) instead of wiki data. The
  platform mix re-implementation was checked equal to `Platforms.getGenreWeighting` on 23k combos.
- Hooks wrap `UI.showGameDefinition`, `UI._updateGameDefinitionNextButtonEnabled` (called after every change in the
  concept dialog), `UI.pick*Click` (pickers open with no argument, select with an element), `UI.showFeatureList` and
  `UI._updateFeatureFocusPreview`. Picks are read from the dialog's button texts, like the game does.
- The concept dialog is a fixed 600x650 box with `overflow:hidden` and the Next button in the flow, so the consultant
  is a card beside `#simplemodal-container`. The stage dialog has the game's own side panels, so there the mod adds a
  fixed 38px strip above the sliders and shrinks the sliders by the same height (`.gc-compact`).
- Slider values must be applied through the slider's `slide` option callback; the game reads values from a closure.
- Staff (medium+ games, `game.isStaffResponsibilityEnabled()`): `General.getResponsibleStaffFactor` scales the whole
  team's output per area by the responsible person's skill, expert bonus and workload. `staff.flags.workload` is the
  sum of assigned shares (percent) over the game, reset in `createNewGame`; effective % = workload x optimalTeamSize/3.
  New games copy the previous game's `featureResponsibility`. Assigning = set `game.flags.featureResponsibility[missionId]`
  plus the `.focusSliderStaffName` label text (the OK button validates labels). The planner alternates
  slider plan -> best assignment (n^3) -> re-plan -> re-assign. Experts on >=0.9 areas: 2 enable perfect scores,
  AAA cap is 10 - 0.6 per missing (of 3).
- `Game` defaults `targetAudience` to "everyone"; detect sequels with `sequelTo`, not the audience.
- Sequels: "Develop Sequel..." sets `GameManager.flags.selectGameActive` and opens `UI.showGameHistory(cb, true)`, a
  jQuery UI dialog (`#gameHistoryDialog`, z-index 6000) with a RoyalSlider; the shown game is `.rsActiveSlide .gameId`.
  The mod wraps `showGameHistory` and keeps a fixed card next to it (polls the active slide every 250 ms, removes itself
  when the dialog closes). Rules: `sequelsTooClose` is judged at the sequel's release (original released < 40 weeks
  earlier), engine bonus needs a higher `techLevel` than the original's engine. Dev time = average `flags.devTime` of the
  company's games of that size (My Company Corp: medium ~12 weeks vs 8 from the base formula).
- Publishing deals: "Find Publishing Deal..." sets `uiSettings.selectedContractType = 'gameContract'` and shows
  `UI.showFindContractWorkMenu` (`#findContractWorkWindow`, RoyalSlider, slide `.cardId` = index into the offered list).
  The list only lives in that function, so the mod wraps it and temporarily wraps `ProjectContracts.getAvailable` to
  capture it (never call getAvailable itself: it advances the offers). Contract fields: topic/genre/platform ids,
  gameSize, gameAudience, minScore, payment, penalty, royaltyRate; `_setContractRequirements` turns them into
  `lockedSettings`. Expected score = average of the last 5 games' `score` x the combo's % of the best game.
- Harness + real saves: the game shows a "mods mismatch" dialog when a save's `company.mods` differs from the enabled
  mods; `GDTDev.loadSave` clears both in the browser copy.
- Harness gotchas: the game re-renders `<body>` with jQuery (re-running body scripts), so mods are injected from
  `<head>` after `load`; calling `transitionToState(State.CreateGame)` while the concept dialog is already open
  re-renders it blank. Staff never make progress in the harness, hence `GDTDev.openStage`.

## Conventions

- Vanilla HTML/CSS/JS only; no frameworks, CDNs or build tools. Match the existing style: 2-space indent, single quotes,
  string-concatenated HTML with `esc()` for every dynamic value, sparse comments.
- Colors only through the CSS tokens; any new color needs light and dark values.
- Layout must work at phone width (single column below 960px; the summary is sticky and scrolls on its own on desktop).
- Regenerate `data.js` with the script rather than editing it; extend `build_data.py` for new wiki tables.

## Verifying changes

Start the `static` preview (`.claude/launch.json`, port 8765) and load e.g.
`http://localhost:8765/#topic=Airplane` (Adventure must be hidden in Genre) or
`#topic=Fantasy&genre=RPG&genre2=Adventure` (multi-genre plan + features). Opening `index.html` from disk in the Browser
pane renders a static snapshot without scripts, so use the server there. Check the console for errors.

For the mod: start the `game` preview (1280x800 viewport), then in the console `await GDTDev.newCompany({year: 11,
licence: ['Playsystem']}); await GDTDev.openConcept();` (call each once; reload with `localStorage.clear()` between runs).
To test on the user's real company: `python mods/dev/export_save.py --name <name>` (backs up the saves into
`mods/dev/saves/<name>/` without opening the live DB, plus `snapshot.json`), then `await GDTDev.loadSave('<name>')` and,
after the reload, `await GDTDev.continueGame()`. A backup of the user's main company (slot 2, year 15, 7 staff, Medium research
only) is in `mods/dev/saves/backup-2026-11-02`; its snapshot was made with `--company-name "My Company Corp"`, so the
harness shows that name (the backup's raw files keep the real one). Refer to it as "My Company Corp". Never write to `%LOCALAPPDATA%\Game Dev Tycoon - Steam` or the Steam
Cloud folder. `GDTDev.hireStaff([...])` adds employees (pick Medium+ to get responsibilities). After closing the concept with a combo,
`await GDTDev.openStage(1..3)`. Tutorials are turned off through the game's own setting (not by clicking popups or
flags); random events are postponed. The harness only proves logic and layout in modern Chrome; the real game is
Chromium 30.

## Git

Private repo: https://github.com/Benjythebee/GDT_Game_consultant (branch `main`), holding the whole folder (web helper
and mods). `mods/dev/saves/` is gitignored: it holds the user's real save backups and must never be committed.
