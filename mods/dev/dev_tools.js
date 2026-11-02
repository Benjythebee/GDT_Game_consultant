// Dev-only helpers loaded by serve_game.py. Run from the browser console, e.g.
//   await GDTDev.newCompany({ year: 11 }); await GDTDev.openConcept();
var GDTDev = {};
(function () {
  var wait = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  var clearPopups = async function () {
    var c = GameManager.company;
    for (var i = 0; i < 15 && UI.isModalContentOpen(); i++) {
      c.activeNotifications = [];
      c.notifications = [];
      var $ok = $('.simplemodal-data .okButton:visible, .simplemodal-data .notificationButton:visible').first();
      if ($ok.length) $ok.click();
      else UI.closeModal();
      await wait(700);
    }
  };

  // The same as Settings > Tutorial: "Never" in the game's menu.
  GDTDev.disableTutorials = function () {
    DataStore.settings.tutorialMode = 'never';
    SettingsGameplay.tutorialMode = 'never';
    DataStore.saveSettings();
  };

  // Replace this browser's game storage with a snapshot made by mods/dev/export_save.py, then reload the page.
  // Only the harness's localStorage changes; the real saves are untouched. Afterwards: await GDTDev.continueGame().
  GDTDev.loadSave = async function (name) {
    var res = await fetch('/__mods/dev/saves/' + encodeURIComponent(name) + '/snapshot.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('No snapshot for ' + name + ' (run mods/dev/export_save.py)');
    var items = await res.json();
    var settings = JSON.parse(items.settings || '{}');
    settings.tutorialMode = 'never';
    items.settings = JSON.stringify(settings);
    // The harness injects mods itself (the game's loader can't read the disk here), so clear both the enabled list
    // and the mods recorded in the saves; otherwise loading shows the "mods mismatch" dialog. Browser copy only.
    items.enabledMods = '[]';
    Object.keys(items).forEach(function (k) {
      if (!/^slot_/.test(k) && !/^(\d+|auto)(L\d+)?$/.test(k)) return;
      try {
        var o = JSON.parse(items[k]);
        var holder = o && o.company ? o.company : o;
        if (holder && holder.mods) {
          holder.mods = [];
          items[k] = JSON.stringify(o);
        }
      } catch (e) {}
    });
    localStorage.clear();
    Object.keys(items).forEach(function (k) { localStorage.setItem(k, items[k]); });
    location.reload();
    return 'Loaded ' + name + ', reloading';
  };

  // Continue the most recent save from the title screen and wait until the studio is ready.
  GDTDev.continueGame = async function () {
    GDTDev.disableTutorials();
    // the title screen only accepts the click once it shows "Click to continue ..."
    for (var j = 0; j < 40 && !/continue/i.test($('#gameReadyLabel').text()) && !(GameManager.company && GameManager.company.name); j++) await wait(500);
    if (!GameManager.company) $('#splashScreen').click();
    for (var i = 0; i < 40 && !(GameManager.company && GameManager.company.name); i++) await wait(500);
    await wait(1500);
    await clearPopups();
    var c = GameManager.company;
    return { name: c.name, week: Math.floor(c.currentWeek), cash: c.cash, staff: c.staff.length, games: c.gameLog.length, state: GameManager.state };
  };

  // Start a company (if needed) with every topic, the main research and the platforms of the given year.
  GDTDev.newCompany = async function (opts) {
    opts = opts || {};
    GDTDev.disableTutorials();
    if (SplashScreen.isVisible()) {
      $('#splashScreen').click();
      await wait(2500);
    }
    await clearPopups();
    var c = GameManager.company;
    c.name = c.name || 'Dev Studio';
    c.cash = opts.cash || 5e6;
    c.topics = (opts.topics || Topics.topics).slice();
    [Research.MultiGenre, Research.TargetAudience, Research.MultiPlatform, Research.MediumSizeGames, Research.LargeSizeGames, Research.AAA, Research.CasualGames, Research.Sequels].forEach(function (r) {
      if (r && c.researchCompleted.indexOf(r) == -1) c.researchCompleted.push(r);
    });
    var week = General.getWeekFromDateString((opts.year || 11) + '/1/1');
    GameManager.gameTime = week * GameManager.SECONDS_PER_WEEK * 1000;
    c.currentWeek = week;
    // jumping the clock would fire every overdue random event at once (some assume a game in development)
    if (!opts.randomEvents) c.flags.nextRandomEvent = GameManager.gameTime + 1e12;
    c.availablePlatforms = Platforms.allPlatforms.filter(function (p) {
      return !p.isCustom && Platforms.getPublishDate(p) <= week && c.licencedPlatforms.indexOf(p) == -1;
    });
    (opts.licence || []).forEach(function (name) {
      var p = c.availablePlatforms.first(function (x) { return x.name === name; });
      if (p) {
        c.licencedPlatforms.push(p);
        c.availablePlatforms.remove(p);
      }
    });
    // wait for the intro popups to finish so the studio is idle
    for (var i = 0; i < 10 && UI.isModalContentOpen(); i++) {
      await clearPopups();
      await wait(500);
    }
    return {
      state: GameManager.state,
      date: c.getCurrentDate(),
      market: Platforms.getPlatformsOnMarket(c).map(function (p) { return p.name + (c.licencedPlatforms.indexOf(p) != -1 ? ' (licensed)' : ''); })
    };
  };

  // Add employees for testing staff responsibilities (medium games and up). Skills are on the game's internal scale
  // (the UI shows 500 x factor). The office graphics don't get a desk for them; the dialogs only need the data.
  //   GDTDev.hireStaff([{ name: 'Ada', d: 0.6, t: 1.2, expert: 'Engine' }, { name: 'Bo', d: 1.1, t: 0.5 }])
  GDTDev.hireStaff = function (list) {
    var c = GameManager.company;
    list.forEach(function (s, i) {
      var ch = new Character({
        id: 'dev-staff-' + c.staff.length, name: s.name, slot: c.staff.length, dF: s.d, tF: s.t,
        speedF: 1, qualityF: 1, researchF: 1, salary: 5000, experience: LevelCalculator.getXpForLevel(5)
      });
      ch.flags = ch.flags || {};
      if (s.expert) ch.flags.expert = s.expert;
      c.staff.push(ch);
    });
    return c.staff.map(function (s) {
      return s.name + ' D' + Math.round(500 * s.designFactor) + ' T' + Math.round(500 * s.technologyFactor) + (s.flags.expert ? ' (' + s.flags.expert + ')' : '');
    });
  };

  // Skip straight to the slider dialog of a stage (1-3) for the game currently in development.
  // Earlier stages are logged with equal thirds; staff animation does not advance the game in a plain browser.
  GDTDev.openStage = async function (stage, points) {
    var game = GameManager.company.currentGame;
    if (!game) throw new Error('No game in development');
    var scale = General.getGameSizeDurationFactor(game.gameSize) * General.getMultiPlatformDurationFactor(game) * 3 * Missions.BASE_DURATION;
    game.featureLog = [{ type: 'focus', id: 'preparation', missionType: 'preparation', duration: Missions.PREP_DURATION, progress: 1 }];
    [Missions.Stage1Missions, Missions.Stage2Missions].slice(0, (stage || 1) - 1).forEach(function (list) {
      list.forEach(function (m) {
        game.featureLog.push({ type: 'focus', id: m.id, missionType: 'mission', duration: scale / 3, progress: 1 });
      });
    });
    game.designPoints = (points && points.d) || 10 * stage;
    game.technologyPoints = (points && points.t) || 10 * stage;
    GameManager.currentFeature = null;
    GameManager.plannedFeatures = [];
    GameManager.transitionToState(State.PickWorkItems);
    for (var i = 0; i < 10 && !$('.simplemodal-data .focusSliderWrapper').length; i++) await wait(400);
    await wait(300);
    return $('.simplemodal-data .focusSliderWrapper').length > 0;
  };

  // Open the "Select Game" dialog the way "Develop Sequel..." (or, with pack = true, "Develop Expansion Pack...") does.
  GDTDev.openSequel = async function (pack) {
    await clearPopups();
    GameManager.flags.selectGameActive = true;
    GameManager.flags.createPack = !!pack;
    GameManager.transitionToState(State.CreateGame);
    for (var i = 0; i < 20 && !$('#gameHistoryDialog').is(':visible'); i++) await wait(400);
    await wait(400);
    return $('#gameHistoryDialog').is(':visible');
  };

  // Open the offers the way "Find Publishing Deal..." does (needs company.flags.publishersEnabled in the real menu).
  GDTDev.openPublishingDeals = async function () {
    await clearPopups();
    GameManager.uiSettings.selectedContractType = 'gameContract';
    GameManager.company.notifications.push(new Notification('{FindContractWork}'));
    GameManager.showPendingNotifications();
    for (var i = 0; i < 20 && !$('#findContractWorkWindow').is(':visible'); i++) await wait(400);
    await wait(400);
    return $('#findContractWorkWindow').is(':visible');
  };

  // Open the Game Concept dialog the way "Develop New Game..." does. Call it once, while the studio is idle.
  GDTDev.openConcept = async function () {
    var open = function () {
      return $('.simplemodal-data .gameDefinitionContent').length > 0 && !!GameManager.company.currentGame;
    };
    if (open()) return true;
    if (!GameManager.company.currentGame) {
      await clearPopups();
      GameManager.flags.selectGameActive = false;
      GameManager.flags.createPack = false;
      GameManager.transitionToState(State.CreateGame);
    }
    // the dialog queues behind any pending popups; click through them
    for (var i = 0; i < 40 && !open(); i++) {
      await wait(500);
      var $ok = $('.simplemodal-data .okButton:visible, .simplemodal-data .notificationButton:visible').first();
      if ($ok.length && !$('.simplemodal-data .gameDefinitionContent').length) $ok.click();
    }
    return open();
  };
})();
