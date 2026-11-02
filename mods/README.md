# Game Dev Tycoon mods

## Game Consultant

An in-game advisor for planning games. It reads the live game data, so it accounts for the topics you have researched,
the genres and features you have unlocked (multi-genre, target audience, multi-platform), which consoles are on the
market right now (released and not retired), which you own a licence for, your cash, your game history and the current
market trend.

**Game Concept dialog**
- Every topic, genre, second genre, platform and audience button gets a badge: **★ Best**, or how good the best game
  you can still make with that choice is, compared with the best option (for example `92%`). The badge also shows the
  direct match (`+++ RPG`, `Genre ++ · Audience +++`). Options below 80% are dimmed.
- **Hide poor options in the lists** hides those options instead and sorts every list best-first.
- A Consultant card next to the dialog rates your current combo (topic/genre, topic/audience, platform/genre,
  platform/audience, trend, multi-platform tech gap, repeating your last game), names the best combo you can make,
  and tells you when licensing another console would beat it.
- **Create perfect combo automatically** picks topic, genre(s), audience and platforms. It only uses platforms you
  already own, keeps the number of platform slots you have filled (at least one), respects the game size you picked
  (Gameling, Vena Gear, grPhone and similar handhelds can't do Large/AAA games) and never touches settings the game
  has locked (expansion packs). Ties go to combos you haven't made yet, then to topics you haven't used for longest.

**Your own consoles**
- Custom consoles from the hardware lab are rated like any platform, with the genre/audience weightings the game gave
  them from your release history (your two most-made genres +++, the third ++, ...).
- Releasing a game on your own console also sells consoles: while the game is in the top-100 chart, the console's
  weekly sales grow by up to +100% (`Sales.getSalesAnomalyForConsole`). The consultant simulates the console's
  remaining sales from the game's release (about 12 chart weeks near the top) and converts that money into market
  size using what your recent finished games earned per unit of platform market. The card shows it as
  *"Own console: ~16.5M extra console sales"*, and the console's platform badge lists it.
- A strong console (2.5M planned units) becomes the best platform for its +++ and ++ genres; for genres it rates
  poorly, a better-matching console still wins.

**Sequels and expansion packs**
- **Develop Sequel...** opens the game's "Select Game" list; a Consultant window beside it rates the game you are
  looking at, e.g. *"This game is currently a great pick for a sequel on Playsystem 2 for Everyone audiences."*, or
  *"Wait 21 more weeks..."*, and explains why:
  - timing: the game checks at release, so the sequel must ship 40+ weeks after the original (it uses your own average
    development time for that game size). Too soon costs 0.4 of the review bonus, turns marketing hype negative and
    loses fans;
  - engine: a sequel on an engine with a higher tech level than the original's gets +0.2 and 20% more hype; reusing
    the original's engine costs 0.1 and halves the hype bonus;
  - the combo's ratings on the best platform on the market now (flags originals whose console has retired), the
    "same topic and genre as your last game" penalty, and how it compares with the best new game you could make.
- It also lists the best picks right now; click one to jump to it in the game's list.
- In the Game Concept dialog of a sequel, the card repeats the timing and checks the engine you picked, and
  **Create perfect combo automatically** keeps the original's topic and genres and picks audience, platforms and the
  newest engine.

**Publishing deals**
- **Find Publishing Deal...** gets a Consultant window beside the offers. For each deal it works out the best game the
  deal's fixed topic / genre / platform / size / audience still allows, and how close that is to your best game of
  that size, e.g. *"Great deal: make Pirate · Adventure · Everyone · PC (99% of your best medium game)."*
- It compares the deal's minimum review score with what to expect (your last five games' average scaled by that
  percentage) and warns when the penalty is at risk; it also shows the up-front pay, royalty share, a missing platform
  licence and whether your team fits the game size.
- **Best value deals** ranks them: deals you can take first (closest to 100%, safe minimum score), then the ones
  locked behind an unresearched topic ("research Vocabulary"). Click one to jump to it.
- After accepting, the Game Concept card shows the deal's minimum score against the expected score, and
  **Create perfect combo automatically** fills only what the deal leaves open.

**Development stages**
- Each slider shows the area's weighting for *this* game (genre plus the topic's overrides, e.g. Sports games care
  more about Gameplay than Engine), a recommended slider value with the time share it gives, and a dashed marker.
- The strip above the sliders shows how close your current allocation is to the best plan, the expected tech/design
  ratio at release against the genre target, the expected review bonus, and the plan for the remaining stages.
- **Apply recommendation** sets the sliders; **Auto-apply** does it at every stage.

