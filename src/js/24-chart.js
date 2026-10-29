/* yf.chart: line and bar charts, drawn as SVG at the width they are shown.
   JS:    yf.chart.line(el, spec)   up to four series, each ending in a direct label
          yf.chart.bar(el, spec)    one bar per category
   Each draws an <svg class="yf-chart" role="img"> into el (a block), with the viewBox equal to the
   rendered size in pixels, so the 10px text stays 10px at any width, and redraws when el's
   width changes. It returns { update(spec), destroy() }: update merges the keys it is given
   into the spec and redraws; destroy stops watching and removes the svg. Calling line or bar
   again on an el that has a chart replaces it. Colour is the classes in 20-data.css: a series
   is an ink shade plus a dash, and only a threshold is status colour.
   HTML:  <figure data-yf-chart="line">
            <figcaption>Open findings</figcaption>
            <script type="application/json">{ "labels": ["Mon", "Tue"], "series": [...] }</script>
          </figure>
   yf.chart.init(root?) draws every [data-yf-chart] under root (the page, on load). The svg goes
   where the script is; the rest of the figure is yours.

   spec, line
     labels      ["3 Aug", ...]  one x label per point; they thin out to fit, keeping the last
     series      [{ name, values: [12, 14, ...] }]  up to four, drawn as .yf-series-1 to -4. A
                 value that is not a number leaves a gap. Each line ends in a label,
                 "name value", moved apart from the others so none overlap.
   spec, bar
     bars        [{ label, value, note? }]  one bar each. value null draws the word "none";
                 note is a second line under the label ("n=12").
     values      true  prints every bar's value; a bar past a threshold always gets its number
   spec, both (all optional)
     thresholds  [{ value, label, below? }]  a dashed line with its label. A bar above it turns
                 danger, or below it with below: true. Label and number tell it apart, as colour
                 alone must not.
     title       what the chart shows ("open findings by severity"). Not drawn: it starts the
                 aria-label, which also reads the data and the thresholds. Put a visible
                 caption in a <figcaption>.
     label       the whole aria-label, if you would rather write it
     legend      true draws a .yf-legend under the chart: each series with its shade and dash,
                 then each threshold, named by its label. A bar chart's lists its thresholds.
     min, max    the value range. Default: 0 up to the next round number past the data and the
                 thresholds. The ticks are 1, 2 or 5 times a power of ten.
     decimals    decimals in value labels and end labels (default: as many as needed, up to 2)
     height      px. Default: line 250 (210 under 520px wide), bar 220
     margin      { top, right, bottom, left } px, any of them. Defaults make room for the tick
                 labels, the end labels and one or two rows of x labels.
     empty       text for a chart with nothing to draw (default "No data")
     none        text for a bar with no value (default "none")
   createElementNS, setAttribute and textContent only: no innerHTML, no inline style, no eval.
   API: yf.chart.line(el, spec), yf.chart.bar(el, spec), yf.chart.init(root?). */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});
  const NS = 'http://www.w3.org/2000/svg';
  const CH = 6; // one character of the chart's 10px mono text, in px
  const LH = 12; // one line of text: labels closer than this overlap
  const MIN_W = 160; // narrower than this the chart is drawn at 160 and scaled down
  const MAX_SERIES = 4;
  const WIDTHS = [2.25, 1.75, 1.75, 1.75]; // the first series is the heaviest
  const charts = new WeakMap(); // element -> its chart

  /* ---------- small helpers ---------- */

  function svg(name, attrs, text) {
    const node = document.createElementNS(NS, name);
    for (const key in attrs) if (attrs[key] != null) node.setAttribute(key, attrs[key]);
    if (text != null) node.textContent = text;
    return node;
  }

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v, fallback) => (finite(v) ? v : fallback);
  const r = (n) => Math.round(n * 10) / 10;

  // the room inside el, which is the width the svg gets
  function widthOf(el) {
    const style = getComputedStyle(el);
    return Math.floor(el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
  }
  const list = (items) => (items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);

  function format(v, decimals) {
    return decimals == null ? String(Math.round(v * 100) / 100) : v.toFixed(decimals);
  }

  // y ticks at 1, 2 or 5 times a power of ten, at most one per 34px. The range is the page's
  // min and max, else zero (or the lowest value, if lower) up to the first tick past the highest.
  function axis(spec, values, ph) {
    const fixLo = finite(spec.min);
    const fixHi = finite(spec.max);
    let lo = fixLo ? spec.min : Math.min(0, ...values);
    let hi = fixHi ? spec.max : Math.max(...values);
    if (!(hi > lo)) hi = lo + 1;
    const most = Math.max(2, Math.floor(ph / 34));
    let step = 0;
    for (let i = 0, p = Math.pow(10, Math.floor(Math.log10((hi - lo) / most))); !step && i < 40; i++, p *= 10) {
      for (const m of [1, 2, 5]) {
        if (hi - lo <= m * p * most * (1 + 1e-9)) {
          step = m * p;
          break;
        }
      }
    }
    step = step || (hi - lo) / most;
    const places = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const tidy = (v) => Number(v.toFixed(places));
    if (!fixLo) lo = tidy(Math.floor(lo / step + 1e-9) * step);
    if (!fixHi) hi = tidy(Math.ceil(hi / step - 1e-9) * step);
    const ticks = [];
    for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) ticks.push(tidy(k * step));
    return { lo, hi, ticks, text: ticks.map((t) => t.toFixed(places)) };
  }

  // y positions, sorted top to bottom, pushed apart by a line of text and kept inside [lo, hi]
  function spread(ys, lo, hi) {
    const down = (from) => {
      for (let i = Math.max(from, 1); i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + LH);
    };
    down(1);
    const over = ys.length ? ys[ys.length - 1] - hi : 0;
    if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] -= over;
    if (ys.length && ys[0] < lo) {
      ys[0] = lo;
      down(1);
    }
    return ys;
  }

  // a label centred on x, pulled in when it would run off the chart
  function centred(x, y, str, W, cls) {
    const half = (str.length * CH) / 2;
    const left = x - half < 0;
    const right = !left && x + half > W;
    return svg('text', { class: cls, x: r(left ? 0 : right ? W : x), y: r(y), 'text-anchor': left ? 'start' : right ? 'end' : 'middle' }, str);
  }

  // a threshold's label: above its line at the left, else at the right, else below.
  // clear(x0, x1, y0, y1) says whether that box is free of the data.
  function limitLabel(str, ly, left, right, clear) {
    const w = str.length * CH;
    const spots = [
      [left + 4, 'start', -4],
      [right - 4, 'end', -4],
      [left + 4, 'start', 12],
      [right - 4, 'end', 12],
    ];
    let at = spots[0];
    for (const s of spots) {
      const x0 = s[1] === 'start' ? s[0] : s[0] - w;
      if (clear(x0, x0 + w, ly + s[2] - 9, ly + s[2] + 3)) {
        at = s;
        break;
      }
    }
    return svg('text', { class: 'yf-chart-threshold', x: r(at[0]), y: r(ly + at[2]), 'text-anchor': at[1] }, str);
  }

  /* ---------- reading the spec ---------- */

  function decimalsOf(spec) {
    return Number.isInteger(spec.decimals) && spec.decimals >= 0 && spec.decimals <= 10 ? spec.decimals : null;
  }

  function limitsOf(spec, decimals) {
    return (Array.isArray(spec.thresholds) ? spec.thresholds : [])
      .filter((t) => t && finite(t.value))
      .map((t) => ({ value: t.value, label: t.label == null ? format(t.value, decimals) : String(t.label), below: !!t.below }));
  }

  const crosses = (t, v) => (t.below ? v < t.value : v > t.value);

  function heightOf(kind, spec, W) {
    return spec.height > 0 && finite(spec.height) ? spec.height : kind === 'bar' ? 220 : W < 520 ? 210 : 250;
  }

  function marginOf(spec, key, fallback) {
    return num(spec.margin && spec.margin[key], fallback);
  }

  // the left margin holds the tick labels
  const leftOf = (spec, ax) => marginOf(spec, 'left', Math.max(...ax.text.map((t) => t.length)) * CH + 14);

  // the aria-label: the page's own, else the kind, the title, then the data
  function describe(kind, spec, sentences) {
    if (typeof spec.label === 'string' && spec.label) return spec.label;
    const head = (kind === 'bar' ? 'Bar chart' : 'Line chart') + (spec.title ? ': ' + spec.title : '') + '.';
    return [head].concat(sentences).filter(Boolean).join(' ');
  }

  function limitsSentence(th) {
    return th.length ? (th.length > 1 ? 'Thresholds: ' : 'Threshold: ') + th.map((t) => t.label).join(', ') + '.' : '';
  }

  function root(W, H, label) {
    return svg('svg', { class: 'yf-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label, focusable: 'false' });
  }

  // nothing to draw: two quiet rules and a word
  function blank(kind, spec, W) {
    const H = heightOf(kind, spec, W);
    const top = marginOf(spec, 'top', 12);
    const bottom = H - marginOf(spec, 'bottom', 26);
    const out = root(W, H, describe(kind, spec, ['There is no data.']));
    [top, bottom].forEach((y) => out.appendChild(svg('line', { class: 'yf-chart-grid', x1: 0, x2: W, y1: r(y), y2: r(y) })));
    out.appendChild(svg('text', { x: r(W / 2), y: r((top + bottom) / 2 + 3.5), 'text-anchor': 'middle' }, typeof spec.empty === 'string' ? spec.empty : 'No data'));
    return out;
  }

  // grid lines and tick labels. Returns the y scale.
  function frame(out, ax, M, W, ph) {
    const y = (v) => M.t + ph - ((v - ax.lo) / (ax.hi - ax.lo)) * ph;
    ax.ticks.forEach((t, i) => {
      out.appendChild(svg('line', { class: 'yf-chart-grid', x1: r(M.l), x2: r(W - M.r), y1: r(y(t)), y2: r(y(t)) }));
      out.appendChild(svg('text', { x: 0, y: r(y(t) + 3.5) }, ax.text[i]));
    });
    return y;
  }

  // each threshold: its dashed line, and its label where it hides nothing
  function limits(out, th, y, M, W, clear) {
    th.forEach((t) => {
      const ly = y(t.value);
      out.appendChild(svg('line', { class: 'yf-chart-threshold', x1: r(M.l), x2: r(W - M.r), y1: r(ly), y2: r(ly) }));
      out.appendChild(limitLabel(t.label, ly, M.l, W - M.r, clear));
    });
  }

  /* ---------- line ---------- */

  function drawLine(spec, W) {
    const dec = decimalsOf(spec);
    const labels = Array.isArray(spec.labels) ? spec.labels.map((l) => (l == null ? '' : String(l))) : [];
    const series = (Array.isArray(spec.series) ? spec.series : []).slice(0, MAX_SERIES).map((s) => ({
      name: s && s.name != null ? String(s.name) : '',
      values: s && Array.isArray(s.values) ? s.values.map((v) => (finite(v) ? v : null)) : [],
    }));
    series.forEach((s) => {
      s.known = s.values.filter((v) => v != null);
      s.first = s.known[0];
      s.last = s.known[s.known.length - 1];
    });
    const th = limitsOf(spec, dec);
    const n = Math.max(0, ...series.map((s) => s.values.length));
    if (!n || !series.some((s) => s.known.length)) return blank('line', spec, W);

    const H = heightOf('line', spec, W);
    const M = { t: marginOf(spec, 'top', 12), b: marginOf(spec, 'bottom', labels.length ? 26 : 8) };
    const ph = Math.max(20, H - M.t - M.b);
    const ax = axis(spec, [].concat(...series.map((s) => s.known), th.map((t) => t.value)), ph);
    const ends = series.map((s) => (s.known.length ? s.name + ' ' + format(s.last, dec) : ''));
    M.l = leftOf(spec, ax);
    M.r = marginOf(spec, 'right', Math.min(9 + Math.max(...ends.map((e) => e.length)) * CH + 2, W * 0.4));
    const pw = Math.max(1, W - M.l - M.r);
    const x = (i) => (n > 1 ? M.l + (i * pw) / (n - 1) : M.l + pw / 2);

    const sentences = [];
    if (n > 1 && labels[0] && labels[n - 1]) sentences.push('From ' + labels[0] + ' to ' + labels[n - 1] + '.');
    series.forEach((s) => {
      if (!s.known.length) sentences.push(s.name + ' has no data.');
      else if (s.first === s.last) sentences.push(s.name + ' is ' + format(s.last, dec) + '.');
      else sentences.push(s.name + ' goes from ' + format(s.first, dec) + ' to ' + format(s.last, dec) + '.');
    });
    sentences.push(limitsSentence(th));
    const out = root(W, H, describe('line', spec, sentences));
    const y = frame(out, ax, M, W, ph);

    // x labels: every step-th point counting back from the last, so the newest is always named
    const widest = Math.max(0, ...labels.slice(0, n).map((l) => l.length)) * CH;
    const step = Math.max(1, Math.ceil((widest + 14) / (n > 1 ? pw / (n - 1) : pw)));
    for (let i = 0; i < n; i++) {
      if (labels[i] && (n - 1 - i) % step === 0) out.appendChild(centred(x(i), M.t + ph + 18, labels[i], W));
    }

    // each line as runs of points (a gap ends a run) and as segments, which a threshold label
    // keeps clear of
    const runs = series.map((s) => {
      const found = [[]];
      s.values.forEach((v, i) => (v == null ? found.push([]) : found[found.length - 1].push([x(i), y(v)])));
      return found.filter((run) => run.length);
    });
    const segs = [];
    runs.forEach((rs) => rs.forEach((run) => run.slice(1).forEach((p, i) => segs.push([run[i][0], run[i][1], p[0], p[1]]))));
    limits(out, th, y, M, W, (x0, x1, y0, y1) =>
      segs.every((g) => {
        if (g[2] < x0 || g[0] > x1) return true;
        const at = (px) => g[1] + ((g[3] - g[1]) * (px - g[0])) / (g[2] - g[0]);
        const a = at(Math.max(g[0], x0));
        const b = at(Math.min(g[2], x1));
        return Math.max(a, b) < y0 - 2 || Math.min(a, b) > y1 + 2;
      })
    );

    for (let k = series.length - 1; k >= 0; k--) {
      runs[k].forEach((run) => {
        const pts = run.map((p) => r(p[0]) + ',' + r(p[1])).join(' ');
        if (run.length > 1) out.appendChild(svg('polyline', { class: 'yf-series-' + (k + 1), 'stroke-width': WIDTHS[k], 'stroke-linejoin': 'round', points: pts }));
        else out.appendChild(svg('circle', { class: 'yf-series-' + (k + 1), cx: r(run[0][0]), cy: r(run[0][1]), r: 2 }));
      });
    }

    // direct labels at the line ends, top to bottom, moved apart so none sits on another
    const placed = series
      .map((s, k) => ({ k, y: y(s.last), text: ends[k], at: s.values.lastIndexOf(s.last), known: s.known.length }))
      .filter((e) => e.known)
      .sort((a, b) => a.y - b.y);
    const ys = spread(placed.map((e) => e.y), LH / 2, M.t + ph);
    placed.forEach((e, i) => {
      out.appendChild(svg('circle', { class: 'yf-series-' + (e.k + 1), cx: r(x(e.at)), cy: r(e.y), r: 3 }));
      out.appendChild(svg('text', { class: 'yf-chart-label', x: r(W - M.r + 9), y: r(ys[i] + 3.5) }, e.text));
    });
    return out;
  }

  /* ---------- bar ---------- */

  function drawBar(spec, W) {
    const dec = decimalsOf(spec);
    const none = typeof spec.none === 'string' ? spec.none : 'none';
    const bars = (Array.isArray(spec.bars) ? spec.bars : []).map((b) => ({
      label: b && b.label != null ? String(b.label) : '',
      note: b && b.note != null ? String(b.note) : '',
      value: b && finite(b.value) ? b.value : null,
    }));
    const th = limitsOf(spec, dec);
    const known = bars.filter((b) => b.value != null).map((b) => b.value);
    if (!known.length) return blank('bar', spec, W);

    const H = heightOf('bar', spec, W);
    const noted = bars.some((b) => b.note);
    const M = { t: marginOf(spec, 'top', 20), r: marginOf(spec, 'right', 4), b: marginOf(spec, 'bottom', noted ? 40 : 26) };
    const ph = Math.max(20, H - M.t - M.b);
    const ax = axis(spec, known.concat(th.map((t) => t.value)), ph);
    M.l = leftOf(spec, ax);
    const pw = Math.max(1, W - M.l - M.r);
    const slot = pw / bars.length;
    const bw = Math.min(30, slot * 0.55);

    // the aria-label: each bar, then which are past each threshold
    const sentences = [bars.map((b) => b.label + ' ' + (b.value == null ? none : format(b.value, dec))).join(', ') + '.'];
    th.forEach((t) => {
      const past = bars.filter((b) => b.value != null && crosses(t, b.value)).map((b) => b.label);
      const word = t.below ? 'under ' : 'over ';
      sentences.push(past.length ? list(past) + (past.length === 1 ? ' is ' : ' are ') + word + t.label + '.' : 'None is ' + word + t.label + '.');
    });
    const out = root(W, H, describe('bar', spec, sentences));
    const y = frame(out, ax, M, W, ph);

    const zero = y(Math.max(ax.lo, Math.min(0, ax.hi)));
    const boxes = []; // the bars and their value labels: what a threshold label keeps clear of
    const widest = Math.max(...bars.map((b) => Math.max(b.label.length, b.note.length))) * CH;
    const every = Math.max(1, Math.ceil((widest + 6) / slot));
    bars.forEach((b, i) => {
      const cx = M.l + slot * i + slot / 2;
      if (i % every === 0) {
        if (b.label) out.appendChild(centred(cx, M.t + ph + 18, b.label, W));
        if (b.note) out.appendChild(centred(cx, M.t + ph + 31, b.note, W));
      }
      if (b.value == null) {
        out.appendChild(centred(cx, zero - 4, none, W));
        return;
      }
      const top = y(b.value);
      const over = th.some((t) => crosses(t, b.value));
      const rect = svg('rect', { x: r(cx - bw / 2), y: r(Math.min(top, zero)), width: r(bw), height: r(Math.abs(zero - top)) });
      if (over) rect.setAttribute('fill', 'var(--yf-danger)');
      else rect.setAttribute('class', 'yf-series-1');
      out.appendChild(rect);
      boxes.push([cx - bw / 2, cx + bw / 2, Math.min(top, zero), Math.max(top, zero)]);
      if (spec.values !== true && !over) return;
      // the value goes past the bar's end; a label a limit's line would cross moves past the line
      const text = format(b.value, dec);
      let ty = b.value >= 0 ? top - 4 : top + 12;
      th.forEach((t) => {
        const ly = y(t.value);
        if (ly > ty - 10 && ly < ty + 4) ty = b.value >= 0 ? ly - 4 : ly + 12;
      });
      out.appendChild(centred(cx, ty, text, W, 'yf-chart-label'));
      boxes.push([cx - (text.length * CH) / 2, cx + (text.length * CH) / 2, ty - 9, ty + 3]);
    });
    out.appendChild(svg('line', { class: 'yf-chart-axis', x1: r(M.l), x2: r(W - M.r), y1: r(zero), y2: r(zero) }));

    limits(out, th, y, M, W, (x0, x1, y0, y1) => boxes.every((c) => x1 < c[0] || x0 > c[1] || y1 < c[2] || y0 > c[3]));
    return out;
  }

  /* ---------- legend ---------- */

  // a key per series (its shade and dash) and per threshold, in a .yf-legend list
  function legendOf(kind, spec) {
    const keys = [];
    if (kind === 'line') {
      (Array.isArray(spec.series) ? spec.series : []).slice(0, MAX_SERIES).forEach((s, k) => {
        if (s && s.name != null && s.name !== '') keys.push(['yf-series-' + (k + 1), String(s.name)]);
      });
    }
    limitsOf(spec, decimalsOf(spec)).forEach((t) => keys.push(['yf-chart-threshold', t.label]));
    if (!keys.length) return null;
    const ul = document.createElement('ul');
    ul.className = 'yf-legend';
    keys.forEach(([cls, name]) => {
      const li = document.createElement('li');
      const key = svg('svg', { class: 'yf-legend__key', viewBox: '0 0 24 8', 'aria-hidden': 'true' });
      key.appendChild(svg('line', { class: cls, x1: 0, y1: 4, x2: 24, y2: 4 }));
      li.appendChild(key);
      li.appendChild(document.createTextNode(name));
      ul.appendChild(li);
    });
    return ul;
  }

  /* ---------- the chart on an element ---------- */

  function make(kind, el, spec) {
    if (!(el instanceof Element)) throw new TypeError('yf.chart.' + kind + ': the first argument must be an element');
    const had = charts.get(el);
    if (had) had.destroy();

    let current = Object.assign({}, spec);
    let node = null;
    let key = null; // the legend, when the spec asks for one
    let seen = 0; // the width last drawn at
    let dead = false;

    // the legend does not depend on the width, so it is redrawn only when the spec changes
    function placeLegend() {
      if (key && key.parentNode) key.parentNode.removeChild(key);
      key = current.legend === true ? legendOf(kind, current) : null;
      if (key && node && node.parentNode === el) el.insertBefore(key, node.nextSibling);
    }

    function draw() {
      if (dead) return;
      const w = widthOf(el);
      seen = w;
      if (w < 1) return; // hidden: the observer calls again once it has a size
      const next = (kind === 'bar' ? drawBar : drawLine)(current, Math.max(w, MIN_W));
      if (node && node.parentNode === el) {
        el.replaceChild(next, node);
      } else {
        el.insertBefore(next, el.querySelector(':scope > script[type="application/json"]'));
      }
      const fresh = node === null;
      node = next;
      if (fresh) placeLegend();
    }

    const onSize = () => {
      if (widthOf(el) !== seen) draw();
    };
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(onSize) : null;
    if (watcher) watcher.observe(el);
    else window.addEventListener('resize', onSize);

    const chart = {
      update(next) {
        current = Object.assign({}, current, next);
        draw();
        placeLegend();
      },
      destroy() {
        dead = true;
        if (watcher) watcher.disconnect();
        else window.removeEventListener('resize', onSize);
        if (node && node.parentNode) node.parentNode.removeChild(node);
        if (key && key.parentNode) key.parentNode.removeChild(key);
        node = null;
        key = null;
        if (charts.get(el) === chart) charts.delete(el);
      },
    };
    charts.set(el, chart);
    draw();
    return chart;
  }

  function init(rootEl) {
    (rootEl || document).querySelectorAll('[data-yf-chart]').forEach((el) => {
      const kind = el.getAttribute('data-yf-chart');
      if (charts.has(el) || (kind !== 'line' && kind !== 'bar')) return;
      let spec = {};
      const data = el.querySelector(':scope > script[type="application/json"]');
      if (data) {
        try {
          spec = JSON.parse(data.textContent);
        } catch (e) {
          console.error('yf.chart: the JSON spec in this element could not be read.', el);
          return;
        }
      }
      yf.chart[kind](el, spec && typeof spec === 'object' ? spec : {});
    });
  }

  yf.chart = {
    line: (el, spec) => make('line', el, spec),
    bar: (el, spec) => make('bar', el, spec),
    init,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
