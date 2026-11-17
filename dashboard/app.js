// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view at #/protocol/<slug>, and the live-token comparables apart.
// No network: every byte it shows is in data.js. No link leaves the page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(3);
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and the multipliers main.ts stored, and checks the number
  // board.json carries, so the page's code and the board's data are visibly
  // the same arithmetic.
  function recompute(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * row.growth_multiplier * row.maturity_multiplier * row.chain_multiplier));
  }
  function matches(row) {
    var again = recompute(row);
    return Math.abs(again - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash || '';
    var m = hash.match(/^#\/protocol\/([A-Za-z0-9._-]+)$/);
    state.selected = m ? m[1] : null;
  }
  function goDetail(slug) {
    window.location.hash = '#/protocol/' + slug;
  }
  function goBoard() {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    state.selected = null;
    render();
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar' }),
        el('span', { class: 'brand-tag', text: 'pre-token protocols, ranked by implied value' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, by TVL. Implied value is a model, not a promise: it is what a token would be worth if the protocol kept its record as it is.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token comparables' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var count = state.tab === 'pre-token' ? visibleRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: count })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function chainLabel(r) {
    return (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; render(); } })
      ));
    }
    var max = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { goDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { style: 'cursor:default' },
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their market-cap-per-TVL ratios are the comparables the pre-token multiples are calibrated from. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var calibRows = DATA.calibration.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comparables) }),
        el('td', { class: 'num', text: fmtMult(c.median_multiple) }),
        el('td', { class: 'num', text: fmtMult(c.multiple_used) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple(category) x growth x maturity x chains )\n' +
        'multiple(category) = median mcap / TVL of the tokenized protocols in the category,\n' +
        '  shrunk toward the overall median ' + fmtMult(DATA.overall_median_multiple) + ' with a prior weight of ' + m.shrink_prior + ', clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']\n' +
        'growth   = clamp(1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ', ' + m.growth_mult_floor + ', ' + m.growth_mult_cap + ')\n' +
        'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x (1 - exp(-age_days / ' + m.maturity_halflife_days + '))   (age unknown: ' + m.unknown_age_days + ' days)\n' +
        'chains   = 1 + min(chains - 1, ' + m.chain_max_steps + ') x ' + m.chain_step
      ),
      el('p', { class: 'sub', text: 'The calibration table below is the evidence: each category\u2019s multiple comes from the tokenized protocols the snapshot itself records in that category. A category with few comparables leans on the whole market; a category with none uses the overall median outright. Age is the time since the protocol was first listed, the best record of how long it has run with no token.' }),
      el('div', { class: 'calib-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Calibration: median market-cap-per-TVL of the snapshot\u2019s tokenized protocols, and the multiple the model uses.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Comparables' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Multiple used' })
          )),
          el('tbody', null, calibRows)
        )
      )
    );
  }

  function detailView(row) {
    var again = recompute(row);
    var ok = matches(row);
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    });
    return el('div', null,
      el('a', { class: 'back', href: '#', text: '< Back to the board', onclick: function (e) { e.preventDefault(); goBoard(); } }),
      el('div', { class: 'panel' },
        el('div', { class: 'detail-head' },
          el('div', null,
            el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
            el('h2', { text: row.name }),
            el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' · no token on record' })
          ),
          el('span', { class: 'status', text: 'no token' })
        ),
        el('section', { class: 'detail-section' },
          el('h3', { text: 'Implied value' }),
          el('div', { class: 'equation' },
            el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
            el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
            el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
            el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.base_multiple) + ' (' + row.comparables + ' comparables)' })),
            el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
            el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
            el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
            el('div', null, el('span', { text: 'Listed since' }), el('b', { class: 'num', text: row.listed_at || 'unknown' })),
            el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
          ),
          el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': TVL x ' + fmtMult(row.base_multiple) + ' x ' + fmtMult(row.growth_multiplier) + ' x ' + fmtMult(row.maturity_multiplier) + ' x ' + fmtMult(row.chain_multiplier) + ' = ' + fmtUsd(again) + (ok ? ', the same number board.json carries.' : ', which differs from the board by rounding: the data would be stale.') + ' This is an estimate, not a price.' })
        ),
        el('section', { class: 'detail-section' },
          el('h3', { text: 'Farm plan' }),
          el('ol', { class: 'steps' }, steps),
          el('p', { class: 'note', text: 'Farm plans name concrete actions, costs and times. Never pay to claim, and never follow a claim link from anywhere but the protocol\u2019s own page.' })
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) {
        shell.appendChild(detailView(row));
      } else {
        shell.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
          el('h2', { text: 'No protocol with that slug' }),
          el('p', { text: 'The link names a protocol this board does not rank.' }),
          el('button', { class: 'button', type: 'button', text: 'Back to the board', onclick: function () { goBoard(); } })
        )));
      }
      shell.appendChild(el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · implied value is a model, not a promise.' }));
    } else {
      shell.appendChild(lede());
      shell.appendChild(controls());
      shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
      if (state.tab === 'pre-token') shell.appendChild(modelPanel());
      shell.appendChild(el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · implied value is a model, not a promise. Live-token protocols are shown apart, with the market\u2019s own values.' }));
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
  }

  // Hook for scripted screenshots: set a filter, then render.
  window.__radarSetFilter = function (category, q, chain) {
    if (category !== undefined) state.category = category;
    if (q !== undefined) state.q = q;
    if (chain !== undefined) state.chain = chain;
    state.tab = 'pre-token';
    render();
  };

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) goBoard();
  });
})();