**Additional features**
- Each area turns at most `share% / (5 x size factor)` of feature benefit into points (size factor 1, Large 0.7,
  AAA 0.4; `General.getFeatureEfficiencyFromMissionFocus`). Past that the game shows "(x%)" on the area and the extra
  features are paid for but add nothing. Feature costs also grow faster than their benefit (about 5K per point at
  benefit 1-2, 15K at 10, 28K at 14, times the game size).
- In every stage's "Selected Features" list, the consultant fills each area's capacity with features you already have,
  then the selected ones with the cheapest benefit per dollar, and tags the rest at your current sliders:
  **✗ wasted**, **mostly wasted**, or **pricey** (over 3x the cost per useful point of the cheapest useful feature).
  The tooltip gives the numbers. Tags update as you move the sliders. Example: with Gameplay at 24%, Character
  progression (60K) was ✗ wasted and Achievements mostly wasted; dropping both removed the game's "(48%)" and saved 80K.
- On the Game Concept feature screen, the newest graphics type is marked **★ most points** (its tech level adds base
  points to every area), and older ones say **✗ caps reviews at N** when the game is Large (needs tech 3) or AAA
  (needs tech 5).

**Employees (medium games and up)**
- From medium size on, every area needs a responsible person. The consultant suggests one per area (shown under the
  slider, e.g. `→ Ada (expert)`), and **Apply sliders + staff** assigns them as if you had dragged them there.
- It plans sliders and people together, because the game ties them: the responsible person's design/tech skill
  multiplies the whole team's output in that area (+15% of their skill if they are the area's expert), and their
  workload bar is the sum of the time shares they are responsible for over the whole game, scaled to the game size's
  ideal team (medium 3, large 5, AAA 6). Above 100% their factor drops 75% per 100% and they make more bugs; below
  100% it drops 25% per 100%.
- Later stages see the workload already used: people loaded up in stage 1 are spared afterwards.
- The strip warns about unassigned areas and anyone pushed over 100%, and its tooltip counts experts on the game's
  key areas: 2 are needed for a perfect 10/10/10/10, and an AAA game's score is capped 0.6 lower per missing expert
  (of 3).
- In the Game Concept card, medium+ games show your team size against the ideal for that size and which key areas of
  the combo have an expert. For AAA, the perfect combo also prefers genres your experts cover (with Story, Dialogue
  and World Design experts it picks an RPG over an Action game).

### How it scores

The rules are taken from the game's own code (`compressed/codeNw.js`, version 1.7.9), not from the wiki:

- Topic/genre weighting multiplies every design and tech point. A second genre counts one third.
- The review score is multiplied by the platform/genre weighting (1.1 for +++ down to 0.9), the topic/audience
  weighting, a platform/audience penalty for weak (≤ 0.7) matches, a tech-level gap penalty when mixing consoles, and the
  current trend (×1.2 for the trending genre, audience or a new topic).
- A topic/genre or topic/audience match of 0.7 or worse halves the part of a review score above 6/10 (counted as
  ×0.8); making the same topic and genre(s) as the last game costs 0.4 of the review bonus (counted as ×0.6).
- Market size only breaks ties: half the market costs about 7%.
- Sliders: share of a stage = 10% + 70% × value / sum of values. Over the whole game, two or more areas weighted ≥ 0.9
  at ≥ 40% earn +0.2 (one: +0.1, none: −0.15); areas weighted < 0.8 at ≥ 40% cost 0.1 each; areas weighted ≥ 0.9 at
  ≤ 20% cost 0.15 each; a tech/design ratio within 25% of the target earns +0.1 (more than 50% off: −0.1). The planner
  maximises `(1 + bonus) × (design + tech)` over the remaining stages, using your staff's design/tech skills and the
  engine features you picked.

Settings (filter, auto-apply) are saved with the game's settings through the official modding API.

## Install

The game loads mods from `<game folder>\mods\<mod>\package.json`. On this machine that is
`D:\SteamLibrary\steamapps\common\Game Dev Tycoon\mods`.

```powershell
.\mods\install.ps1
```

This links `mods\game-consultant` into the game's mods folder (`-Copy` copies instead, `-GameDir` points at another
install). Then start the game, open **Mods** from the main menu, click **Game Consultant** so it turns green and restart
the game. It depends on the official *Game Dev Tycoon Mod API*, which ships with the game and is enabled with it.

