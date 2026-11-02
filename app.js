(function () {
  'use strict';

  const D = window.GDT_DATA;

  const RATINGS = {
    3: { sym: '+++', label: 'Great', cls: 'r-great' },
    2: { sym: '++', label: 'Good', cls: 'r-good' },
    1: { sym: '+', label: 'Okay', cls: 'r-okay' },
    0: { sym: '~', label: 'Not very important', cls: 'r-neutral' },
    '-2': { sym: '−−', label: 'Bad', cls: 'r-bad' },
    '-3': { sym: '−−−', label: 'Terrible', cls: 'r-terrible' },
  };
  const FOCUS_LABELS = {
    3: 'Very important', 2: 'Quite important', 0: 'Not very important',
    '-2': 'Not important', '-3': 'Not at all important',
  };
  const AUD_NAMES = { Y: 'Young', E: 'Everyone', M: 'Mature' };
  const CUSTOM = 'Custom Console';

  const TOPICS = Object.keys(D.topics);
  const PLATFORMS = Object.keys(D.platforms);
  // Custom Console ratings depend on your own release history, so it never takes part in suggestions.
  const SCORED_PLATFORMS = PLATFORMS.filter(p => p !== CUSTOM);

  const FIELDS = [
    { key: 'topic', title: 'Topic', options: TOPICS },
    { key: 'genre', title: 'Genre', options: D.genres },
    { key: 'genre2', title: 'Second genre', hint: 'optional, needs Multi-genre research', options: D.genres },
    { key: 'audience', title: 'Audience', hint: 'needs Target Audience research', options: D.audiences, label: a => AUD_NAMES[a] },
    { key: 'platforms', title: 'Platform', hint: 'pick one or more', options: PLATFORMS, multi: true },
  ];

  const sel = { topic: null, genre: null, genre2: null, audience: null, platforms: [] };
  const ui = { minRating: 1, showFiltered: false, sortByRating: true, query: {}, showHidden: {} };

  // ---------- scoring ----------

  function eachLink(c, fn) {
    const genres = c.genre2 ? [c.genre, c.genre2] : [c.genre];
    const t = c.topic && D.topics[c.topic];
    if (t) {
      for (const g of genres) if (g) fn(t.genre[g], c.topic, g, 'Topic / genre');
      if (c.audience) fn(t.audience[c.audience], c.topic, c.audience, 'Topic / audience');
    }
    for (const p of c.platforms) {
      const pd = D.platforms[p];
      for (const g of genres) if (g) fn(pd.genre[g], p, g, 'Platform / genre');
      if (c.audience) fn(pd.audience[c.audience], p, c.audience, 'Platform / audience');
    }
  }

  function links(c) {
    const out = [];
    eachLink(c, (r, a, b, kind) => { if (r !== null) out.push({ r, a, b, kind }); });
    return out;
  }

  // [worst link, sum of links]; compared lexicographically.
  function score(c) {
    let min = Infinity, sum = 0;
    eachLink(c, r => {
      if (r === null) return;
      if (r < min) min = r;
      sum += r;
    });
    return [min, sum];
  }
  const better = (x, y) => x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);

  // Best full combination reachable from `base` by filling the empty fields.
  function bestCompletion(base) {
    const topics = base.topic ? [base.topic] : TOPICS;
    const genres = base.genre ? [base.genre] : D.genres.filter(g => g !== base.genre2);
    const auds = base.audience ? [base.audience] : D.audiences;
    const plats = base.platforms.length ? [base.platforms] : SCORED_PLATFORMS.map(p => [p]);
    let best = null;
    const c = { topic: null, genre: null, genre2: base.genre2, audience: null, platforms: null };
    for (const t of topics) {
      c.topic = t;
      for (const g of genres) {
        c.genre = g;
        for (const a of auds) {
          c.audience = a;
          for (const ps of plats) {
            c.platforms = ps;
            const s = score(c);
            if (!best || better(s, best.s)) best = { s, c: { ...c } };
          }
        }
      }
    }
    return best;
  }

  function withValue(key, v) {
    const c = { ...sel, platforms: sel.platforms.slice() };
    if (key === 'platforms') { if (!c.platforms.includes(v)) c.platforms.push(v); }
    else c[key] = v;
    return c;
  }

  function isSelected(key, v) {
    return key === 'platforms' ? sel.platforms.includes(v) : sel[key] === v;
  }

  function otherSelected(key) {
    return FIELDS.some(f => f.key !== key && (f.multi ? sel[f.key].length : sel[f.key]));
  }

  const anySelected = () => FIELDS.some(f => (f.multi ? sel[f.key].length : sel[f.key]));
  const display = (v) => AUD_NAMES[v] || v;
  const rating = r => RATINGS[r] || { sym: '?', label: 'Unknown', cls: 'r-neutral' };

  // ---------- rendering ----------

  const $fields = document.getElementById('fields');
  const $summary = document.getElementById('summary');
  const refs = {};

  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function buildSkeleton() {
    for (const f of FIELDS) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<div class="field-head">' +
          '<h2>' + esc(f.title) + '</h2>' +
          (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') +
          '<span class="picked"></span>' +
          '<input type="search" placeholder="Type to search…" aria-label="Search ' + esc(f.title) + '">' +
        '</div>' +
        '<div class="chips" role="group" aria-label="' + esc(f.title) + ' options"></div>' +
        '<div class="field-foot"></div>';
      $fields.appendChild(card);
      const input = card.querySelector('input');
      const chips = card.querySelector('.chips');
      const foot = card.querySelector('.field-foot');
      refs[f.key] = { input, chips, foot, picked: card.querySelector('.picked') };

      input.addEventListener('input', () => { ui.query[f.key] = input.value.trim().toLowerCase(); renderField(f); });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const first = chips.querySelector('.chip:not(.selected)');
          if (first) { toggle(f.key, first.dataset.value); input.value = ''; ui.query[f.key] = ''; render(); }
          e.preventDefault();
        } else if (e.key === 'Escape') {
          input.value = ''; ui.query[f.key] = ''; renderField(f);
        }
      });
      chips.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        toggle(f.key, chip.dataset.value);
        render();
      });
      foot.addEventListener('click', e => {
        if (!e.target.matches('.link-btn')) return;
        ui.showHidden[f.key] = !ui.showHidden[f.key];
        renderField(f);
      });
    }
  }

  function toggle(key, v) {
    if (key === 'platforms') {
      const i = sel.platforms.indexOf(v);
      if (i >= 0) sel.platforms.splice(i, 1); else sel.platforms.push(v);
    } else {
      sel[key] = sel[key] === v ? null : v;
    }
    if (key === 'genre' && sel.genre && sel.genre === sel.genre2) sel.genre2 = null;
    if (key === 'genre2' && sel.genre2 && sel.genre2 === sel.genre) sel.genre = null;
    saveHash();
  }

  // Rates an option against the current picks. `r` is the worst direct match with what is
  // already picked; options with no direct match fall back to the best reachable combination.
  function optionInfo(f, v) {
    const info = { v, idx: f.options.indexOf(v), selected: isSelected(f.key, v), rated: false };
    if (v === CUSTOM) return info; // no fixed ratings
    if (f.key === 'genre2' && v === sel.genre) { info.excluded = true; return info; }
    if (f.key === 'genre' && v === sel.genre2) { info.excluded = true; return info; }
    if (!otherSelected(f.key)) return info;
    const c = withValue(f.key, v);
    info.direct = links(c).filter(l => l.a === v || l.b === v);
    info.best = bestCompletion(c);
    if (info.direct.length) {
      info.r = Math.min(...info.direct.map(l => l.r));
    } else if (info.best && info.best.s[0] !== Infinity) {
      info.r = info.best.s[0];
      info.indirect = true;
    } else {
      return info;
    }
    info.rated = true;
    return info;
  }

  function compareInfo(a, b) {
    if (a.v === CUSTOM) return 1;
    if (b.v === CUSTOM) return -1;
    const ra = a.rated ? a.r : -Infinity, rb = b.rated ? b.r : -Infinity;
    if (ra !== rb) return rb - ra;
    const sa = a.best ? a.best.s : [-Infinity, 0], sb = b.best ? b.best.s : [-Infinity, 0];
    return better(sa, sb) ? -1 : better(sb, sa) ? 1 : a.idx - b.idx;
  }

  function chipTitle(f, info) {
    if (!info.rated) return info.v === CUSTOM
      ? 'Custom Console ratings depend on the games you have released before.'
      : '';
    const lines = info.direct.map(l => display(l.a) + ' + ' + display(l.b) + ': ' + rating(l.r).label);
    if (info.indirect) lines.push('No direct match with your picks.');
    const b = info.best.c;
    const parts = [b.topic, b.genre2 ? b.genre + '/' + b.genre2 : b.genre, AUD_NAMES[b.audience], b.platforms.join(', ')];
    lines.push('Best full game: ' + rating(info.best.s[0]).label + ' (' + parts.join(' · ') + ')');
    return lines.join('\n');
  }

  function renderField(f) {
    const r = refs[f.key];
    const q = ui.query[f.key] || '';
    let infos = f.options.map(v => optionInfo(f, v));
    if (ui.sortByRating && otherSelected(f.key)) infos.sort(compareInfo);
    let hidden = 0;
    const html = [];
    for (const info of infos) {
      if (info.excluded) continue;
      const name = f.label ? f.label(info.v) : info.v;
      if (q && !name.toLowerCase().includes(q) && !info.v.toLowerCase().includes(q) && !info.selected) continue;
      const poor = info.rated && info.r < ui.minRating;
      if (poor && !info.selected && !ui.showFiltered && !ui.showHidden[f.key]) { hidden++; continue; }
      const rt = info.rated ? rating(info.r) : null;
      const cls = ['chip', rt ? rt.cls : 'no-badge', info.indirect ? 'indirect' : '', info.selected ? 'selected' : '',
        poor && !info.selected ? 'dimmed' : ''].join(' ');
      const badge = rt ? '<span class="badge">' + rt.sym + '</span>'
        : info.v === CUSTOM && otherSelected(f.key) ? '<span class="badge">?</span>' : '';
      html.push('<button type="button" class="' + cls + '" data-value="' + esc(info.v) + '" aria-pressed="' + info.selected +
        '" title="' + esc(chipTitle(f, info)) + '">' + esc(name) + badge + '</button>');
    }
    r.chips.innerHTML = html.join('') || '<span class="muted">No matches.</span>';

    const picked = f.multi ? sel[f.key].join(', ') : sel[f.key] ? display(sel[f.key]) : '';
    r.picked.textContent = picked ? '→ ' + picked : '';

    if (hidden) {
      r.foot.innerHTML = hidden + ' poor match' + (hidden > 1 ? 'es' : '') + ' hidden. <button type="button" class="link-btn">Show</button>';
    } else if (ui.showHidden[f.key]) {
      r.foot.innerHTML = '<button type="button" class="link-btn">Hide poor matches</button>';
    } else {
      r.foot.textContent = '';
    }
  }

  function focusKey() {
    const g1 = sel.genre || sel.genre2;
    const g2 = sel.genre ? sel.genre2 : null;
    if (!g1) return null;
    return g2 ? { name: g1 + '/' + g2, data: D.multiFocus[g1 + '/' + g2], sliders: null }
      : { name: g1, data: D.genreFocus[g1], sliders: D.sliders[g1] };
  }

  function renderSummary() {
    const out = [];
    out.push('<div class="card">');
    out.push('<h2>Your game</h2>');
    if (!anySelected()) {
      out.push('<p class="muted">Start by picking a topic, genre, audience or platform (or type in a search box and press Enter). ' +
        'Every other list is then re-rated against what you picked, and bad or terrible matches are hidden.</p>');
      out.push('<p class="muted">Hover an option to see why it got its rating.</p>');
      out.push('</div>');
      $summary.innerHTML = out.join('');
      return;
    }
    out.push('<dl class="picked-list">');
    for (const f of FIELDS) {
      const v = f.multi ? sel[f.key].join(', ') : sel[f.key] && display(sel[f.key]);
      if (v) out.push('<dt>' + esc(f.title) + '</dt><dd>' + esc(v) + '</dd>');
    }
    out.push('</dl>');

    const ls = links(sel);
    if (ls.length) {
      const tg = ls.filter(l => l.kind === 'Topic / genre');
      const worst = Math.min(...ls.map(l => l.r));
      let verdict;
      if (tg.length && tg.every(l => l.r === 3) && worst >= 1) {
        verdict = { cls: 'r-great', text: 'Great combo! The topic and genre are a perfect fit.' };
      } else if (worst <= -2) {
        verdict = { cls: 'r-terrible', text: 'Warning: this has a ' + rating(worst).label.toLowerCase() + ' match and will hurt your score.' };
      } else if (tg.length && tg.some(l => l.r < 3)) {
        verdict = { cls: 'r-okay', text: 'Workable, but not a Great combo. Every topic / genre pair needs +++.' };
      } else {
        verdict = { cls: 'r-great', text: 'No conflicts so far.' };
      }
      out.push('<div class="verdict ' + verdict.cls + '">' + esc(verdict.text) + '</div>');
      out.push('<h3>Matches</h3><ul class="links">');
      for (const l of ls) {
        const rt = rating(l.r);
        out.push('<li><span class="rating ' + rt.cls + '">' + rt.sym + '</span>' + esc(display(l.a)) + ' + ' + esc(display(l.b)) +
          '<span class="kind">' + esc(l.kind) + '</span></li>');
      }
      out.push('</ul>');
    }
    if (sel.platforms.includes(CUSTOM)) {
      out.push('<p class="muted">Custom Console: its genre and audience ratings come from the games you have released, so they are not checked here.</p>');
    }
    out.push('</div>');

    const fk = focusKey();
    if (fk && fk.data) {
      out.push(renderPlan(fk));
      out.push(renderFeatures(fk));
    }
    $summary.innerHTML = out.join('');
  }

  function money(n) {
    return n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
  }

  const AREA_VERDICTS = {
    worth: { cls: 'r-great', label: 'Worth adding', why: 'Important for this genre. You will give it 40%+ of the stage, so its features get fully used.' },
    optional: { cls: 'r-neutral', label: 'Optional', why: 'Not very important. Features only pay off if you give this slider a lot of time anyway.' },
    skip: { cls: 'r-terrible', label: 'Skip', why: 'Unimportant for this genre. You should keep it at 20% or less, so most feature benefit here is wasted money.' },
  };

  function renderFeatures(fk) {
    const td = fk.data.td;
    const lean = td > 1.05 ? 'tech' : td < 0.95 ? 'design' : null;
    const greatCombo = links(sel).filter(l => l.kind === 'Topic / genre').every(l => l.r === 3) && sel.topic;
    const areas = D.focus.slice().sort((a, b) => fk.data.f[b] - fk.data.f[a] || D.focus.indexOf(a) - D.focus.indexOf(b));
    const out = [];
    out.push('<div class="card features">');
    out.push('<h2>Engine features · ' + esc(fk.name) + '</h2>');
    out.push('<p class="muted">No feature is tied to a genre. A feature adds points to its slider area, but only as much as the time you give that area can absorb ' +
      '(a <b>%</b> on the area in-game means the extra features are wasted). So add features where your genre needs time anyway.</p>');
    if (lean) {
      const helpers = D.focus.filter(a => (lean === 'tech' ? 100 - D.devRatio.Design[a] : D.devRatio.Design[a]) >= 60);
      out.push('<p class="muted">Your target ratio is <b>' + td + '</b> (' + lean + '-leaning). Features in ' + esc(helpers.join(', ')) +
        ' produce mostly ' + lean + ' points, so they also help you hit it. These are marked <span class="lever">helps T/D</span>.</p>');
    }
    for (const area of areas) {
      const r = fk.data.f[area];
      const v = r >= 2 ? AREA_VERDICTS.worth : r <= -2 ? AREA_VERDICTS.skip : AREA_VERDICTS.optional;
      const design = D.devRatio.Design[area];
      const helps = lean && (lean === 'tech' ? 100 - design : design) >= 60;
      const feats = D.features.filter(f => f.area === area);
      out.push('<details class="f-area ' + v.cls + '"' + (r <= -2 ? '' : ' open') + '>');
      out.push('<summary><span class="rating ' + rating(r).cls + '">' + rating(r).sym + '</span><span class="f-area-name">' + esc(area) + '</span>' +
        (helps ? '<span class="lever">helps T/D</span>' : '') + '<span class="f-verdict">' + v.label + '</span></summary>');
      out.push('<p class="f-why">' + esc(v.why) + ' ' + design + '% design / ' + (100 - design) + '% tech.</p>');
      if (area === 'Graphics') {
        out.push('<p class="f-why">Use only your newest graphics feature: tech level is averaged over every graphics feature in the engine. ' +
          'Large games need 2D V4 / 3D V3 or better, AAA needs 3D V5 or better.</p>');
      }
      out.push('<ul class="f-list">');
      for (const f of feats) {
        const title = [
          f.rp ? 'Research: ' + f.rp + ' RP' : '',
          f.engineCost ? 'Add to engine: ' + money(f.engineCost) : '',
          f.devCost ? 'Per game: ' + f.devCost : '',
          f.after ? 'Unlocks after: ' + f.after : '',
        ].filter(Boolean).join('\n');
        let note = f.group && f.group !== 'Graphics' ? 'pick one: ' + f.group : '';
        if (f.name === 'MMO Support') note = greatCombo ? 'your combo is +++, OK for MMO' : 'MMO needs a +++ topic/genre combo';
        if (f.name === 'Cooperative Play') note = 'poor value vs Skill trees + Character progression';
        out.push('<li title="' + esc(title) + '"><span class="f-name">' + esc(f.name) + '</span>' +
          (note ? '<span class="f-note">' + esc(note) + '</span>' : '') +
          '<span class="f-ben">' + (f.benefit ? '+' + f.benefit : 'utility') + '</span>' +
          '<span class="f-cost">' + (f.engineCost ? money(f.engineCost) : '—') + '</span></li>');
      }
      out.push('</ul></details>');
    }
    out.push('<p class="muted f-legend"><b>+N</b> = feature benefit, then the cost to put it in an engine. Hover a feature for research cost, ' +
      'per-game cost and unlock requirements. Source: <a href="' + esc(D.featuresSource) + '" target="_blank" rel="noopener">Custom Game Engine (wiki)</a>.</p>');
    out.push('</div>');
    return out.join('');
  }

  function renderPlan(fk) {
    const td = fk.data.td;
    const lean = td > 1.05 ? 'tech-focused' : td < 0.95 ? 'design-focused' : 'balanced';
    // Position on a log scale so 0.25 … 4 maps to 0 … 100%.
    const pos = Math.max(0, Math.min(100, (Math.log2(td) + 2) / 4 * 100));
    const out = [];
    out.push('<div class="card">');
    out.push('<h2>Development plan · ' + esc(fk.name) + '</h2>');
    out.push('<p class="muted">Target Tech / Design ratio at the end of development (' + lean + ')</p>');
    out.push('<div class="td"><span class="td-num">' + td + '</span><div style="flex:1"><div class="td-bar"><span style="left:' + pos +
      '%"></span></div><div class="td-scale"><span>Design</span><span>Balanced</span><span>Tech</span></div></div></div>');

    for (let s = 0; s < 3; s++) {
      out.push('<div class="stage"><div class="stage-title">Stage ' + (s + 1) + '</div><div class="sliders">');
      for (const slider of D.focus.slice(s * 3, s * 3 + 3)) {
        const r = fk.data.f[slider];
        const rt = rating(r);
        const design = D.devRatio.Design[slider];
        const spec = D.specialization[slider];
        out.push('<div class="slider-cell ' + rt.cls + '" title="' + esc(FOCUS_LABELS[r] || '') + '">');
        out.push('<div class="name"><span>' + esc(slider) + '</span><span class="rating ' + rt.cls + '">' + rt.sym + '</span></div>');
        if (fk.sliders) out.push('<div class="pct">' + fk.sliders.f[slider] + '%</div>');
        out.push('<div class="dt">' + design + '% design / ' + (100 - design) + '% tech</div>');
        out.push('<div class="dt-bar"><span class="d" style="width:' + design + '%"></span><span class="t" style="width:' + (100 - design) + '%"></span></div>');
        out.push('<div class="dt" title="Specialist requirement for this slider (Design / Tech)">Best staff: ' + spec.design + ' D / ' + spec.tech + ' T</div>');
        out.push('</div>');
      }
      out.push('</div></div>');
    }
    out.push('<ul class="rules">');
    if (fk.sliders) out.push('<li>The big numbers are simple slider positions from the wiki\'s "for dummies" table, a rough starting point.</li>');
    out.push('<li><b>+++ / ++</b>: give at least two of these 40%+ of the stage bar, and never 20% or less.</li>');
    out.push('<li><b>~</b>: set to anything.</li>');
    out.push('<li><b>−− / −−−</b>: never give these 40% or more.</li>');
    if (!fk.sliders) out.push('<li>For multi-genre games, the first genre counts twice as much as the second.</li>');
    out.push('<li>Avoid making two games in a row with the same topic and genre.</li>');
    out.push('</ul></div>');
    return out.join('');
  }

  function render() {
    for (const f of FIELDS) renderField(f);
    renderSummary();
  }

  // ---------- state in URL hash ----------

  function saveHash() {
    const p = new URLSearchParams();
    for (const f of FIELDS) {
      const v = f.multi ? sel[f.key].join(',') : sel[f.key];
      if (v) p.set(f.key, v);
    }
    const s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  function loadHash() {
    Object.assign(sel, { topic: null, genre: null, genre2: null, audience: null, platforms: [] });
    const p = new URLSearchParams(location.hash.slice(1));
    for (const f of FIELDS) {
      const v = p.get(f.key);
      if (!v) continue;
      if (f.multi) sel[f.key] = v.split(',').filter(x => f.options.includes(x));
      else if (f.options.includes(v)) sel[f.key] = v;
    }
  }

  // ---------- controls ----------

  document.getElementById('source-link').href = D.source;
  document.getElementById('min-rating').addEventListener('change', e => { ui.minRating = Number(e.target.value); render(); });
  document.getElementById('show-filtered').addEventListener('change', e => { ui.showFiltered = e.target.checked; render(); });
  document.getElementById('sort-rating').addEventListener('change', e => { ui.sortByRating = e.target.checked; render(); });
  document.getElementById('reset').addEventListener('click', () => {
    Object.assign(sel, { topic: null, genre: null, genre2: null, audience: null, platforms: [] });
    ui.showHidden = {};
    saveHash();
    render();
  });
  window.addEventListener('hashchange', () => { loadHash(); render(); });
  document.getElementById('fill-best').addEventListener('click', () => {
    const best = bestCompletion(sel);
    if (!best) return;
    Object.assign(sel, best.c, { platforms: best.c.platforms.slice() });
    saveHash();
    render();
  });

  buildSkeleton();
  loadHash();
  render();
})();
