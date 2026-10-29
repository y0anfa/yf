/* yf.sparkline: a tiny inline chart drawn from data.
   <span class="yf-sparkline" data-yf-sparkline="3,5,4,8"></span>
   Draws an SVG: an ink line with its last point emphasised. Optional
   data-yf-threshold=">7" (the last point turns danger when it is above 7) or "<95" (when it
   is below 95); a bare number means above. The limit is drawn as a dashed line. The host
   gets role="img" and an aria-label that says the values and whether the limit is crossed,
   unless it brings its own label (data-yf-label sets one). Changing either attribute
   redraws. No colour is set here: the classes in 20-data.css do that (CSP-friendly).
   API: yf.sparkline.init(root?), yf.sparkline.draw(host). */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});
  const NS = 'http://www.w3.org/2000/svg';
  const W = 96;
  const H = 24;
  const PAD = 3; // room for the stroke and the dot
  const DATA = 'data-yf-sparkline';
  const LIMIT = 'data-yf-threshold';

  function svg(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function limitOf(host) {
    const m = /^\s*([<>]?)\s*(-?\d*\.?\d+)/.exec(host.getAttribute(LIMIT) || '');
    return m ? { below: m[1] === '<', value: parseFloat(m[2]) } : null;
  }

  function draw(host) {
    const values = (host.getAttribute(DATA) || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    const old = host.querySelector(':scope > svg');
    if (old) host.removeChild(old);
    if (values.length < 2) return;

    const limit = limitOf(host);
    let lo = Math.min.apply(null, values);
    let hi = Math.max.apply(null, values);
    if (limit) {
      lo = Math.min(lo, limit.value);
      hi = Math.max(hi, limit.value);
    }
    if (hi === lo) {
      hi += 1; // a flat series draws across the middle
      lo -= 1;
    }
    const x = (i) => PAD + (i * (W - 2 * PAD)) / (values.length - 1);
    const y = (v) => H - PAD - ((v - lo) * (H - 2 * PAD)) / (hi - lo);
    const r = (n) => Math.round(n * 100) / 100;

    const last = values[values.length - 1];
    const over = !!limit && (limit.below ? last < limit.value : last > limit.value);
    const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });

    if (limit) {
      const ly = r(y(limit.value));
      root.appendChild(svg('line', { class: 'yf-sparkline__limit', x1: 0, x2: W, y1: ly, y2: ly }));
    }
    root.appendChild(
      svg('polyline', { class: 'yf-sparkline__line', points: values.map((v, i) => r(x(i)) + ',' + r(y(v))).join(' ') })
    );
    root.appendChild(
      svg('path', { class: 'yf-sparkline__dot' + (over ? ' is-over' : ''), d: 'M' + r(x(values.length - 1)) + ' ' + r(y(last)) + 'h0' })
    );
    host.appendChild(root);

    if (!host.hasAttribute('aria-hidden')) {
      if (!host.hasAttribute('role')) host.setAttribute('role', 'img');
      // a label the page wrote itself is left alone; one made here is remade on every draw
      if (!host.hasAttribute('aria-label') || host.hasAttribute('data-yf-auto-label')) {
        const given = host.getAttribute('data-yf-label');
        const note = limit ? (over ? '; past the limit of ' : '; within the limit of ') + limit.value : '';
        host.setAttribute('data-yf-auto-label', '');
        host.setAttribute('aria-label', given || 'Trend: ' + values.join(', ') + note);
      }
    }
  }

  const watcher = typeof MutationObserver === 'function' ? new MutationObserver((list) => list.forEach((m) => draw(m.target))) : null;

  function init(root) {
    (root || document).querySelectorAll('[' + DATA + ']').forEach((host) => {
      draw(host);
      if (watcher && !host.hasAttribute('data-yf-watched')) {
        host.setAttribute('data-yf-watched', '');
        watcher.observe(host, { attributes: true, attributeFilter: [DATA, LIMIT, 'data-yf-label'] });
      }
    });
  }

  yf.sparkline = { init, draw };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