Publishing material (preview image, Workshop description, screenshots) and the step-by-step checklist are in
[workshop/PUBLISHING.md](workshop/PUBLISHING.md). To share it through the Steam Workshop, use the game's own uploader (main menu, Mods, **Publish Mod** / **Update Mod**).
Subscribed Workshop mods are downloaded into `mods_ws` and take priority over a manual install with the same id and an
equal or newer version.

## Writing mods (notes from 2026)

- Game Dev Tycoon 1.7.9 (October 2025) still runs on **node-webkit with Chromium 30**: mods must be plain **ES5**
  (no `let`/`const`, arrow functions, template literals, `Promise`, `Array.prototype.find`...). jQuery 1.7.2 and
  jQuery UI 1.8 are available as `$`.
- A mod is a folder with `package.json` (`id`, `name`, `version`, `author`, `description`, `url`, `main`, optional
  `image`, `dependencies` such as `{"gdt-modAPI": "0.1.x"}`) and its scripts. The official API mod lives in
  `mods\gdt-modAPI` (docs: https://github.com/greenheartgames/gdt-modAPI/wiki). It adds `GDT.addTopics`,
  `GDT.addPlatform`, `GDT.addEvent`, `GDT.addResearchItem`, `GDT.getDataStore(id)` and the `GDT.on(GDT.eventKeys...)`
  events.
- Most useful mods wrap functions on the global `UI`, `GameManager`, `General`, `Platforms` objects. The compressed
  source is `compressed\codeNw.js`; run it through a beautifier (`npx js-beautify`) to read it.
- Developer tools: the API wiki says to set `"toolbar": true` in the game's `package.json` and use the node-webkit
  toolbar (documented up to 1.7.1, not tried on 1.7.9). For quick iteration without restarting the game, use the
  browser harness below.

### Browser harness

`mods/dev/serve_game.py` serves the installed game to a normal browser, stubs the NW.js `require`, and loads the mods
listed in `DEV_MODS` plus `mods/dev/dev_tools.js`:

```
python mods/dev/serve_game.py --game "D:/SteamLibrary/steamapps/common/Game Dev Tycoon"
```

Open http://localhost:8766/ and use the console helpers:

```js
await GDTDev.newCompany({ year: 11, licence: ['Playsystem'] }); // all topics, main research, platforms of that year
GDTDev.hireStaff([{ name: 'Ada', d: 0.6, t: 1.3, expert: 'Engine' }]); // employees (UI skill = 500 x d/t)
GDTDev.launchConsole({ name: 'Corp Station', startAmount: 0.6, unitsSold: 2.5 }); // a released custom console
await GDTDev.openConcept();                                      // the Game Concept dialog
await GDTDev.openStage(2);                                       // stage dialog of the game in development
await GDTDev.openSequel();                                       // "Develop Sequel..." (openSequel(true): expansion pack)
await GDTDev.openPublishingDeals();                              // "Find Publishing Deal..."
```

#### Testing with your own save

The Steam version keeps every save in node-webkit's localStorage,
`%LOCALAPPDATA%\Game Dev Tycoon - Steam\Local Storage\file__0.localstorage` (SQLite; `slot_<n>` is a save, `<n>` its
header), and Steam Cloud keeps plain copies in `Steam\userdata\<id>\239820\remote`.

```
python mods/dev/export_save.py --name my-backup
```

copies both into `mods/dev/saves/my-backup/` (it never opens the live files) and writes `snapshot.json`. Add
`--company-name "My Company Corp"` to rename the companies in the snapshot (handy for screenshots); the backup files
keep the real name, and `--from mods/dev/saves/my-backup` rebuilds a snapshot from an existing backup. In the
harness:

```js
await GDTDev.loadSave('my-backup');   // replaces the harness's storage and reloads the page
await GDTDev.continueGame();          // continues the latest save, tutorials off
```

`loadSave` also clears the list of mods recorded in the browser copy (the harness injects mods itself), so the game
doesn't stop on its "mods mismatch" warning. Everything you then do in the browser only changes the browser's copy; reload the snapshot to start over. To restore a
backup into the real game, close the game and copy `file__0.localstorage` (and `-journal`) back yourself; Steam
Cloud may then offer its newer copy.

`newCompany` turns tutorials off through the game's own setting (Settings, Tutorial: Never; `GDTDev.disableTutorials()`)
and postpones random events, which would otherwise all fire at once after the clock jump (`randomEvents: true` keeps
them). Saves go to the browser's localStorage, never to the real save files. Steam features, sounds and staff
animations don't work there, and the game's development progress does not advance; that is why `openStage` exists.
Modern Chrome is far faster than Chromium 30, so keep an eye on loops that run on every click.
