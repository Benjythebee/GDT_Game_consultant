// Game Consultant: a mod for Game Dev Tycoon 1.7.x.
// 1. Rates every topic / genre / audience / platform while a game is being defined (badges, dimming or filtering).
// 2. Recommends slider values for each development stage.
// 3. Adds "Create perfect combo automatically" to the game concept dialog.
// The game runs on node-webkit with Chromium 30, so this file is ES5 only.
var GameConsultant = GameConsultant || {};
(function () {
  var GC = GameConsultant;
  if (GC.VERSION) return; // already loaded; wrapping the UI twice would run every hook twice
  GC.VERSION = '1.3.0';

  var POOR = 0.8; // options below 80% of the best one are "poor"
  var SALES_WEIGHT = 0.1; // half the market costs ~7% of score: reviews first, sales as a tie-breaker
  var AUDIENCES = ['young', 'everyone', 'mature'];
  var AUDIENCE_LABEL = { young: 'Young', everyone: 'Everyone', mature: 'Mature' };
  var AUDIENCE_CLASS = { young: 'ratingY', everyone: 'ratingE', mature: 'ratingM' };
  var DOT = ' \u00b7 ';

  // ---------------------------------------------------------------- settings

  var settings = {};
  try {
    settings = GDT.getDataStore('game-consultant').settings;
  } catch (e) {}
  var getSetting = function (key, def) {
    return settings.hasOwnProperty(key) ? settings[key] : def;
  };
  var setSetting = function (key, value) {
    settings[key] = value;
    try {
      DataStore.saveSettings();
    } catch (e) {}
  };

  // ---------------------------------------------------------------- helpers

  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var byName = function (list, name) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return list[i];
    return null;
  };
  var byId = function (list, id) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  };
  var sameGenre = function (a, b) {
    return (a ? a.id : null) === (b ? b.id : null);
  };
  var ids = function (list) {
    return list.map(function (x) { return x.id; }).join('|');
  };
  var comboKey = function (t, g, g2) {
    return t.id + '|' + g.id + '|' + (g2 ? g2.id : '');
  };
  var tierOf = function (w) {
    return Knowledge.getFactorAdj(w);
  };
  var tierClass = function (w) {
    w = Math.round(10 * w) / 10;
    return w >= 1 ? 'gc-great' : w >= 0.9 ? 'gc-good' : w >= 0.8 ? 'gc-okay' : 'gc-bad';
  };
  var gradeClass = function (ratio) {
    return ratio >= 0.98 ? 'gc-great' : ratio >= 0.9 ? 'gc-good' : ratio >= POOR ? 'gc-okay' : 'gc-bad';
  };
  var pct = function (ratio) {
    return Math.round(100 * ratio) + '%';
  };
  var chip = function (label, w) {
    return '<span class="gc-chip ' + tierClass(w) + '">' + esc(label) + ' ' + esc(tierOf(w)) + '</span>';
  };
  var dialog = function () {
    return $('.simplemodal-data');
  };
  var buttonText = function ($el) {
    var t = $el.text();
    return t ? $.trim(t) : '';
  };
  var wrap = function (name, after) {
    var orig = UI[name];
    if (typeof orig !== 'function') return;
    UI[name] = function () {
      var result = orig.apply(this, arguments);
      try {
        after.apply(this, arguments);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('Game Consultant: ' + name, e);
      }
      return result;
    };
  };

  // ---------------------------------------------------------------- scoring model
  // Mirrors Reviews.rateGame and Sales.calculateSales (compressed/codeNw.js, game 1.7.9):
  //   score ~ (D+T) * topicGenre * platformGenre * topicAudience * platformAudiencePenalty * techSpread * trend
  // Topic/genre multiplies every design/tech point; a <=0.7 topic/genre or topic/audience match squeezes any
  // score above 6/10; repeating the last game's topic+genre costs 0.4 of the review bonus.

  // Your own console (Sales.sellConsole / getConsoleIncome / getSalesAnomalyForConsole): each week it sells a share of
  // the units it has left (20%, 13% then 10% x 0.15-0.3 as it ages), and while one of your games on it is in the
  // top-100 chart that week's console sales grow by (101 - chart rank) / 100, up to +100%.
  var CHART_WEEKS = 12; // roughly how long a hit stays in the charts
  var CHART_BOOST = 0.8; // average (101 - rank) / 100 over that time for a game near the top
  var ownConsoleBoost = function (p, size) {
    var company = GameManager.company;
    if (p.saleCancelled || p.soldOut) return 0;
    var remaining = 1e6 * p.unitsSold * Sales.consoleUnitPrice - (p.currentSalesCash || 0);
    var published = General.getWeekFromDateString(p.published);
    var release = Math.ceil(company.currentWeek + devWeeks(size));
    var extra = 0;
    for (var week = Math.ceil(company.currentWeek); week < release + CHART_WEEKS && remaining > 0; week++) {
      var age = week - published;
      var income = remaining * (age < 10 ? 0.2 : age < 20 ? 0.13 : 0.1) * 0.225;
      if (week >= release) extra += income * CHART_BOOST; // the boost adds units on top, it doesn't use up the rest
      remaining -= income;
    }
    return Math.max(0, extra);
  };

  // What one unit of platform market earned your recent finished games (median), to compare console money with sales.
  var marketRevenue = function () {
    var company = GameManager.company;
    var ratios = company.gameLog.filter(function (g) {
      return !g.flags.isExtensionPack && g.revenue > 0 && g.platforms && g.platforms.length &&
        (g.soldOut || company.currentWeek - g.releaseWeek > 30);
    }).slice(-6).map(function (g) {
      var n = g.platforms.length;
      var reach = g.platforms.reduce(function (s, p, i) {
        var share = n == 1 ? 1 : i == 0 ? 0.7 : i == 1 ? (n == 2 ? 0.55 : 0.4) : 0.3;
        return s + (p ? Platforms.getMarketSizeForWeek(p, g.releaseWeek, company) * share : 0);
      }, 0);
      return reach ? g.revenue / reach : 0;
    }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;
  };

  var buildModel = function (opts) {
    opts = opts || {};
    var company = GameManager.company;
    var game = company.currentGame;
    var size = opts.size || 'small';
    var allGenres = GameGenre.getAll();
    var onMarket = Platforms.getPlatformsOnMarket(company);
    var pool = onMarket.filter(function (p) {
      if (!Platforms.doesPlatformSupportGameSize(p, size)) return false;
      if (company.licencedPlatforms.indexOf(p) != -1) return true;
      return !opts.licensedOnly && p.licencePrize <= company.cash;
    });
    var info = {};
    var addInfo = function (p) {
      if (!p || info[p.id]) return;
      var genre = {};
      allGenres.forEach(function (g) {
        genre[g.id] = Platforms.getNormGenreWeighting(p.genreWeightings, g);
      });
      var audNorm = {};
      var audRaw = {};
      AUDIENCES.forEach(function (a) {
        audNorm[a] = Platforms.getPlatformsAudienceWeighting(p.audienceWeightings, a);
        audRaw[a] = Platforms.getPlatformsAudienceWeighting(p.audienceWeightings, a, true);
      });
      var boost = p.isCustom ? ownConsoleBoost(p, size) : null;
      info[p.id] = {
        genre: genre,
        audNorm: audNorm,
        audRaw: audRaw,
        market: Platforms.getMarketSize(p, company),
        tech: p.techLevel,
        isPC: p.id === 'PC',
        licensed: company.licencedPlatforms.indexOf(p) != -1,
        // extra console revenue from a charting game, in the same market units as `market`
        boost: boost && revenuePerMarket ? boost / revenuePerMarket : 0,
        boostCash: boost || 0
      };
    };
    var revenuePerMarket = onMarket.some(function (p) { return p.isCustom; }) ? marketRevenue() : 0;
    onMarket.forEach(addInfo);
    (game && game.platforms || []).forEach(addInfo);

    var comboSeen = {};
    company.gameLog.concat(company.trashedGames || []).forEach(function (h) {
      if (h.topic && h.genre) comboSeen[comboKey(h.topic, h.genre, h.secondGenre)] = true;
    });
    var experts = {};
    company.staff.forEach(function (s) {
      if (s.flags.expert) (experts[s.flags.expert] = experts[s.flags.expert] || []).push(s.name);
    });
    var topicLast = {};
    company.gameLog.forEach(function (g, i) {
      if (g.topic) topicLast[g.topic.id] = i;
    });
    return {
      company: company,
      game: game,
      size: size,
      mmo: !!opts.mmo,
      isPack: GameManager.flags.createPack === true,
      topics: company.topics.slice(),
      genres: General.getAvailableGenres(company),
      multiGenre: company.canUseMultiGenre(),
      audiences: company.canSetTargetAudience() ? AUDIENCES : ['everyone'],
      pool: pool,
      info: info,
      last: company.gameLog.length ? company.gameLog[company.gameLog.length - 1] : null,
      comboSeen: comboSeen,
      experts: experts,
      keyCache: {},
      topicLast: topicLast,
      trends: !!(company.flags && company.flags.trends && company.flags.trends.currentTrend),
      platformCache: {}
    };
  };

  var topicPart = function (m, t, g, g2, a) {
    var tg = GameGenre.getGenreWeighting(t.genreWeightings, g, g2);
    var ta = General.getAudienceWeighting(t.audienceWeightings, a);
    var f = tg * ta;
    var notes = [];
    if (tg <= 0.7 || ta <= 0.7) f *= 0.8;
    if (m.last && !m.isPack && m.last.topic && m.last.topic.id === t.id && sameGenre(m.last.genre, g) && sameGenre(m.last.secondGenre, g2)) {
      f *= 0.6;
      notes.push('Same topic and genre as your last game');
    }
    if (m.mmo && tg < 1) {
      f *= 0.85;
      notes.push('MMOs need a great topic/genre match');
    }
    if (m.size === 'aaa') {
      // AAA reviews are capped at 10 - 0.6 per missing expert (of 3) on the game's key areas
      var withExperts = keyAreas(m, t, g, g2).filter(function (k) { return k.experts.length; }).length;
      f *= 1 - 0.06 * (3 - Math.min(withExperts, 3));
      if (withExperts < 3) notes.push('AAA: experts for ' + withExperts + ' of 3 key areas');
    }
    var trend = 1;
    if (m.trends) {
      try {
        trend = GameTrends.getCurrentTrendFactor({ topic: t, genre: g, secondGenre: g2, targetAudience: a });
      } catch (e) {}
    }
    f *= trend;
    var newCombo = !m.comboSeen[comboKey(t, g, g2)];
    var since = m.topicLast.hasOwnProperty(t.id) ? m.company.gameLog.length - 1 - m.topicLast[t.id] : 999;
    return { f: f, tg: tg, ta: ta, trend: trend, notes: notes, tie: (newCombo ? 1000 : 0) + Math.min(since, 999), newCombo: newCombo };
  };

  // Development areas weighted >= 0.9 for this topic/genre (topic overrides included) and the experts the company has.
  var keyAreas = function (m, t, g, g2) {
    var key = comboKey(t, g, g2);
    if (!m.keyCache[key]) {
      var fake = { topic: t, genre: g, secondGenre: g2 };
      m.keyCache[key] = Missions.DevMissions.filter(function (mission) {
        return Missions.getGenreWeighting(mission, fake) >= 0.9;
      }).map(function (mission) {
        return { mission: mission, experts: m.experts[mission.id] || [] };
      });
    }
    return m.keyCache[key];
  };

  var platformPart = function (m, P, g, g2, a) {
    var n = P.length;
    var W = GameFlags.MULTIPLATFORM_WEIGHTING;
    var mix = 0, d = 1, k = 1, penalty = 1, i, inf, gw;
    for (i = 0; i < n; i++) {
      inf = m.info[P[i].id];
      gw = g2 ? (inf.genre[g2.id] + 2 * inf.genre[g.id]) / 3 : inf.genre[g.id];
      if (i < n - 1) {
        d *= W;
        mix += gw * d;
        k -= d;
      } else mix += gw * k;
      if (penalty === 1 && inf.audNorm[a] <= 0.8) penalty = inf.audRaw[a];
    }
    var spread = 1;
    if (n > 1) {
      var hi = m.info[P[0].id].isPC ? m.info[P[1].id].tech : m.info[P[0].id].tech;
      var lo = hi;
      for (i = 1; i < n; i++) {
        inf = m.info[P[i].id];
        if (!inf.isPC) {
          hi = Math.max(hi, inf.tech);
          lo = Math.min(lo, inf.tech);
        }
      }
      spread -= (hi - lo) / 20;
    }
    var minTech = 8;
    for (i = 0; i < n; i++) if (!m.info[P[i].id].isPC) minTech = Math.min(minTech, m.info[P[i].id].tech);
    var sales = 0, boostCash = 0;
    for (i = 0; i < n; i++) {
      inf = m.info[P[i].id];
      var share = n == 1 ? 1 : i == 0 ? 0.7 : i == 1 ? (n == 2 ? 0.55 : 0.4) : 0.3;
      sales += inf.market * share * (minTech / (inf.isPC ? minTech : inf.tech)) * inf.audNorm[a];
      sales += inf.boost; // a charting game on your own console also sells consoles
      boostCash += inf.boostCash;
    }
    var q = mix * penalty * spread;
    return { q: q, sales: sales, boostCash: boostCash, value: q * Math.pow(Math.max(sales, 1), SALES_WEIGHT), mix: mix, penalty: penalty, spread: spread };
  };

  var bestPlatforms = function (m, g, g2, a, count) {
    var key = g.id + '|' + (g2 ? g2.id : '') + '|' + a + '|' + count;
    if (m.platformCache.hasOwnProperty(key)) return m.platformCache[key];
    var best = null;
    var pick = [];
    var used = {};
    var pool = m.pool;
    if (count > 1 && pool.length > 7) {
      // ordered triples grow with n^3; the best multi-platform sets come from the strongest single platforms
      pool = pool.map(function (p) {
        return { p: p, v: platformPart(m, [p], g, g2, a).value };
      }).sort(function (x, y) { return y.v - x.v; }).slice(0, 7).map(function (x) { return x.p; });
    }
    var visit = function () {
      if (pick.length === count) {
        var r = platformPart(m, pick, g, g2, a);
        if (!best || r.value > best.value) {
          r.platforms = pick.slice();
          best = r;
        }
        return;
      }
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (used[p.id]) continue;
        used[p.id] = true;
        pick.push(p);
        visit();
        pick.pop();
        used[p.id] = false;
      }
    };
    if (pool.length) visit();
    m.platformCache[key] = best;
    return best;
  };

  // fixed: { topic, genre, genre2 (undefined = free, null = none), audience, platforms (array) or platformCount }
  var solve = function (m, fixed) {
    var topics = fixed.topic ? [fixed.topic] : m.topics;
    var genres = fixed.genre ? [fixed.genre] : m.genres;
    var auds = fixed.audience ? [fixed.audience] : m.audiences;
    var count = Math.min(Math.max(fixed.platformCount || 1, 1), Math.max(m.pool.length, 1));
    var best = null;
    genres.forEach(function (g) {
      var seconds = fixed.genre2 !== undefined ? [fixed.genre2] : [null].concat(m.multiGenre ? m.genres : []);
      seconds.forEach(function (g2) {
        if (g2 && g2.id === g.id) return;
        auds.forEach(function (a) {
          var tBest = null;
          topics.forEach(function (t) {
            var tp = topicPart(m, t, g, g2, a);
            if (!tBest || tp.f > tBest.f + 1e-9 || (Math.abs(tp.f - tBest.f) <= 1e-9 && tp.tie > tBest.tie)) {
              tp.topic = t;
              tBest = tp;
            }
          });
          if (!tBest) return;
          var pBest = fixed.platforms ? platformPart(m, fixed.platforms, g, g2, a) : bestPlatforms(m, g, g2, a, count);
          if (!pBest) return;
          var value = tBest.f * pBest.value;
          var better = !best || value > best.value * (1 + 1e-9) ||
            (value >= best.value * (1 - 1e-9) && ((!g2 && best.genre2) || (!g2 === !best.genre2 && tBest.tie > best.t.tie)));
          if (better) {
            best = {
              topic: tBest.topic,
              genre: g,
              genre2: g2,
              audience: a,
              platforms: fixed.platforms ? fixed.platforms.slice() : pBest.platforms,
              value: value,
              quality: tBest.f * pBest.q,
              sales: pBest.sales,
              t: tBest,
              p: pBest
            };
          }
        });
      });
    });
    return best;
  };

  GC.buildModel = buildModel;
  GC.solve = solve;
  GC.platformPart = platformPart;

  // ---------------------------------------------------------------- game concept dialog

  var audienceTouched = false;

  var inDefinition = function () {
    var company = GameManager.company;
    return !!(company && company.currentGame && dialog().find('.gameDefinitionContent #targetRating').length);
  };

  var readSelection = function () {
    var company = GameManager.company;
    var game = company.currentGame;
    var $d = dialog();
    var locked = game.flags.lockedSettings || {};
    var $size = $d.find('.gameSizeButton.selected:not(.gameGenreMMO)');
    var size = $size.hasClass('gameSizeMedium') ? 'medium' : $size.hasClass('gameSizeLarge') ? 'large' : $size.hasClass('gameSizeAAA') ? 'aaa' : 'small';
    var $r = $d.find('.rating.selected');
    var audience = $r.hasClass('ratingY') ? 'young' : $r.hasClass('ratingM') ? 'mature' : 'everyone';
    var genre2 = company.canUseMultiGenre() ? byName(GameGenre.getAll(), buttonText($d.find('#pickSecondGenreButton'))) : null;
    return {
      topic: byName(company.topics, buttonText($d.find('.pickTopicButton'))),
      genre: byName(GameGenre.getAll(), buttonText($d.find('#pickGenreButton'))),
      genre2: genre2,
      audience: company.canSetTargetAudience() ? audience : 'everyone',
      audiencePicked: !company.canSetTargetAudience() || audienceTouched || !!locked.targetAudience,
      platforms: game.platforms.filter(function (p) { return !!p; }),
      size: size,
      mmo: $d.find('.gameGenreMMO').hasClass('selected'),
      locked: locked
    };
  };

  var modelFor = function (sel, licensedOnly) {
    return buildModel({ size: sel.size, mmo: sel.mmo, licensedOnly: licensedOnly });
  };

  // Everything the player has picked stays fixed; the rest is completed as well as possible.
  var fixedFromSelection = function (sel, without) {
    var f = { platformCount: Math.max(1, sel.platforms.length) };
    if (without !== 'topic' && sel.topic) f.topic = sel.topic;
    if (without !== 'genre' && sel.genre) f.genre = sel.genre;
    if (without !== 'genre2' && sel.genre2) f.genre2 = sel.genre2;
    if (without === 'genre' && sel.genre2) f.genre2 = sel.genre2;
    if (without !== 'audience' && sel.audiencePicked) f.audience = sel.audience;
    if (without !== 'platform' && sel.platforms.length) f.platforms = sel.platforms;
    return f;
  };

  var fixedFromLocks = function (sel) {
    var game = GameManager.company.currentGame;
    var f = { platformCount: Math.max(1, sel.platforms.length) };
    if (sel.locked.topic && game.topic) f.topic = game.topic;
    if (sel.locked.genre && game.genre) f.genre = game.genre;
    if (sel.locked.secondGenre) f.genre2 = game.secondGenre || null;
    if (sel.locked.targetAudience) f.audience = sel.audience;
    if (sel.locked.platform && sel.platforms.length) f.platforms = sel.platforms;
    var original = game.sequelTo ? GameManager.company.getGameById(game.sequelTo) : null;
    if (original) {
      // a sequel keeps the original's topic and genres; only audience, platforms and engine are open
      f.topic = original.topic;
      f.genre = original.genre;
      f.genre2 = original.secondGenre || null;
    }
    return f;
  };

  var describe = function (r) {
    if (!r) return '';
    var parts = [r.topic.name, r.genre.name + (r.genre2 ? '-' + r.genre2.name : '')];
    if (GameManager.company.canSetTargetAudience()) parts.push(AUDIENCE_LABEL[r.audience]);
    parts.push(r.platforms.map(function (p) { return p.name; }).join(' + '));
    return parts.join(DOT);
  };

  var breakdown = function (r) {
    if (!r) return '';
    var html = chip('Topic/Genre', r.t.tg);
    if (GameManager.company.canSetTargetAudience()) html += chip('Topic/Audience', r.t.ta);
    var p0 = r.platforms[0];
    if (p0) {
      html += chip('Platform/Genre', GameGenre.getGenreWeighting(p0.genreWeightings, r.genre, r.genre2));
      var aud = 1;
      r.platforms.forEach(function (p) {
        aud = Math.min(aud, Platforms.getPlatformsAudienceWeighting(p.audienceWeightings, r.audience, true));
      });
      if (GameManager.company.canSetTargetAudience()) html += chip('Platform/Audience', aud);
    }
    if (r.t.trend > 1) html += '<span class="gc-chip gc-great">Trend +' + Math.round(100 * (r.t.trend - 1)) + '%</span>';
    if (r.t.trend < 1) html += '<span class="gc-chip gc-bad">Trend ' + Math.round(100 * (r.t.trend - 1)) + '%</span>';
    if (r.p.spread < 1) html += '<span class="gc-chip gc-okay">Tech gap -' + Math.round(100 * (1 - r.p.spread)) + '%</span>';
    if (r.p.boostCash > 0) html += '<span class="gc-chip gc-great" title="While the game is in the top-100 chart your console sells up to twice as many units">' +
      'Own console: ~' + esc(UI.getShortNumberString(r.p.boostCash)) + ' extra console sales</span>';
    r.t.notes.forEach(function (n) {
      html += '<span class="gc-chip gc-bad">' + esc(n) + '</span>';
    });
    return html;
  };

  // The concept dialog has a fixed height with no room to spare, so the consultant is a card beside it.
  var placeCard = function ($card) {
    var host = $('#simplemodal-container').get(0);
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var right = window.innerWidth - rect.right - 14;
    var left = rect.left - 14;
    var width = Math.min(280, Math.max(right, left));
    if (right >= 180 || right >= left) $card.css({ left: rect.width + 10, width: Math.max(width, 160) });
    else $card.css({ left: -Math.max(width, 160) - 10, width: Math.max(width, 160) });
  };

  var ensurePanel = function () {
    var $host = $('#simplemodal-container');
    var $panel = $host.find('.gc-card');
    if (!$panel.length) {
      $panel = $('<div class="gc-panel gc-card">' +
        '<div class="gc-title">Game Consultant</div>' +
        '<div class="gc-current"><span class="gc-score"></span><div class="gc-what"></div><div class="gc-chips"></div></div>' +
        '<div class="gc-best-line"></div>' +
        '<div class="gc-auto">Create perfect combo automatically</div>' +
        '<div class="gc-note"></div>' +
        '<div class="gc-sequel"></div>' +
        '<div class="gc-team"></div>' +
        '<label class="gc-toggle"><input type="checkbox" class="gc-filter">Hide poor options in the lists</label>' +
        '</div>');
      $panel.find('.gc-filter').prop('checked', getSetting('filter', false)).on('change', function () {
        setSetting('filter', this.checked);
      });
      $panel.find('.gc-auto').on('click', function () {
        Sound.click();
        GC.createPerfectCombo();
      });
      $host.append($panel);
    }
    placeCard($panel);
    // mousedown runs before the game's own click handler re-renders everything
    dialog().find('.gameDefinitionContent').off('mousedown.gc touchstart.gc').on('mousedown.gc touchstart.gc', '.rating', function () {
      audienceTouched = true;
    });
    return $panel;
  };

  GC.refreshDefinition = function () {
    if (applying || !inDefinition()) return;
    var $panel = ensurePanel();
    var sel = readSelection();
    var mAll = modelFor(sel, false);
    var mOwned = modelFor(sel, true);
    var complete = sel.topic && sel.genre && sel.platforms.length;
    var fixed = fixedFromSelection(sel);
    if (complete) {
      // rate exactly what would be made: no suggested second genre, the audience button as selected
      fixed.genre2 = sel.genre2 || null;
      fixed.audience = sel.audience;
    }
    // until platforms are picked, complete the combo with platforms the company already owns
    var current = solve(sel.platforms.length ? mAll : mOwned, fixed);
    var best = solve(mAll, fixedFromLocks(sel));
    var auto = solve(mOwned, fixedFromLocks(sel));

    var $note = $panel.find('.gc-note').empty().hide();
    if (!best) {
      $panel.find('.gc-score').text('');
      $panel.find('.gc-what, .gc-chips').empty();
      $panel.find('.gc-best-line').text('No platform on the market supports this game size.');
      return;
    }
    var ratio = current ? current.value / best.value : 0;
    $panel.find('.gc-score').attr('class', 'gc-score ' + gradeClass(ratio)).text(current ? pct(ratio) + ' of the best combo' : '');
    $panel.find('.gc-current').attr('title', 'Compares the expected review score (and, a little, the market size) with the best combo you could make.');
    $panel.find('.gc-what').html(current ? '<span class="gc-label">' + (complete ? 'Your combo' : 'Best with your picks') + ':</span> ' + esc(describe(current)) : '');
    $panel.find('.gc-chips').html(breakdown(current));
    var target = auto || best;
    var same = complete && current && current.topic === target.topic && current.genre === target.genre && sameGenre(current.genre2, target.genre2) &&
      current.audience === target.audience && ids(current.platforms) === ids(target.platforms);
    $panel.find('.gc-best-line').html(same ? '<span class="gc-label gc-ok">\u2713 This is the best combo you can make.</span>' :
      '<span class="gc-label">Best you can make:</span> ' + esc(describe(target)));
    if (auto && best.value > auto.value * 1.02) {
      var extra = best.platforms.filter(function (p) { return !mAll.info[p.id].licensed; });
      $note.text('Licensing ' + extra.map(function (p) {
        return p.name + ' (' + UI.getShortNumberString(p.licencePrize) + ')';
      }).join(', ') + ' would make it ' + Math.round(100 * (best.value / auto.value - 1)) + '% better.').show();
    }
    $panel.find('.gc-auto').toggleClass('gc-disabled', !auto);
    $panel.find('.gc-sequel').html([sequelNotes(sel), contractNotes(current)].filter(function (s) { return s; }).join('<br>'));
    // medium games and up: staff take responsibility for areas, so team size and experts matter
    var $team = $panel.find('.gc-team').empty();
    if (sel.size !== 'small') {
      var shown = complete && current ? current : target;
      var team = GameManager.company.staff.length;
      var ideal = General.getOptimalTeamSize({ gameSize: sel.size });
      var areas = keyAreas(mAll, shown.topic, shown.genre, shown.genre2);
      $team.html('<span class="gc-label">Team:</span> ' + team + ' (ideal for ' + esc(General.getGameSizeLabel(sel.size)) + ': ' + ideal + ')' +
        (team < ideal ? ' <span class="gc-warn">expect overloaded staff</span>' : '') +
        '<br><span class="gc-label">Key areas:</span> ' + areas.map(function (k) {
          return esc(k.mission.name) + (k.experts.length ? ' <span class="gc-ok">\u2713 ' + esc(k.experts.join(', ')) + '</span>' : '');
        }).join(', '));
    }
    rateAudienceButtons(sel);
  };

  var rateAudienceButtons = function (sel) {
    var $d = dialog();
    $d.find('.rating .gc-badge').remove();
    if (!GameManager.company.canSetTargetAudience()) return;
    var m = modelFor(sel, false);
    var results = {};
    var top = 0;
    AUDIENCES.forEach(function (a) {
      var f = fixedFromSelection(sel, 'audience');
      f.audience = a;
      results[a] = solve(m, f);
      if (results[a]) top = Math.max(top, results[a].value);
    });
    if (!top) return;
    AUDIENCES.forEach(function (a) {
      var r = results[a];
      if (!r) return;
      var ratio = r.value / top;
      var $btn = $d.find('.rating.' + AUDIENCE_CLASS[a]);
      $btn.addClass('gc-rated').append('<div class="gc-badge ' + gradeClass(ratio) + '">' + (ratio >= 0.995 ? '&#9733;' : pct(ratio)) + '</div>');
      $btn.attr('title', 'Topic/Audience ' + tierOf(r.t.ta) + ' with ' + describe(r));
    });
  };

  // Badge, dim or filter the buttons of an open picker. field: topic | genre | genre2 | platform
  var ratePicker = function (field, slot) {
    if (!inDefinition()) return;
    var $d = dialog();
    var $list = $d.find('.selectionOverlayContainer .listContainer');
    var sel = readSelection();
    var m = modelFor(sel, false);
    var company = GameManager.company;
    var buttons = [];
    if (field === 'platform') {
      $list.find('.platformButton').each(function () {
        var p = byName(Platforms.getPlatformsOnMarket(company), buttonText($(this).find('.platformTitle')));
        if (p && m.info[p.id]) buttons.push({ $el: $(this), option: p });
      });
    } else {
      $list.find('.pickTopicListButton').each(function () {
        var name = buttonText($(this).find('.topicButtonText'));
        var option = field === 'topic' ? byName(company.topics, name) : byName(GameGenre.getAll(), name);
        if (option && !$(this).hasClass('disabledButton')) buttons.push({ $el: $(this), option: option });
      });
    }
    var top = 0;
    buttons.forEach(function (b) {
      var f = fixedFromSelection(sel, field);
      if (field === 'platform') {
        if (!Platforms.doesPlatformSupportGameSize(b.option, sel.size)) return;
        var P = sel.platforms.slice();
        P[slot] = b.option;
        f.platforms = P.filter(function (p, i) { return p && (i === slot || p !== b.option); });
      } else if (field === 'genre2') {
        f.genre2 = b.option;
        if (sel.genre && sel.genre.id === b.option.id) return;
      } else f[field] = b.option;
      if (field === 'genre' && sel.genre2 && sel.genre2.id === b.option.id) f.genre2 = null;
      b.result = solve(m, f);
      if (b.result) top = Math.max(top, b.result.value);
    });
    if (!top) return;
    var current = field === 'platform' ? sel.platforms[slot] : field === 'genre2' ? sel.genre2 : sel[field];
    var filter = getSetting('filter', false);
    buttons.forEach(function (b) {
      b.$el.find('.gc-badge').remove();
      b.$el.removeClass('gc-poor gc-hidden gc-best');
      if (!b.result) {
        b.ratio = 0;
        b.$el.append('<div class="gc-badge gc-bad">size</div>').attr('title', 'Does not support this game size').addClass(filter ? 'gc-hidden' : 'gc-poor');
        return;
      }
      b.ratio = b.result.value / top;
      var label = b.ratio >= 0.995 ? '&#9733; Best' : pct(b.ratio);
      var detail = '';
      if (field === 'topic') detail = tierOf(b.result.t.tg) + ' ' + b.result.genre.name + (b.result.genre2 ? '-' + b.result.genre2.name : '');
      else if (field === 'genre' || field === 'genre2') {
        detail = tierOf(b.result.t.tg) + (sel.topic ? '' : ' ' + b.result.topic.name);
        if (field === 'genre' && b.result.genre2 && !sel.genre2) detail += ' +' + b.result.genre2.name;
      }
      else detail = 'Genre ' + tierOf(GameGenre.getGenreWeighting(b.option.genreWeightings, b.result.genre, b.result.genre2)) +
        (company.canSetTargetAudience() ? DOT + 'Audience ' + tierOf(Platforms.getPlatformsAudienceWeighting(b.option.audienceWeightings, b.result.audience, true)) : '') +
        (m.info[b.option.id] && m.info[b.option.id].boostCash > 0 ? DOT + '+' + UI.getShortNumberString(m.info[b.option.id].boostCash) + ' consoles' : '');
      b.$el.append('<div class="gc-badge ' + gradeClass(b.ratio) + '">' + label + '<span class="gc-detail">' + esc(detail) + '</span></div>');
      b.$el.attr('title', 'Best with this: ' + describe(b.result));
      if (b.ratio >= 0.995) b.$el.addClass('gc-best');
      var keep = current && current.id === b.option.id;
      if (b.ratio < POOR && !keep) b.$el.addClass(filter ? 'gc-hidden' : 'gc-poor');
    });
    if (filter) {
      var ordered = buttons.slice().sort(function (x, y) { return y.ratio - x.ratio; });
      if (field === 'platform') {
        ordered.forEach(function (b) { $list.append(b.$el); });
      } else {
        var perRow = field === 'topic' ? 3 : 2;
        var left = field === 'topic' ? 10 : 110;
        var i = 0;
        ordered.forEach(function (b) {
          if (b.$el.hasClass('gc-hidden')) return;
          b.$el.css({ top: 150 * Math.floor(i / perRow), left: 190 * (i % perRow) + left });
          i++;
        });
        $list.find('.pickTopicListButton').not(ordered.map(function (b) { return b.$el.get(0); })).addClass('gc-hidden');
      }
      UI.createDraggable($list);
    }
  };

  GC.createPerfectCombo = function () {
    if (!inDefinition()) return;
    var sel = readSelection();
    var game = GameManager.company.currentGame;
    var best = solve(modelFor(sel, true), fixedFromLocks(sel));
    if (!best) return;
    var $d = dialog();
    var locked = sel.locked;
    applying = true; // every pick below triggers the game's update hook; refresh once at the end instead
    try {
      applyCombo(sel, best, game, $d, locked);
    } finally {
      applying = false;
    }
    UI._updateGameDefinitionCost();
    UI._updateGameDefinitionNextButtonEnabled();
  };

  var applying = false;
  var applyCombo = function (sel, best, game, $d, locked) {
    if (!locked.secondGenre && sel.genre2 && !sameGenre(sel.genre2, best.genre2)) {
      UI._selectGenre(sel.genre2.name, 2); // clicking the current second genre clears it
      game.secondGenre = undefined;
    }
    if (!locked.topic && !(sel.topic && sel.topic.id === best.topic.id)) UI._selectTopic(best.topic.name);
    if (!locked.genre && !sameGenre(sel.genre, best.genre)) UI._selectGenre(best.genre.name);
    if (!locked.secondGenre && best.genre2 && !sameGenre(readSelection().genre2, best.genre2)) UI._selectGenre(best.genre2.name, 2);
    if (!locked.targetAudience && GameManager.company.canSetTargetAudience() && sel.audience !== best.audience) {
      $d.find('.rating.' + AUDIENCE_CLASS[best.audience]).click();
    }
    audienceTouched = true;
    var original = game.sequelTo ? GameManager.company.getGameById(game.sequelTo) : null;
    var engine = original ? sequelEngine(original).better : null;
    if (engine && $d.find('.pickEngineButton:visible').length && game.engine !== engine) UI.pickEngineClick({ engineId: engine.id });
    if (!locked.platform) {
      game.platforms = best.platforms.slice();
      UI._updatePickPlatformButtonStates(game);
    }
  };

  var showGameDefinition = UI.showGameDefinition;
  UI.showGameDefinition = function (company) {
    // a sequel arrives with its audience already chosen; otherwise "E" is only the default
    audienceTouched = !!(company && company.currentGame && company.currentGame.sequelTo); // new games default to "everyone"
    var result = showGameDefinition.apply(this, arguments);
    // the dialog's onOpen normally refreshes us; this covers content re-rendered into an already open dialog
    setTimeout(GC.refreshDefinition, 0);
    return result;
  };
  wrap('_updateGameDefinitionNextButtonEnabled', function () {
    GC.refreshDefinition();
  });
  wrap('pickTopicClick', function (a) {
    if (a === undefined) ratePicker('topic');
  });
  wrap('pickGenreClick', function (a) {
    if (a === undefined) ratePicker('genre');
  });
  wrap('pickSecondGenreClick', function (a) {
    if (a === undefined) ratePicker('genre2');
  });
  wrap('pickPlatformClick', function (a) {
    if (!a || !a.hasClass) return;
    if (dialog().find('.selectionOverlayContainer .platformButton').length) {
      ratePicker('platform', a.hasClass('platform2') ? 1 : a.hasClass('platform3') ? 2 : 0);
    }
  });

  // ---------------------------------------------------------------- sequels and expansion packs
  // Reviews.rateGame / Missions.executePublishingMission / Sales.calculateSales:
  //   released less than 40 weeks after the original: -0.4 review bonus, marketing hype turns negative, fans leave
  //   engine with a higher tech level than the original's: +0.2 and 20% more hype; the same engine: -0.1, half the hype
  //   the sequel keeps the original's topic and genres, so a sequel of the last game also gets "Another X/Y game?" (-0.4)

  var WEEK_MS = function () {
    return 1000 * GameManager.SECONDS_PER_WEEK;
  };

  // Weeks from concept to release: the company's own recent games of that size, else the base duration with a margin.
  var devWeeks = function (size) {
    var past = GameManager.company.gameLog.filter(function (g) {
      return g.gameSize === size && g.flags && g.flags.devTime;
    }).slice(-5);
    if (past.length) return past.reduce(function (s, g) { return s + g.flags.devTime; }, 0) / past.length / WEEK_MS();
    return 1.5 * Missions.BASE_DURATION * GameFlags.MAIN_MISSIONS_PER_GAME * General.getGameSizeDurationFactor(size) / WEEK_MS();
  };

  var sequelEngine = function (original) {
    var all = GameManager.company.engines;
    // highest tech level first; among equals the most recently built (later in the list)
    var engines = all.slice().sort(function (a, b) { return b.techLevel - a.techLevel || all.indexOf(b) - all.indexOf(a); });
    var origTech = original.engine ? original.engine.techLevel : null;
    var better = engines.filter(function (e) { return origTech === null || e.techLevel > origTech; })[0] || null;
    var other = engines.filter(function (e) { return !original.engine || e.id !== original.engine.id; })[0] || null;
    return { better: better, onlySame: !better && !other && !!original.engine && engines.length > 0, none: !engines.length };
  };

  var sequelTiming = function (original, size) {
    var now = GameManager.company.currentWeek;
    var since = now - original.releaseWeek;
    var dev = devWeeks(size);
    var gap = since + dev;
    return { released: original.releaseWeek <= now, since: since, dev: dev, gap: gap, ok: gap >= 42, wait: Math.max(0, Math.ceil(42 - gap)) };
  };

  var newGameCache = {};
  var sequelAdvice = function (original, pack) {
    var company = GameManager.company;
    var size = original.gameSize || 'small';
    var count = company.canDevelopMultiPlatform() ? Math.min(Math.max(original.platforms.length, 1), 3) : 1;
    var m = buildModel({ size: size, mmo: !!original.flags.mmo, licensedOnly: true });
    var fixed = { topic: original.topic, genre: original.genre, genre2: original.secondGenre || null, platformCount: count };
    if (pack) {
      fixed.platforms = original.platforms;
      fixed.audience = original.targetAudience;
    }
    var r = solve(m, fixed);
    var key = size + count + (original.flags.mmo ? 'mmo' : '');
    var fresh = newGameCache[key] || (newGameCache[key] = solve(m, { platformCount: count }));
    var timing = sequelTiming(original, size);
    var engine = sequelEngine(original);
    var a = { original: original, r: r, timing: timing, engine: engine, pack: pack, lines: [] };
    var kind = pack ? 'expansion pack' : 'sequel';
    if (!r) {
      a.ratio = 0;
      a.cls = 'gc-bad';
      a.headline = 'No platform on the market can take a ' + General.getGameSizeLabel(size) + ' ' + kind + ' of this game.';
      return a;
    }
    // +0.2 or -0.1 on a review bonus of about +0.3 moves the score by roughly +15% / -8%; too soon costs about 30%
    var value = r.value * (engine.better ? 1.15 : engine.onlySame ? 0.92 : 1);
    a.ratio = value / fresh.value;
    var tooSoon = !timing.released || !timing.ok;
    if (tooSoon) value *= 0.7;
    var where = (pack ? '' : ' on ' + r.platforms.map(function (p) { return p.name; }).join(' + ')) +
      (company.canSetTargetAudience() && !pack ? ' for ' + AUDIENCE_LABEL[r.audience] + ' audiences' : '');
    if (!timing.released) {
      a.cls = 'gc-bad';
      a.headline = 'Not released yet: too soon for a ' + kind + '.';
    } else if (tooSoon) {
      a.cls = 'gc-okay';
      a.headline = 'Wait ' + timing.wait + ' more week' + (timing.wait === 1 ? '' : 's') + ', then it is a ' +
        (a.ratio >= 0.95 ? 'great' : a.ratio >= 0.85 ? 'good' : 'weak') + ' pick for a ' + kind + where + '.';
    } else {
      a.cls = a.ratio >= 0.95 ? 'gc-great' : a.ratio >= 0.85 ? 'gc-good' : a.ratio >= POOR ? 'gc-okay' : 'gc-bad';
      a.headline = (a.ratio >= 0.95 ? 'This game is currently a great pick for a ' : a.ratio >= 0.85 ? 'A good pick for a ' :
        a.ratio >= POOR ? 'An OK pick for a ' : 'A poor pick for a ') + kind + where + '.';
    }
    a.score = value;

    var ok = '<span class="gc-ok">\u2713</span> ', bad = '<span class="gc-warn">\u2717</span> ', meh = '<span class="gc-meh">!</span> ';
    var weeks = function (n) { return Math.round(n) + ' week' + (Math.round(n) === 1 ? '' : 's'); };
    if (!timing.released) a.lines.push(bad + 'The original has not been released yet.');
    else a.lines.push((timing.ok ? ok : bad) + 'Released ' + weeks(timing.since) + ' ago; with about ' + weeks(timing.dev) +
      ' of development the ' + kind + ' ships ' + weeks(timing.gap) + ' after it' +
      (timing.ok ? ' (40 needed).' : '. Under 40 weeks reviews lose 0.4, hype turns negative and fans leave.'));
    if (engine.better) {
      a.lines.push(ok + 'Use the ' + esc(engine.better.name) + ' engine (tech ' + engine.better.techLevel.toFixed(1) + ' vs ' +
        (original.engine ? original.engine.techLevel.toFixed(1) : 'none') + '): +0.2 review bonus and 20% more hype.');
    } else if (engine.none) {
      a.lines.push(meh + 'No custom engine yet: a ' + kind + ' on a new engine gets +0.2 and more hype.');
    } else {
      a.lines.push((engine.onlySame ? bad : meh) + 'None of your engines is newer than ' + esc(original.engine ? original.engine.name : 'the original\'s') +
        (engine.onlySame ? ': reusing it costs 0.1 and halves the hype bonus.' : '. Build a newer one for +0.2.'));
    }
    var retired = original.platforms.filter(function (p) { return Platforms.getPlatformsOnMarket(company).indexOf(p) === -1; });
    if (retired.length && !pack) a.lines.push(meh + 'The original\'s ' + esc(retired.map(function (p) { return p.name; }).join(', ')) + ' is off the market.');
    a.lines.push('<div class="gc-chips">' + breakdown(r) + '</div>');
    var avg = original.reviews && original.reviews.length ? original.reviews.average(function (x) { return x.score; }) : original.score;
    a.review = avg || 0;
    a.lines.push('<span class="gc-dim">Original: ' + esc(original.topic.name + ' / ' + original.genre.name + (original.secondGenre ? '-' + original.secondGenre.name : '')) +
      ', reviews ' + (avg ? avg.toFixed(1) : '?') + ', ' + UI.getShortNumberString(original.unitsSold || 0) + ' units. ' +
      'Compared with the best new game you could make: ' + pct(a.ratio) + '.</span>');
    return a;
  };
  GC.sequelAdvice = sequelAdvice;

  var historyGames = function (pack) {
    var list = pack ? GameManager.company.getPossibleGamesForPack() : GameManager.company.getPossibleGamesForSequel();
    // the game's own slide order: newest first, expansion packs left out
    return list.slice().reverse().filter(function (g) { return !g.flags.isExtensionPack; });
  };

  var sequelState = null;

  var renderSequelCard = function () {
    var $dlg = $('#gameHistoryDialog');
    if (!sequelState || !$dlg.is(':visible')) {
      $('.gc-seq-card').remove();
      if (sequelState) clearInterval(sequelState.timer);
      sequelState = null;
      return;
    }
    var $card = $('.gc-seq-card');
    if (!$card.length) {
      $card = $('<div class="gc-panel gc-card gc-seq-card"><div class="gc-title"></div><div class="gc-seq-now"></div>' +
        '<div class="gc-seq-top"></div></div>').appendTo('body');
      $card.on('click', '.gc-seq-pick', function () {
        Sound.click();
        showSlide($(this).attr('data-id'));
      });
      $card.find('.gc-title').text('Game Consultant: ' + (sequelState.pack ? 'expansion pack' : 'sequel'));
      var top = sequelState.ranked.slice(0, 4);
      $card.find('.gc-seq-top').html('<div class="gc-label">Best picks right now</div>' + top.map(function (a, i) {
        return '<div class="gc-seq-pick" data-id="' + esc(a.original.id) + '"><span class="gc-score ' + a.cls + '">' + (i + 1) + '</span> ' +
          esc(a.original.title) + ' <span class="gc-dim">' + (a.timing.ok && a.timing.released ? pct(a.ratio) : 'wait ' + a.timing.wait + 'w') + '</span></div>';
      }).join(''));
    }
    var rect = $dlg.parents('.ui-dialog:first').get(0).getBoundingClientRect();
    var right = window.innerWidth - rect.right - 14;
    var onRight = right >= 180 || right >= rect.left - 14;
    var width = Math.max(170, Math.min(300, (onRight ? right : rect.left - 14) - 20));
    $card.css({ top: rect.top + 50, width: width, left: onRight ? rect.right + 10 : Math.max(4, rect.left - width - 30) });
    var id = $dlg.find('.rsActiveSlide .gameId').text();
    if (id && id !== sequelState.shown) {
      sequelState.shown = id;
      var a = sequelState.byId[id];
      $card.find('.gc-seq-now').html(a ? '<div class="gc-seq-head"><span class="gc-score ' + a.cls + '">' + esc(a.original.title) + '</span></div>' +
        '<div class="gc-seq-verdict">' + esc(a.headline) + '</div>' + a.lines.map(function (l) { return '<div class="gc-seq-line">' + l + '</div>'; }).join('') : '');
      $card.find('.gc-seq-pick').removeClass('gc-seq-active').filter('[data-id="' + id + '"]').addClass('gc-seq-active');
    }
  };

  var showSlide = function (id) {
    var slider = $('#gameHistoryContent .royalSlider').data('royalSlider');
    if (!slider) return;
    var index = -1;
    $.each(slider.slides || [], function (i, s) {
      if (index < 0 && s.content && $(s.content).find('.gameId').text() === id) index = i;
    });
    if (index < 0) index = historyGames(sequelState.pack).map(function (g) { return g.id; }).indexOf(id);
    if (index >= 0) slider.goTo(index);
  };

  GC.showSequelCard = function (pack) {
    newGameCache = {};
    var ranked = historyGames(pack).map(function (g) { return sequelAdvice(g, pack); });
    var byId = {};
    ranked.forEach(function (a) { byId[a.original.id] = a; });
    // within 1% the game itself doesn't care, so prefer sequels to the better-received originals
    var maxScore = Math.max.apply(null, ranked.map(function (a) { return a.score || 0; }).concat([1e-9]));
    ranked.sort(function (x, y) {
      var dx = Math.round(100 * (x.score || 0) / maxScore), dy = Math.round(100 * (y.score || 0) / maxScore);
      return dy !== dx ? dy - dx : (y.review || 0) - (x.review || 0) || (y.original.unitsSold || 0) - (x.original.unitsSold || 0);
    });
    if (sequelState) clearInterval(sequelState.timer);
    $('.gc-seq-card').remove();
    // the game's slider has no change event we can rely on, so follow the active slide while the dialog is open
    sequelState = { pack: pack, ranked: ranked, byId: byId, shown: null, timer: setInterval(renderSequelCard, 250) };
    renderSequelCard();
  };

  wrap('showGameHistory', function (done, select, postMortem) {
    if (select && !postMortem && GameManager.flags.selectGameActive) GC.showSequelCard(GameManager.flags.createPack === true);
  });

  // Sequel notes for the concept dialog: timing and the engine actually picked there.
  var sequelNotes = function (sel) {
    var game = GameManager.company.currentGame;
    var original = game.sequelTo ? GameManager.company.getGameById(game.sequelTo) : null;
    if (!original) return '';
    var kind = GameManager.flags.createPack ? 'expansion pack' : 'sequel';
    var timing = sequelTiming(original, sel.size);
    var engine = sequelEngine(original);
    var picked = byName(GameManager.company.engines, buttonText(dialog().find('.pickEngineButton')));
    var out = [];
    out.push(timing.ok ? '<span class="gc-ok">\u2713 Ships ~' + Math.round(timing.gap) + ' weeks after ' + esc(original.title) + '.</span>' :
      '<span class="gc-warn">\u2717 Ships only ~' + Math.round(timing.gap) + ' weeks after ' + esc(original.title) + ': wait ' + timing.wait +
      ' more weeks (under 40: -0.4, hype turns negative, fans leave).</span>');
    if (picked && original.engine && picked.id === original.engine.id) {
      out.push('<span class="gc-warn">\u2717 Same engine as the original (-0.1, half the hype bonus)' +
        (engine.better ? ': pick ' + esc(engine.better.name) + '.' : '.') + '</span>');
    } else if (picked && (!original.engine || picked.techLevel > original.engine.techLevel)) {
      out.push('<span class="gc-ok">\u2713 ' + esc(picked.name) + ' is newer than the original\'s engine: +0.2 and more hype.</span>');
    } else if (engine.better) {
      out.push('<span class="gc-warn">! Pick the ' + esc(engine.better.name) + ' engine for +0.2 and more hype.</span>');
    }
    return '<span class="gc-label">' + (kind === 'sequel' ? 'Sequel' : 'Expansion pack') + ':</span> ' + out.join('<br>');
  };

  // ---------------------------------------------------------------- publishing contracts
  // ProjectContracts.publisherContracts: a deal can fix topic, genre, platform, game size and audience; it pays up
  // front, takes a penalty if the reviews land below minScore, and you keep royaltyRate of the sales (the publisher
  // brings the audience). The best deal is the one whose constraints still allow a game closest to your best one.

  // Recent review scores, as a rough yardstick for "can we beat the minimum score?".
  var recentScore = function () {
    var games = GameManager.company.gameLog.filter(function (g) { return g.score && !g.flags.isExtensionPack; }).slice(-5);
    return games.length ? games.reduce(function (s, g) { return s + g.score; }, 0) / games.length : null;
  };

  var contractAdvice = function (contract) {
    var company = GameManager.company;
    var size = contract.gameSize || 'medium';
    var topic = contract.topic ? byId(Topics.topics, contract.topic) : null;
    var platform = contract.platform ? byId(Platforms.allPlatforms, contract.platform) : null;
    var m = buildModel({ size: size, licensedOnly: !contract.platform });
    var fixed = { platformCount: 1 };
    if (topic) fixed.topic = topic;
    if (contract.genre) fixed.genre = byId(GameGenre.getAll(), contract.genre);
    if (contract.gameAudience) fixed.audience = contract.gameAudience;
    if (platform) fixed.platforms = [platform];
    var a = { contract: contract, lines: [] };
    var researched = !topic || company.topics.indexOf(topic) !== -1;
    var licensed = !platform || company.licencedPlatforms.indexOf(platform) !== -1;
    if (platform && !m.info[platform.id]) {
      a.ratio = 0;
      a.cls = 'gc-bad';
      a.headline = platform.name + ' is no longer on the market.';
      return a;
    }
    var r = solve(m, fixed); // a fixed topic is rated even when it isn't researched yet
    var key = 'contract-' + size;
    var fresh = newGameCache[key] || (newGameCache[key] = solve(buildModel({ size: size, licensedOnly: true }), { platformCount: 1 }));
    a.r = r;
    a.ratio = r && fresh ? r.value / fresh.value : 0;
    var avg = recentScore();
    a.expected = avg === null ? null : Math.min(10, avg * a.ratio);
    a.safe = a.expected === null ? null : a.expected >= contract.minScore + 0.5;
    a.risky = a.expected !== null && !a.safe && a.expected >= contract.minScore - 0.5;
    a.usable = researched && !!r;
    a.cls = !a.usable || a.safe === false && !a.risky ? 'gc-bad' : a.risky ? 'gc-okay' : gradeClass(Math.min(a.ratio, 1));
    if (!r) a.headline = 'No platform can take this game size.';
    else {
      var free = [];
      if (!topic) free.push('topic');
      if (!contract.genre) free.push('genre');
      if (!platform) free.push('platform');
      var grade = a.ratio >= 0.95 ? 'great' : a.ratio >= 0.85 ? 'good' : a.ratio >= POOR ? 'OK' : 'poor';
      a.headline = (researched ? grade.charAt(0).toUpperCase() + grade.slice(1) + ' deal: make ' :
        'Research ' + topic.name + ' first; then it is a ' + grade + ' deal: make ') +
        describe(r) + ' (' + pct(a.ratio) + ' of your best ' + General.getGameSizeLabel(size) + ' game).';
    }
    var ok = '<span class="gc-ok">\u2713</span> ', bad = '<span class="gc-warn">\u2717</span> ', meh = '<span class="gc-meh">!</span> ';
    if (!researched) a.lines.push(bad + esc(topic.name) + ' is not researched yet, so this deal can\'t be accepted.');
    if (!licensed) a.lines.push(meh + 'Needs a ' + esc(platform.name) + ' licence (' + UI.getShortNumberString(platform.licencePrize) + '), bought when you accept.');
    if (a.expected !== null) {
      a.lines.push((a.safe ? ok : a.risky ? meh : bad) + 'Needs a review score of ' + contract.minScore + '; your recent games average ' +
        avg.toFixed(1) + ', so expect about ' + a.expected.toFixed(1) + '.' + (a.safe ? '' : ' Missing it costs the ' +
        UI.getShortNumberString(contract.penalty) + ' penalty.'));
    }
    a.lines.push('<span class="gc-meh">$</span> Pays ' + UI.getShortNumberString(contract.payment) + ' up front, then ' +
      Math.floor(100 * contract.royaltyRate) + '% of the sales (the publisher brings the audience).');
    if (company.staff.length && size !== 'small') {
      var ideal = General.getOptimalTeamSize({ gameSize: size });
      if (company.staff.length < ideal) a.lines.push(meh + General.getGameSizeLabel(size) + ' games want ' + ideal + ' people; you have ' + company.staff.length + '.');
    }
    if (r) a.lines.push('<div class="gc-chips">' + breakdown(r) + '</div>');
    // rank by how good a game the deal allows, then by not risking the penalty, then by up-front pay
    a.score = a.ratio * (a.safe === false ? (a.risky ? 0.9 : 0.6) : 1) - (a.usable ? 0 : 10);
    a.blocker = !researched ? 'research ' + topic.name : !r ? 'no platform' : '';
    return a;
  };
  GC.contractAdvice = contractAdvice;

  var contractState = null;

  var renderContractCard = function () {
    var $win = $('#findContractWorkWindow');
    if (!contractState || !$win.is(':visible')) {
      $('.gc-contract-card').remove();
      if (contractState) clearInterval(contractState.timer);
      contractState = null;
      return;
    }
    var $card = $('.gc-contract-card');
    if (!$card.length) {
      $card = $('<div class="gc-panel gc-card gc-seq-card gc-contract-card"><div class="gc-title">Game Consultant: publishing deals</div>' +
        '<div class="gc-seq-now"></div><div class="gc-seq-top"></div></div>').appendTo('body');
      $card.on('click', '.gc-seq-pick', function () {
        Sound.click();
        var slider = $win.find('.royalSlider').data('royalSlider');
        if (slider) slider.goTo(parseInt($(this).attr('data-index'), 10));
      });
      // deals you can take first, best game first; locked ones after them, with what unlocks them
      var top = contractState.ranked.slice(0, 5);
      $card.find('.gc-seq-top').html('<div class="gc-label">Best value deals</div>' + top.map(function (a, i) {
        return '<div class="gc-seq-pick' + (a.usable ? '' : ' gc-locked') + '" data-index="' + a.index + '"><span class="gc-score ' +
          (a.usable ? a.cls : 'gc-grey') + '">' + (i + 1) + '</span> ' + esc(a.contract.name) + ' <span class="gc-dim">' + pct(a.ratio) +
          (a.blocker ? ', ' + esc(a.blocker) : a.safe === false ? (a.risky ? ', risky' : ', likely penalty') : '') + '</span></div>';
      }).join('') + (contractState.ranked.some(function (a) { return a.usable; }) ? '' :
        '<div class="gc-dim">None of these deals can be accepted right now.</div>'));
    }
    var box = $win.closest('.ui-dialog').get(0) || $win.get(0);
    var rect = box.getBoundingClientRect();
    var right = window.innerWidth - rect.right - 14;
    var onRight = right >= 180 || right >= rect.left - 14;
    var width = Math.max(170, Math.min(300, (onRight ? right : rect.left - 14) - 20));
    $card.css({ top: rect.top + 50, width: width, left: onRight ? rect.right + 10 : Math.max(4, rect.left - width - 30) });
    var index = $win.find('.rsActiveSlide .cardId').text();
    if (index !== '' && index !== contractState.shown) {
      contractState.shown = index;
      var a = contractState.byIndex[index];
      $card.find('.gc-seq-now').html(a ? '<div class="gc-seq-head"><span class="gc-score ' + a.cls + '">' + esc(a.contract.name) + '</span> ' +
        '<span class="gc-dim">' + esc(a.contract.publisher || '') + '</span></div><div class="gc-seq-verdict">' + esc(a.headline) + '</div>' +
        a.lines.map(function (l) { return '<div class="gc-seq-line">' + l + '</div>'; }).join('') :
        '<div class="gc-dim">Not a publishing deal: the consultant rates publisher contracts only.</div>');
      $card.find('.gc-seq-pick').removeClass('gc-seq-active').filter('[data-index="' + index + '"]').addClass('gc-seq-active');
    }
  };

  GC.showContractCard = function (contracts) {
    newGameCache = {};
    var byIndex = {};
    var ranked = [];
    contracts.forEach(function (c, i) {
      if (c.type !== 'gameContract') return;
      var a = contractAdvice(c);
      a.index = i;
      byIndex[i] = a;
      ranked.push(a);
    });
    if (contractState) clearInterval(contractState.timer);
    $('.gc-contract-card').remove();
    if (!ranked.length) return;
    ranked.sort(function (x, y) { return y.score - x.score || y.contract.payment - x.contract.payment; });
    contractState = { ranked: ranked, byIndex: byIndex, shown: null, timer: setInterval(renderContractCard, 250) };
    renderContractCard();
  };

  // The offered contracts only exist inside the game's dialog function; capture the list it asks for.
  var showFindContractWorkMenu = UI.showFindContractWorkMenu;
  if (showFindContractWorkMenu) {
    UI.showFindContractWorkMenu = function () {
      var captured = null;
      var getAvailable = ProjectContracts.getAvailable;
      ProjectContracts.getAvailable = function () {
        captured = getAvailable.apply(this, arguments);
        return captured;
      };
      var result;
      try {
        result = showFindContractWorkMenu.apply(this, arguments);
      } finally {
        ProjectContracts.getAvailable = getAvailable;
      }
      try {
        if (captured && captured.length) GC.showContractCard(captured);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('Game Consultant: contracts', e);
      }
      return result;
    };
  }

  // Notes for the concept dialog while a publishing deal is running.
  var contractNotes = function (current) {
    var contract = GameManager.currentContract;
    if (!contract || contract.type !== 'gameContract') return '';
    var avg = recentScore();
    var best = solve(buildModel({ size: contract.gameSize || 'medium', licensedOnly: true }), { platformCount: 1 });
    var ratio = current && best ? current.value / best.value : 0;
    var expected = avg === null ? null : Math.min(10, avg * ratio);
    var line = expected === null ? 'Needs a review score of ' + contract.minScore + '.' :
      'Needs ' + contract.minScore + '; expect about ' + expected.toFixed(1) + (expected >= contract.minScore + 0.5 ? ' \u2713' :
        ' (risk of the ' + UI.getShortNumberString(contract.penalty) + ' penalty)');
    return '<span class="gc-label">Publishing deal (' + esc(contract.publisher || '') + '):</span> ' +
      '<span class="' + (expected !== null && expected < contract.minScore + 0.5 ? 'gc-warn' : 'gc-ok') + '">' + esc(line) + '</span>';
  };

  // ---------------------------------------------------------------- development stages
  // Review rules (Reviews.rateGame), with share = fraction of a stage's time:
  //   >=2 areas with weighting >=0.9 at share >=40%: +0.2 (one: +0.1, none: -0.15)
  //   areas with weighting <0.8 at share >=40%: one -0.1, two -0.2
  //   every area with weighting >=0.9 at share <=20%: -0.15
  //   design/tech within 25% of the genre's golden ratio: +0.1, more than 50% off: -0.1
  // Slider value v gives share 10% + 70% * v / sum(v). Score ~ (1 + bonus) * (design + tech).

  var sliderGrid = function (levels) {
    var out = [];
    levels.forEach(function (a) {
      levels.forEach(function (b) {
        levels.forEach(function (c) {
          if (Math.max(a, b, c) !== 100) return;
          out.push({ values: [a, b, c], shares: sharesOf([a, b, c]) });
        });
      });
    });
    return out;
  };
  var sharesOf = function (values) {
    var sum = values[0] + values[1] + values[2];
    if (sum === 0) return [1 / 3, 1 / 3, 1 / 3];
    return values.map(function (v) { return (v / (sum / 70) + 10) / 100; });
  };
  var FINE = sliderGrid([0, 25, 50, 75, 100]);
  var COARSE = sliderGrid([0, 50, 100]);

  var featureBonus = function (game, features) {
    return features.reduce(function (s, f) {
      var eff = f.getEfficiency ? f.getEfficiency(game) : 1;
      var level = LevelCalculator.getLevelBonusFactor(f.experience || 0);
      return s + (f.v || 0) * (isNaN(level) ? 1 : level) * eff * 0.8;
    }, 0);
  };

  var stageModel = function (selectedFeatures) {
    var company = GameManager.company;
    var game = company.currentGame;
    var stage = GameManager.getCurrentDevStage();
    var stages = [Missions.Stage1Missions, Missions.Stage2Missions, Missions.Stage3Missions];
    var basePoints = General.getGameBasePoints(game) / 9;
    var durationScale = General.getGameSizeDurationFactor(game.gameSize) * General.getMultiPlatformDurationFactor(game) * 3 * Missions.BASE_DURATION;
    var past = {};
    (game.featureLog || []).forEach(function (e) {
      if (e.missionType === 'mission') past[e.id] = e.duration / durationScale;
    });
    var staffD = 0, staffT = 0;
    company.staff.forEach(function (s) {
      staffD += s.designFactor;
      staffT += s.technologyFactor;
    });
    var tg = GameGenre.getGenreWeighting(game.topic.genreWeightings, game.genre, game.secondGenre);
    var known = (game.features || []).slice();
    (selectedFeatures || []).forEach(function (f) {
      if (known.indexOf(f) == -1) known.push(f);
    });
    var resp = game.isStaffResponsibilityEnabled();
    var staff = company.staff.map(function (s) {
      return { id: s.id, name: s.name, d: s.designFactor, t: s.technologyFactor, expert: s.flags.expert, load: s.flags.workload || 0 };
    });
    var assigned = game.flags.featureResponsibility || {};
    var missions = stages.map(function (list, si) {
      return list.map(function (mission) {
        var feats = known.filter(function (f) { return f.category === mission.id; });
        var x = {
          mission: mission,
          stage: si + 1,
          w: Missions.getGenreWeighting(mission, game),
          base: Missions.BASE_POINTS * Missions.getGeneralFactor(company, mission) + basePoints,
          dF: mission.designFactor,
          tF: mission.technologyFactor,
          features: feats,
          bonus: featureBonus(game, feats),
          past: past.hasOwnProperty(mission.id) ? past[mission.id] : null,
          owner: byId(staff, assigned[mission.id]),
          hasExpert: staff.some(function (s) { return s.expert === mission.id; }),
          fD: 1,
          fT: 1
        };
        if (resp && staff.length) {
          // planning factor for stages without a chosen person: the best fit at a full (100%) workload
          var top = staff.slice().sort(function (a, b) { return staffFit(b, x) - staffFit(a, x); })[0];
          x.fD = responsibleFactor(top, mission, 'd', 100);
          x.fT = responsibleFactor(top, mission, 't', 100);
        }
        return x;
      });
    });
    return {
      game: game,
      stage: stage,
      missions: missions,
      resp: resp && staff.length > 0,
      staff: staff,
      teamScale: General.getOptimalTeamSize(game) / 3,
      aaa: game.gameSize === 'aaa',
      staffD: staffD || 1,
      staffT: staffT || 1,
      tg: tg,
      ratio: GameGenre.getGoldenRatio(game.genre, game.secondGenre),
      mmo: game.flags.mmo ? 2 : 1,
      D: game.designPoints || 0,
      T: game.technologyPoints || 0
    };
  };

  // General.getResponsibleStaffFactor: the responsible person's skill scales the whole team's output for that area.
  // effectiveLoad is the workload bar in percent (sum of time shares given to that person this game, scaled to the
  // game size's optimal team); above 100% costs 75% per 100%, below costs 25% per 100%.
  var responsibleFactor = function (s, mission, kind, effectiveLoad) {
    var c = kind === 'd' ? s.d : s.t;
    var f = 0.5 + 0.5 * Math.min(Math.max(c, 0), 1) + 0.1 * c;
    if (s.expert === mission.id) f += 0.15 * c;
    var b = Math.min(Math.max(effectiveLoad / 100 - 1, -1), 1);
    return b > 0 ? f - 0.75 * f * b : f + 0.25 * f * b;
  };
  var staffFit = function (s, x) {
    return x.dF * responsibleFactor(s, x.mission, 'd', 100) + x.tF * responsibleFactor(s, x.mission, 't', 100);
  };

  // Workload bars after this stage if `assign` (one person per current area, or null) is used with `shares`.
  var loadsAfter = function (sm, shares, assign) {
    var loads = {};
    sm.staff.forEach(function (s) { loads[s.id] = s.load; });
    if (assign) assign.forEach(function (s, i) { if (s) loads[s.id] += 100 * shares[i]; });
    for (var id in loads) if (loads.hasOwnProperty(id)) loads[id] *= sm.teamScale;
    return loads;
  };

  // plan[s] = shares of stage s+1 (past stages use the logged shares).
  // assign: people responsible for the current stage's areas; null plans with the best fit for each area.
  var evaluatePlan = function (sm, plan, assign) {
    var D = sm.D, T = sm.T, hi40 = 0, lo40 = 0, hi20 = 0, s = 0, experts = 0;
    var warnings = [];
    var cur = sm.stage - 1;
    var loads = sm.resp && assign ? loadsAfter(sm, plan[cur], assign) : null;
    for (var si = 0; si < 3; si++) {
      for (var i = 0; i < 3; i++) {
        var x = sm.missions[si][i];
        var p, exact = si < cur;
        var who = si === cur && assign ? assign[i] : null;
        if (exact) {
          p = x.past === null ? 1 / 3 : x.past;
          if (x.w >= 0.9 && x.owner && x.owner.expert === x.mission.id) experts++;
        } else {
          p = plan[si][i];
          var eff = x.features.length ? General.getFeatureEfficiencyFromMissionFocus(sm.game, x.features, 100 * p) / 100 : 0;
          var pts = x.base * 3 * p;
          var bonus = x.bonus * eff;
          var fD = x.fD, fT = x.fT;
          if (who) {
            fD = responsibleFactor(who, x.mission, 'd', loads[who.id]);
            fT = responsibleFactor(who, x.mission, 't', loads[who.id]);
          }
          D += sm.tg * sm.staffD * (pts * x.dF + bonus) * fD;
          T += sm.tg * sm.staffT * (pts * x.tF + bonus) * fT;
          if (x.w >= 0.9 && (who ? who.expert === x.mission.id : x.hasExpert)) experts++;
        }
        // planned shares get a small margin so floating point rounding in the game can't flip a threshold
        var at40 = exact ? p >= 0.4 : p >= 0.405;
        var at40bad = exact ? p >= 0.4 : p >= 0.395;
        var at20 = exact ? p <= 0.2 : p <= 0.205;
        if (x.w >= 0.9 && at40) hi40++;
        if (x.w < 0.8 && at40bad) {
          lo40++;
          if (si + 1 === sm.stage) warnings.push(x.mission.name + ' is a weak area for this game; keep it under 40%');
        }
        if (x.w >= 0.9 && at20) {
          hi20++;
          if (si + 1 === sm.stage) warnings.push(x.mission.name + ' matters for this game; give it more than 20%');
        }
      }
    }
    s += hi40 >= 2 ? 0.2 : hi40 === 1 ? 0.1 : -0.15 * sm.mmo;
    s -= (lo40 >= 2 ? 0.2 : lo40 === 1 ? 0.1 : 0) * sm.mmo;
    s -= 0.15 * sm.mmo * hi20;
    var diff = D * sm.ratio - T;
    var off = T > D ? Math.abs(diff / T * 100) : Math.abs(diff / D * 100);
    if (D + T >= 30) {
      if (off <= 25) s += 0.1;
      else if (off > 50) s -= 0.1;
    }
    var score = (1 + s) * (D + T);
    // AAA reviews are capped at 10 - 0.6 per missing expert (of 3) on areas weighted >= 0.9
    if (sm.aaa) score *= 1 - 0.06 * (3 - Math.min(experts, 3));
    if (loads) {
      sm.staff.forEach(function (st) {
        if (loads[st.id] > 105) warnings.push(st.name + ' would be at ' + Math.round(loads[st.id]) + '% workload');
      });
    }
    return { score: score, bonus: s, td: D ? T / D : 0, off: off, warnings: warnings, hi40: hi40, experts: experts, loads: loads };
  };

  // Best person for each of the current stage's areas, for fixed shares (everyone can take several areas).
  var bestAssignment = function (sm, plan) {
    var shares = plan.picks.map(function (p) { return p.shares; });
    var n = sm.staff.length;
    var best = null;
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        for (var c = 0; c < n; c++) {
          var assign = [sm.staff[a], sm.staff[b], sm.staff[c]];
          var r = evaluatePlan(sm, shares, assign);
          if (!best || r.score > best.score + 1e-9) {
            best = r;
            best.assign = assign;
          }
        }
      }
    }
    return best.assign;
  };

  // Best plan for the current and remaining stages; `current` pins the current stage's shares.
  var planStages = function (sm, current, assign) {
    var cur = sm.stage - 1;
    var best = null;
    var plan = [[1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]];
    var picks = [];
    var choices = function (si) {
      if (si === cur && current) return [{ values: null, shares: current }];
      return si === cur ? FINE : COARSE;
    };
    var visit = function (si) {
      if (si > 2) {
        var r = evaluatePlan(sm, plan, assign);
        if (!best || r.score > best.score + 1e-9) {
          r.picks = picks.slice();
          best = r;
        }
        return;
      }
      var list = choices(si);
      for (var i = 0; i < list.length; i++) {
        plan[si] = list[i].shares;
        picks[si] = list[i];
        visit(si + 1);
      }
    };
    visit(cur);
    return best;
  };

  // Sliders and staff depend on each other (workload grows with time share), so alternate: plan with the best fit
  // per area, pick people for that plan, re-plan for those people, then re-pick people.
  var recommend = function (sm) {
    var plan = planStages(sm, null, null);
    if (!sm.resp) return plan;
    var assign = bestAssignment(sm, plan);
    plan = planStages(sm, null, assign);
    assign = bestAssignment(sm, plan);
    var final = planStages(sm, plan.picks[sm.stage - 1].shares, assign);
    final.picks = plan.picks;
    final.assign = assign;
    return final;
  };

  // The people the player has put on the current stage's areas (null where nobody is assigned yet).
  var currentAssignment = function (sm) {
    return sm.missions[sm.stage - 1].map(function (x) { return x.owner; });
  };

  GC.responsibleFactor = responsibleFactor;
  GC.recommendStage = function () {
    return recommend(stageModel(UI._getSelectedFeatures ? UI._getSelectedFeatures() : []));
  };

  var stageState = { key: null, plan: null, applied: false, later: '' };

  var sliderWrappers = function () {
    return dialog().find('.focusSliderWrapper');
  };
  var currentSliderValues = function () {
    return sliderWrappers().map(function () {
      return $(this).find('.focusSlider').slider('value');
    }).get();
  };

  var applyRecommendation = function () {
    if (!stageState.plan) return;
    var stage = GameManager.getCurrentDevStage();
    var values = stageState.plan.picks[stage - 1].values;
    var assign = stageState.plan.assign;
    var game = GameManager.company.currentGame;
    var missions = [Missions.Stage1Missions, Missions.Stage2Missions, Missions.Stage3Missions][stage - 1];
    sliderWrappers().each(function (i) {
      var $s = $(this).find('.focusSlider');
      $s.slider('value', values[i]);
      var slide = $s.slider('option', 'slide');
      if (slide) slide.call($s.get(0), { type: 'slide' }, { value: values[i] });
      if (assign && assign[i]) {
        // same effect as dragging the person onto the area: the game reads both the flag and the label
        game.flags.featureResponsibility = game.flags.featureResponsibility || {};
        game.flags.featureResponsibility[missions[i].id] = assign[i].id;
        $(this).find('.focusSliderStaffName').stop(true, true).text(assign[i].name).css('opacity', 1);
      }
    });
    UI._updateFeatureFocusPreview();
  };
  GC.applySliderRecommendation = applyRecommendation;

  var ensureStagePanel = function () {
    var $d = dialog();
    var $panel = $d.find('.gc-stage');
    if ($panel.length) return $panel;
    // fixed-height strip above the sliders; .gc-compact shortens the sliders by the same amount so nothing moves
    $panel = $('<div class="gc-stage gc-panel">' +
      '<div class="gc-row"><label class="gc-toggle" title="Apply the recommendation automatically at every stage">' +
      '<input type="checkbox" class="gc-autoapply">Auto-apply</label>' +
      '<span class="gc-title">Consultant</span><span class="gc-score"></span><span class="gc-stage-status"></span></div>' +
      '<div class="gc-row"><div class="gc-auto gc-apply">Apply recommendation</div><span class="gc-stage-plan"></span></div></div>');
    $panel.find('.gc-autoapply').prop('checked', getSetting('autoSliders', false)).on('change', function () {
      setSetting('autoSliders', this.checked);
      if (this.checked) applyRecommendation();
    });
    $panel.find('.gc-apply').on('click', function () {
      Sound.click();
      applyRecommendation();
    });
    $d.addClass('gc-compact').find('.focusSliderContainer').before($panel);
    return $panel;
  };

  var refreshStage = function () {
    var $d = dialog();
    if (!$d.find('.focusSliderWrapper').length || !GameManager.company.currentGame) return;
    var $panel = ensureStagePanel();
    var selected = UI._getSelectedFeatures ? UI._getSelectedFeatures() : [];
    var key = GameManager.getCurrentDevStage() + ':' + selected.map(function (f) { return f.id; }).sort().join(',');
    var sm = stageModel(selected);
    if (key !== stageState.key) {
      stageState.key = key;
      stageState.plan = recommend(sm);
      var values = stageState.plan.picks[sm.stage - 1].values;
      var shares = sharesOf(values);
      var assign = stageState.plan.assign;
      sliderWrappers().each(function (i) {
        var x = sm.missions[sm.stage - 1][i];
        var $w = $(this);
        $w.find('.gc-rec, .gc-marker').remove();
        var who = assign && assign[i] ? '<div class="gc-rec-staff">\u2192 ' + esc(assign[i].name) +
          (assign[i].expert === x.mission.id ? ' (expert)' : '') + '</div>' : '';
        $w.find('.focusSliderTitle').after('<div class="gc-rec"><span class="gc-chip ' + tierClass(x.w) + '">' + esc(tierOf(x.w)) + '</span> Rec. ' +
          values[i] + ' (' + Math.round(100 * shares[i]) + '%)' + who + '</div>');
        $w.find('.focusSlider').append('<div class="gc-marker" style="bottom:' + values[i] + '%"></div>');
      });
      var later = [];
      for (var si = sm.stage; si < 3; si++) {
        var pick = stageState.plan.picks[si].values;
        var focus = sm.missions[si].filter(function (x, i) { return pick[i] === 100; }).map(function (x) { return x.mission.name; });
        later.push('Stage ' + (si + 1) + ': ' + focus.join(' + '));
      }
      stageState.later = later.length ? 'Next: ' + later.join(DOT) : 'Last stage: finish strong.';
      if (getSetting('autoSliders', false) && !stageState.applied) {
        stageState.applied = true;
        applyRecommendation();
        return;
      }
    }
    var current = sm.resp ? currentAssignment(sm) : null;
    var mine = planStages(sm, sharesOf(currentSliderValues()), current);
    if (current) {
      sm.missions[sm.stage - 1].forEach(function (x, i) {
        if (!current[i]) mine.warnings.unshift('Drag someone onto ' + x.mission.name);
      });
      var keyAreas = sm.missions.reduce(function (n, list) {
        return n + list.filter(function (x) { return x.w >= 0.9; }).length;
      }, 0);
      stageState.experts = 'Experts on key areas: ' + mine.experts + ' of ' + keyAreas +
        ' (2 allow a perfect 10/10/10/10' + (sm.aaa ? ', AAA needs 3 to reach 10' : '') + ').';
    }
    var ratio = mine.score / stageState.plan.score;
    $panel.find('.gc-score').attr('class', 'gc-score ' + gradeClass(ratio)).text(pct(Math.min(ratio, 1)) + ' of best');
    var status = 'T/D ' + mine.td.toFixed(2) + ' of ' + sm.ratio.toFixed(2) + (mine.off <= 25 ? ' \u2713' : mine.off > 50 ? ' \u2717' : ' ~') +
      DOT + 'bonus ' + (mine.bonus >= 0 ? '+' : '') + mine.bonus.toFixed(2);
    $panel.find('.gc-stage-status').text(status);
    $panel.find('.gc-apply').text(sm.resp ? 'Apply sliders + staff' : 'Apply recommendation');
    $panel.find('.gc-stage-plan').html(mine.warnings.length ? '<span class="gc-warn">' + esc(mine.warnings[0]) + '</span>' : esc(stageState.later));
    $panel.attr('title', mine.warnings.concat([stageState.later], current ? [stageState.experts,
      'Staff: the person responsible for an area multiplies the whole team\'s output there by their skill (more as an ' +
      'expert); workload over 100% costs a lot and causes bugs.'] : [], [
      'T/D: expected tech/design ratio at release vs. the genre target (within 25% earns a review bonus).',
      'Bonus: expected review bonus from time allocation and T/D, if the next stages follow the plan.']).join('\n'));
    tagStageFeatures(); // feature value depends on the sliders, so re-tag on every change
  };

  var stageTimer = null;
  var scheduleStage = function () {
    if (stageTimer) clearTimeout(stageTimer);
    stageTimer = setTimeout(function () {
      stageTimer = null;
      try {
        refreshStage();
      } catch (e) {
        if (typeof console !== 'undefined') console.error('Game Consultant: stage', e);
      }
    }, 60);
  };

  wrap('showFeatureList', function () {
    stageState = { key: null, plan: null, applied: false, later: '' };
    scheduleStage();
  });
  wrap('_updateFeatureFocusPreview', scheduleStage);

  // ---------------------------------------------------------------- additional features
  // General.getFeatureEfficiencyFromMissionFocus: an area turns at most share% / (5 x size factor) of feature benefit
  // ("v") into points (size factor 1, large 0.7, AAA 0.4). Past that the game shows "(x%)" on the area and the extra
  // features are paid for but add nothing. Research.getDevCost also grows faster than v: about 5K per point of benefit
  // at v1-2, 15K at v10 and 28K at v14, times the game size.

  var tag = function ($el, text, cls, title) {
    $el.append($('<span class="gc-ftag ' + cls + '"></span>').text(text).attr('title', title));
  };

  var tagStageFeatures = function () {
    var $items = dialog().find('.featureSelectionPanel .selectableGameFeatureItem');
    if (!$items.length || !GameManager.company.currentGame) return;
    var game = GameManager.company.currentGame;
    var missions = [Missions.Stage1Missions, Missions.Stage2Missions, Missions.Stage3Missions][GameManager.getCurrentDevStage() - 1] || [];
    var ids = missions.map(function (m) { return m.id; });
    var shares = UI._getSelectedFeaturePercentages().map(function (p) { return p / 100; });
    var selected = UI._getSelectedFeatures();
    var owned = game.features || [];
    var absorb = game.gameSize === 'aaa' ? 0.4 : game.gameSize === 'large' ? 0.7 : 1;
    var costOf = function (f) {
      return owned.indexOf(f) !== -1 ? 0 : Research.getDevCost(f, game);
    };
    // Per area, the benefit it can absorb goes to features already paid for first, then to the selected ones with
    // the cheapest benefit per dollar; whatever doesn't fit is what's wasted.
    var used = {};
    var fill = {};
    ids.forEach(function (id, mi) {
      var room = 100 * shares[mi] / (5 * absorb);
      var kept = selected.concat(owned).filter(function (x, i, all) { return all.indexOf(x) === i && x.category === id && x.v; });
      kept.sort(function (a, b) { return costOf(a) / a.v - costOf(b) / b.v || a.v - b.v; });
      var sum = 0;
      kept.forEach(function (x) {
        used[x.id] = Math.min(Math.max((room - sum) / x.v, 0), 1);
        sum += x.v;
      });
      fill[id] = { room: room, sum: sum };
    });
    var rows = [];
    $items.each(function () {
      var f = General.getFeature($(this).attr('feature-id'));
      var mi = f ? ids.indexOf(f.category) : -1;
      if (!f || !f.v || mi < 0) return;
      var area = fill[f.category];
      var isKept = used.hasOwnProperty(f.id);
      var u = used[f.id];
      if (!isKept) {
        // adding it (replacing the selected one of its group, if any) only uses the room left
        var replaced = selected.filter(function (x) { return f.group && x.group === f.group && x.category === f.category; })
          .reduce(function (s, x) { return s + x.v; }, 0);
        u = Math.min(Math.max((area.room - area.sum + replaced) / f.v, 0), 1);
      }
      rows.push({
        $el: $(this), f: f, used: u, gain: u * f.v, paid: owned.indexOf(f) !== -1, cost: costOf(f),
        share: shares[mi], mission: missions[mi], room: area.room, load: area.sum - (isKept ? f.v : 0)
      });
    });
    var rates = rows.filter(function (r) { return !r.paid && r.used >= 0.5; }).map(function (r) { return r.cost / r.gain; });
    var bestRate = rates.length ? Math.min.apply(null, rates) : 0;
    rows.forEach(function (r) {
      r.$el.find('.gc-ftag').remove();
      if (r.paid) return; // already in the engine/game: no further cost
      var title = r.f.name + ' adds ' + pct(r.used) + ' of its benefit at your current sliders. ' + r.mission.name + ' gets ' +
        Math.round(100 * r.share) + '% of this stage, enough for about ' + Math.round(r.room) + ' benefit; the other features there use ' +
        Math.round(r.load) + '. Cost: ' + UI.getShortNumberString(r.cost) + '.';
      if (r.used < 0.05) tag(r.$el, '\u2717 wasted', 'gc-bad', title + ' Skip it, or give ' + r.mission.name + ' more time.');
      else if (r.used < 0.5) tag(r.$el, 'mostly wasted', 'gc-okay', title);
      else if (bestRate && r.cost / r.gain > 3 * bestRate) {
        tag(r.$el, 'pricey', 'gc-grey', title + ' Each useful point costs ' + Math.round(r.cost / r.gain / bestRate) +
          'x more than with the cheapest useful feature here.');
      }
    });
  };

  // Game Concept, feature screen: the graphics type sets the game's tech level, which adds base points to every area
  // (General.getGameBasePoints: 2, 5, 7, 10, 15, 20, 30, 40 by level) and caps Large (needs 3) and AAA (needs 5) reviews.
  var tagConceptFeatures = function () {
    var $items = dialog().find('.dialogScreen2 .selectableGameFeatureItem');
    if (!$items.length || !GameManager.company.currentGame) return;
    var size = GameManager.company.currentGame.gameSize || 'small';
    var graphics = [];
    $items.each(function () {
      var f = General.getFeature($(this).attr('feature-id'));
      $(this).find('.gc-ftag').remove();
      if (f && f.group === 'graphic-type' && f.techLevel !== undefined) graphics.push({ $el: $(this), f: f });
    });
    var top = Math.max.apply(null, graphics.map(function (g) { return g.f.techLevel; }).concat([0]));
    graphics.forEach(function (g) {
      var tl = g.f.techLevel;
      var need = size === 'aaa' ? 5 : size === 'large' ? 3 : 0;
      if (tl < need) {
        tag(g.$el, '\u2717 caps reviews at ' + (10 - Math.min(need - tl, 3)), 'gc-bad',
          General.getGameSizeLabel(size) + ' games need graphics of tech level ' + need + ' (this is ' + tl + '): the review score is capped.');
      } else if (tl === top && graphics.length > 1) {
        tag(g.$el, '\u2605 most points', 'gc-great', 'The newest graphics give every development area the most base points (tech level ' + tl + ').');
      }
    });
  };

  wrap('_updateFeatureListContainer', function () {
    setTimeout(function () {
      try {
        tagConceptFeatures();
        tagStageFeatures();
      } catch (e) {
        if (typeof console !== 'undefined') console.error('Game Consultant: features', e);
      }
    }, 0);
  });

  // ---------------------------------------------------------------- styles

  var css = [
    '.gc-badge{position:absolute;top:3px;right:3px;z-index:3;padding:1px 6px;border-radius:9px;color:#fff;background:#777;font-size:10pt;font-weight:bold;line-height:15pt;text-align:right;pointer-events:none;white-space:nowrap}',
    '.gc-badge .gc-detail{display:block;font-size:8pt;font-weight:normal;line-height:10pt;opacity:.9}',
    '.rating{position:relative}',
    '.rating .gc-badge{top:-10px;right:-12px;z-index:auto;font-size:8pt;line-height:12pt;padding:0 4px}',
    '.gc-great{background:#2f8f2f !important}.gc-good{background:#67a32b !important}.gc-okay{background:#c48f00 !important}.gc-bad{background:#b83a3a !important}',
    '.gc-poor{opacity:.35}.gc-hidden{display:none !important}',
    '.gc-best{box-shadow:0 0 0 3px #2f8f2f}',
    '.gc-panel{margin:4px 14px 0;padding:3px 8px;border:1px solid #c9c9c9;border-radius:8px;background:rgba(255,255,255,.92);color:#222;font-size:9.5pt;line-height:13pt;text-align:left}',
    '.gc-row{overflow:hidden;padding:1px 0}',
    '.gc-title{font-weight:bold;font-size:10pt;color:#d46a00}',
    '.gc-score{margin:0 6px;padding:0 6px;border-radius:8px;color:#fff;font-weight:bold}',
    '.gc-toggle{float:right;margin-left:6px;font-size:8.5pt;cursor:pointer;white-space:nowrap}',
    '.gc-toggle input{display:inline-block;width:auto;height:auto;margin:0 3px 0 0;vertical-align:middle}',
    '.gc-label{font-weight:bold}',
    '.gc-chip{display:inline-block;margin:0 3px 0 0;padding:0 5px;border-radius:7px;color:#fff;font-size:8pt;line-height:12pt;background:#777}',
    '.gc-note{color:#8a5a00;font-size:8.5pt}',
    '.gc-auto{float:right;margin-left:8px;padding:2px 12px;border-radius:6px;background:#f39200;color:#fff;font-weight:bold;font-size:10pt;cursor:pointer;box-shadow:0 2px 0 #b86e00}',
    '.gc-auto:hover{background:#ffa31a}.gc-auto:active{box-shadow:none;position:relative;top:2px}',
    '.gc-auto.gc-disabled{background:#aaa;box-shadow:none;cursor:default}',
    '.gc-rec{font-size:9pt;line-height:13pt}',
    '.gc-rec .gc-chip{font-size:8pt}',
    '.gc-marker{position:absolute;left:-6px;right:-6px;height:0;border-top:3px dashed #2f8f2f;z-index:2;pointer-events:none}',
    '.gc-ok{color:#2f8f2f}.gc-warn{color:#b83a3a;font-weight:bold}',
    '.gc-card{position:absolute;top:60px;z-index:10;margin:0;padding:8px 10px;border:5px solid #FFD17B;background:#FFF9EF;font-size:10pt;line-height:14pt;box-shadow:0 4px 12px rgba(0,0,0,.25)}',
    '.gc-card .gc-title{font-size:13pt;margin-bottom:4px}',
    '.gc-card .gc-score{display:inline-block;margin:0 0 4px;padding:1px 8px;font-size:10.5pt}',
    '.gc-card .gc-chips{margin:3px 0 6px}',
    '.gc-card .gc-chip{margin:1px 3px 1px 0}',
    '.gc-card .gc-best-line{margin:6px 0;padding-top:6px;border-top:1px solid #e5d3b0}',
    '.gc-card .gc-auto{float:none;display:block;margin:6px 0;padding:5px 8px;text-align:center;line-height:13pt}',
    '.gc-card .gc-note{margin-bottom:6px}',
    '.gc-card .gc-team{margin:6px 0;padding-top:6px;border-top:1px solid #e5d3b0;font-size:9pt;line-height:12.5pt}',
    '.gc-card .gc-team:empty{display:none}',
    '.gc-card .gc-sequel{margin:6px 0;padding-top:6px;border-top:1px solid #e5d3b0;font-size:9pt;line-height:12.5pt}',
    '.gc-card .gc-sequel:empty{display:none}',
    '.gc-seq-card{position:fixed;z-index:6100}',
    '.gc-seq-head{margin:4px 0}',
    '.gc-seq-head .gc-score{margin:0;font-size:10.5pt}',
    '.gc-seq-verdict{font-weight:bold;font-size:10.5pt;line-height:14pt;margin:4px 0 6px}',
    '.gc-seq-line{font-size:9pt;line-height:12.5pt;margin:3px 0}',
    '.gc-seq-top{margin-top:8px;padding-top:6px;border-top:1px solid #e5d3b0}',
    '.gc-seq-pick{cursor:pointer;padding:2px 4px;border-radius:5px;font-size:9.5pt;line-height:15pt}',
    '.gc-seq-pick:hover{background:#ffe9c2}.gc-seq-active{background:#fff1d6;font-weight:bold}',
    '.gc-seq-pick .gc-score{margin:0 4px 0 0;padding:0 5px;font-size:8.5pt}',
    '.gc-dim{color:#777}.gc-meh{color:#c48f00;font-weight:bold}',
    '.gc-locked{opacity:.6}.gc-grey{background:#999 !important}',
    '.gc-ftag{position:relative;z-index:2;float:right;margin:1px 2px 0 6px;padding:0 6px;border-radius:7px;color:#fff;font-size:8.5pt;line-height:13pt;font-weight:bold;background:#777}',
    '.gc-card .gc-toggle{float:none;display:block;margin:6px 0 0;white-space:normal}',
    '.gc-stage{height:38px;overflow:hidden;margin:4px 6px 0;padding:2px 8px}',
    '.gc-stage .gc-auto{padding:1px 10px;font-size:9.5pt}',
    '.gc-compact .focusSliderContainer{height:284px !important}',
    '.gc-compact .focusSlider{height:128px !important;margin-top:12px !important;margin-bottom:12px !important}',
    // the chip under each slider shows the exact weighting, which replaces the game's (often uncertain) hint
    '.gc-compact .focusSliderHint{display:none}',
    '.gc-rec-staff{font-weight:bold;color:#2a5d8f}'
  ].join('\n');
  $('<style id="gameConsultantStyles"></style>').text(css).appendTo('head');
})();
