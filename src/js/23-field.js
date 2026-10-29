/* yf.field: the ASCII topographic field.
   Ported from yoanfaure.com (assets/js/field.js, Yoan Faure, MIT). The landscape, the
   contour rule, the glyph atlas and the pointer hill are the site's, line for line. What is
   new is mounting: any box, any number of them on a page, not only one fixed backdrop.
   The loop, the pointer and the observers are shared by every field on the page.

   Markup: <div class="yf-topo" data-yf-field aria-hidden="true"></div>, a sized box (22-states.css
   makes it fill its positioned parent). Auto-mounted on DOMContentLoaded; a canvas is made
   inside it if there is none, and a <canvas data-yf-field class="yf-topo"> works too.
   Options (or data attributes): seed / data-yf-seed (a number: the same landscape every time),
   static / data-yf-static (one still frame, no loop), pointer:false / data-yf-pointer="off".
   The cell font and ink colour are read from the host's computed style.
   Behaviour: 20 fps, redrawn by diff, typed arrays only; paused while the page is hidden or
   the box is off screen; rebuilt when the theme changes (data-theme on <html>, or the system's);
   with prefers-reduced-motion one still frame and no pointer; a host that leaves the document
   is destroyed. The pointer raises a gentle hill under it while it is over the box.
   API: yf.field.mount(el, options) -> { destroy() }, yf.field.init(root?), yf.field.destroy(el). */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  const DPR_CAP = 2;
  const SAMPLE = 'M.-|/\\';

  /* ---- the landscape (the site's maths) ---- */

  // integer lattice hash to [0, 1): position based, so a landscape survives a resize
  function hash2(ix, iy, salt) {
    let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // a Gaussian hill added to a height buffer, tapered to zero at `reach` sigmas
  function addHill(buf, w, h, cx, cy, amp, sigma, reach, invAspect) {
    const R = sigma * reach;
    const ry = R / invAspect;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(h - 1, Math.ceil(cy + ry));
    const k = 1 / (2 * sigma * sigma);
    const R2 = R * R;
    const floor = Math.exp(-reach * reach * 0.5);
    const norm = amp / (1 - floor);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * invAspect;
      const dy2 = dy * dy;
      let i = y * w + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy2;
        if (d2 < R2) buf[i] += norm * (Math.exp(-d2 * k) - floor);
      }
    }
  }

  // critically damped smoothing: no jump in value or velocity. State lives in `s`.
  function smoothTo(s, target, omega, dt) {
    const x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = s.v - target;
    const temp = (s.vel + omega * change) * dt;
    s.vel = (s.vel - omega * temp) * e;
    s.v = target + (change + temp) * e;
  }

  // glyph = 1 + shape * 2 + (index contour ? 1 : 0); shapes: - | / \. Alpha is baked in, so a
  // cell is one drawImage and the field stays quieter than body text.
  const GLYPHS = [
    ['', 0],
    ['-', 0.17],
    ['-', 0.32],
    ['|', 0.13],
    ['|', 0.26],
    ['/', 0.15],
    ['/', 0.3],
    ['\\', 0.15],
    ['\\', 0.3],
  ];

  const TOPO = {
    fps: 20,
    cell: 1.1, // cell height, multiples of the font size
    baseDt: 0.1, // the landscape is recomputed at 10 Hz
    relief: 4.3, // contour intervals per unit of noise: how dense the map is
    octaves: [
      // size: lattice spacing in css px; amp: weight; spin: gradient rotation, rad/s
      { size: 640, amp: 1, spin: 0.028, salt: 1 },
      { size: 290, amp: 0.4, spin: 0.036, salt: 2 },
      { size: 140, amp: 0.13, spin: 0.045, salt: 3 },
    ],
    every: 5, // index contour period
    band: 0.5, // half-width of a line, in cells along its major axis
    steep: 0.3,
    shallow: 0.3,
    hill: { levels: 2.4, sigma: 6.4, reach: 2.6, rise: 4.6, fall: 1.6, follow: 7 },
    staticT: 41, // the landscape at rest, for reduced motion
  };
  const FRAME = 1000 / TOPO.fps;

  /* Height field: three octaves of 2D gradient noise whose lattice gradients slowly rotate.
     Heights are in contour intervals, so a contour sits at every integer and every fifth is an
     index contour. For each cell the height and gradient give the distance to the nearest
     level; the level crosses the cell when that is under half the gradient's major axis (the
     digital-line rule of marching squares), which gives thin, unbroken, 8-connected lines.
     The glyph comes from the gradient direction. */
  function createTopo(seed) {
    const sd = seed === undefined ? (Math.random() * 1024) | 0 : seed | 0;
    const oct = TOPO.octaves.map((o) => ({
      size: o.size,
      amp: o.amp * TOPO.relief,
      spin: o.spin,
      salt: o.salt + sd * 16,
      nw: 0,
      nh: 0,
      ph: null, // lattice node: gradient phase and spin
      sp: null,
      gx: null, // lattice node: current gradient
      gy: null,
      cix: null, // per column: lattice cell, fraction, fade
      cfx: null,
      cu: null,
      riy: null, // per row
      rfy: null,
      rv: null,
    }));
    let w = 0;
    let h = 0;
    let base = null; // landscape, in contour intervals
    let hh = null; // landscape plus the pointer hill
    let coarse = null; // the landscape on every second cell
    let cw2 = 0;
    let ch2 = 0;
    let inv = 2.08; // cell height / cell width
    let t = 0;
    let acc = 0;
    let dirty = true;
    let hillWas = false;
    let started = false;

    // the pointer hill
    const amp = { v: 0, vel: 0 };
    const hx = { v: 0, vel: 0 };
    const hy = { v: 0, vel: 0 };
    let want = false;
    let px = 0;
    let py = 0;

    const fade = (f) => f * f * f * (f * (f * 6 - 15) + 10);

    // The landscape is smooth, so it is evaluated on a lattice of every second cell and
    // interpolated: a quarter of the noise work for the same lines.
    function layoutOctave(o, cols, rows, cellW, cellH, ox, oy) {
      const cw = (cols >> 1) + 2;
      const ch = (rows >> 1) + 2;
      const nw = Math.floor((ox + 2 * cw * cellW) / o.size) + 2;
      const nh = Math.floor((oy + 2 * ch * cellH) / o.size) + 2;
      if (nw !== o.nw || nh !== o.nh) {
        o.nw = nw;
        o.nh = nh;
        o.ph = new Float32Array(nw * nh);
        o.sp = new Float32Array(nw * nh);
        o.gx = new Float32Array(nw * nh);
        o.gy = new Float32Array(nw * nh);
        for (let j = 0; j < nh; j++) {
          for (let i = 0; i < nw; i++) {
            o.ph[j * nw + i] = hash2(i, j, o.salt * 2) * 6.283185307;
            const s = hash2(i, j, o.salt * 2 + 1);
            o.sp[j * nw + i] = (s < 0.5 ? -1 : 1) * o.spin * (0.45 + 0.55 * Math.abs(s * 2 - 1));
          }
        }
      }
      if (!o.cix || o.cix.length !== cw) {
        o.cix = new Int32Array(cw);
        o.cfx = new Float32Array(cw);
        o.cu = new Float32Array(cw);
      }
      if (!o.riy || o.riy.length !== ch) {
        o.riy = new Int32Array(ch);
        o.rfy = new Float32Array(ch);
        o.rv = new Float32Array(ch);
      }
      for (let c = 0; c < cw; c++) {
        const p = (ox + (2 * c + 0.5) * cellW) / o.size;
        const i = Math.floor(p);
        o.cix[c] = i;
        o.cfx[c] = p - i;
        o.cu[c] = fade(p - i);
      }
      for (let r = 0; r < ch; r++) {
        const p = (oy + (2 * r + 0.5) * cellH) / o.size;
        const j = Math.floor(p);
        o.riy[r] = j;
        o.rfy[r] = p - j;
        o.rv[r] = fade(p - j);
      }
      if (!coarse || coarse.length !== cw * ch) coarse = new Float32Array(cw * ch);
      cw2 = cw;
      ch2 = ch;
    }

    function fillBase() {
      const cw = cw2;
      const ch = ch2;
      for (let n = 0; n < oct.length; n++) {
        const o = oct[n];
        const gx = o.gx;
        const gy = o.gy;
        for (let k = 0; k < gx.length; k++) {
          const a = o.ph[k] + o.sp[k] * t;
          gx[k] = Math.cos(a);
          gy[k] = Math.sin(a);
        }
        const nw = o.nw;
        const cix = o.cix;
        const cfx = o.cfx;
        const cu = o.cu;
        const gain = o.amp;
        const add = n > 0;
        for (let r = 0; r < ch; r++) {
          const fy = o.rfy[r];
          const fy1 = fy - 1;
          const v = o.rv[r];
          const r0 = o.riy[r] * nw;
          const r1 = r0 + nw;
          let i = r * cw;
          for (let c = 0; c < cw; c++, i++) {
            const a = r0 + cix[c];
            const b = r1 + cix[c];
            const fx = cfx[c];
            const fx1 = fx - 1;
            const n00 = gx[a] * fx + gy[a] * fy;
            const n10 = gx[a + 1] * fx1 + gy[a + 1] * fy;
            const n01 = gx[b] * fx + gy[b] * fy1;
            const n11 = gx[b + 1] * fx1 + gy[b + 1] * fy1;
            const u = cu[c];
            const top = n00 + u * (n10 - n00);
            const val = (top + v * (n01 + u * (n11 - n01) - top)) * gain;
            coarse[i] = add ? coarse[i] + val : val;
          }
        }
      }
      // interpolate up to every cell
      for (let y = 0; y < h; y++) {
        const r0 = (y >> 1) * cw;
        const r1 = r0 + cw;
        const fy = (y & 1) * 0.5;
        let i = y * w;
        for (let x = 0; x < w; x++, i++) {
          const c = r0 + (x >> 1);
          const d = r1 + (x >> 1);
          const fx = (x & 1) * 0.5;
          const top = coarse[c] + fx * (coarse[c + 1] - coarse[c]);
          const bot = coarse[d] + fx * (coarse[d + 1] - coarse[d]);
          base[i] = top + fy * (bot - top);
        }
      }
    }

    return {
      // ox, oy: where the grid starts inside the box, css px. The landscape is pinned to the box, not the grid.
      resize(cols, rows, cellW, cellH, ox, oy) {
        if (cols !== w || rows !== h || !base) {
          w = cols;
          h = rows;
          base = new Float32Array(w * h);
          hh = new Float32Array(w * h);
        }
        inv = cellH / cellW;
        for (let n = 0; n < oct.length; n++) layoutOctave(oct[n], w, h, cellW, cellH, ox || 0, oy || 0);
        dirty = true;
      },

      // the first call picks a start time; `still` pins the landscape and clears the hill
      settle(still) {
        if (!started) {
          started = true;
          t = 40 + Math.random() * 3000;
        }
        if (still) {
          t = TOPO.staticT;
          amp.v = amp.vel = 0;
          want = false;
        }
        dirty = true;
      },

      step(dt) {
        t += dt;
        acc += dt;
        if (acc >= TOPO.baseDt) {
          acc = 0;
          dirty = true;
        }
        const H = TOPO.hill;
        if (want) {
          smoothTo(hx, px, H.follow, dt);
          smoothTo(hy, py, H.follow, dt);
        }
        smoothTo(amp, want ? 1 : 0, want ? H.rise : H.fall, dt);
        if (!want && amp.v < 0.002 && Math.abs(amp.vel) < 0.002) amp.v = amp.vel = 0;
        if (amp.v < 0) amp.v = 0; // the smoothing can overshoot a hair when released mid-rise
      },

      render(out) {
        const hillOn = amp.v > 0.001;
        if (!dirty && !hillOn && !hillWas) return; // nothing moved since last time
        if (dirty) {
          fillBase();
          dirty = false;
        }
        hillWas = hillOn;
        hh.set(base);
        if (hillOn) addHill(hh, w, h, hx.v, hy.v, TOPO.hill.levels * amp.v, TOPO.hill.sigma, TOPO.hill.reach, inv);

        const every = TOPO.every;
        const band = TOPO.band;
        const steep = TOPO.steep;
        const shallow = TOPO.shallow;
        out.fill(0);
        for (let y = 1; y < h - 1; y++) {
          let i = y * w + 1;
          for (let x = 1; x < w - 1; x++, i++) {
            const v = hh[i] + 1000; // biased positive, and 1000 is a multiple of every
            const k = (v + 0.5) | 0; // nearest level
            let d = v - k;
            if (d < 0) d = -d;
            let gx = (hh[i + 1] - hh[i - 1]) * 0.5;
            let gy = (hh[i + w] - hh[i - w]) * 0.5;
            const sgn = gx * gy; // > 0: the level climbs towards lower right, so the line runs /
            if (gx < 0) gx = -gx;
            if (gy < 0) gy = -gy;
            const m = gx > gy ? gx : gy;
            if (d > band * m) continue;
            let shape;
            if (gx >= gy) shape = gy < gx * steep ? 1 : sgn > 0 ? 2 : 3; // steep line: | / \
            else shape = gx < gy * shallow ? 0 : sgn > 0 ? 2 : 3; // shallow line: - / \
            out[i] = 1 + shape * 2 + (k % every === 0 ? 1 : 0);
          }
        }
      },

      // every frame while a pointer is over the box; cx, cy are in cell units
      pointer(cx, cy) {
        px = cx;
        py = cy;
        if (!want) {
          // a fresh arrival: a hill that is not up yet starts under the pointer instead of sliding in
          if (amp.v < 0.04) {
            hx.v = cx;
            hy.v = cy;
            hx.vel = hy.vel = 0;
          }
          want = true;
        }
      },

      pointerLeave() {
        want = false;
      },
    };
  }

  /* ---- shared by every field on the page ---- */

  const html = document.documentElement;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const measure = document.createElement('canvas').getContext('2d');
  const live = new Set(); // mounted fields
  const byEl = new WeakMap();
  const ptr = { x: 0, y: 0, inside: false };
  let reduced = mqReduce.matches;
  let docVisible = document.visibilityState !== 'hidden';
  let raf = 0;
  let last = 0;
  let wired = false;
  let pointerOn = false;
  let ro = null;
  let io = null;
  let mo = null;

  function luminance(color) {
    const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(color);
    return m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 : 0;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME - 1.5) return;
    last += FRAME;
    if (now - last > FRAME) last = now;
    live.forEach((f) => f.tick());
  }

  // one loop for all fields: it runs while the page is visible and any field has something to animate
  function sync() {
    let run = false;
    if (docVisible) live.forEach((f) => (run = run || f.moving()));
    if (run && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function onPointerMove(e) {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.inside = true;
  }
  function onPointerGone() {
    ptr.inside = false;
  }
  function onPointerUp(e) {
    if (e.pointerType !== 'mouse') onPointerGone();
  }
  function onPointerOut(e) {
    if (!e.relatedTarget) onPointerGone(); // left the window
  }

  function syncPointer() {
    const on = live.size > 0 && !reduced;
    if (on === pointerOn) return;
    pointerOn = on;
    ptr.inside = false;
    const m = on ? 'addEventListener' : 'removeEventListener';
    const opts = { passive: true };
    window[m]('pointermove', onPointerMove, opts);
    window[m]('pointerdown', onPointerMove, opts);
    window[m]('pointerup', onPointerUp, opts);
    window[m]('pointercancel', onPointerUp, opts);
    window[m]('blur', onPointerGone, opts);
    document[m]('pointerout', onPointerOut, opts);
    html[m]('pointerleave', onPointerGone, opts);
  }

  const onResize = () => live.forEach((f) => f.layout());
  const onTheme = () => live.forEach((f) => f.theme());
  const onFonts = () => live.forEach((f) => f.fonts());
  function onMotion() {
    reduced = mqReduce.matches;
    syncPointer();
    live.forEach((f) => f.motion());
    sync();
  }
  function onVisibility() {
    docVisible = document.visibilityState !== 'hidden';
    sync();
  }

  // listeners exist only while at least one field does
  function wire(on) {
    if (on === wired) return;
    wired = on;
    const m = on ? 'addEventListener' : 'removeEventListener';
    window[m]('resize', onResize);
    document[m]('visibilitychange', onVisibility);
    mqReduce[m]('change', onMotion);
    mqDark[m]('change', onTheme);
    if (document.fonts && document.fonts[m]) document.fonts[m]('loadingdone', onFonts);
    if (on) {
      mo = new MutationObserver(onTheme);
      mo.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver((list) => list.forEach((e) => byEl.has(e.target) && byEl.get(e.target).layout()));
      }
      if (typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver((list) => {
          list.forEach((e) => byEl.has(e.target) && byEl.get(e.target).show(e.isIntersecting));
          sync();
        });
      }
    } else {
      mo.disconnect();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      mo = ro = io = null;
    }
  }

  /* ---- one field ---- */

  function mount(el, opts) {
    opts = opts || {};
    const prior = byEl.get(el);
    if (prior) prior.destroy();

    let canvas = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
    let made = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      el.appendChild(canvas);
      made = true;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return { destroy() {} };

    const seedAttr = el.getAttribute('data-yf-seed');
    const seed = opts.seed != null ? opts.seed : seedAttr != null && seedAttr !== '' ? +seedAttr : undefined;
    const topo = createTopo(seed);
    const calm = !!opts.static || el.hasAttribute('data-yf-static'); // a still frame, whatever the motion setting
    const follow = opts.pointer !== false && el.getAttribute('data-yf-pointer') !== 'off';
    const still = () => calm || reduced;
    const atlas = document.createElement('canvas');
    const actx = atlas.getContext('2d');

    let dead = false;
    let ready = false;
    let sized = false;
    let visible = true;
    let had = false; // the hill is up
    let styleKey = '';
    let sig = '';
    let dpr = 1;
    let cwD = 0; // cell size in device pixels
    let chD = 0;
    let cellW = 0; // ... and in css pixels
    let cellH = 0;
    let offX = 0; // grid origin inside the canvas, device pixels
    let offY = 0;
    let cols = 0;
    let rows = 0;
    let idx = null; // glyph per cell
    let shown = null; // what is on the canvas now
    let forceFull = true;

    function buildAtlas(family, size, weight, color) {
      const fpx = size * dpr;
      const font = weight + ' ' + fpx + 'px ' + family;
      measure.font = font;
      const m = measure.measureText('M');
      cwD = Math.max(3, Math.round(m.width));
      chD = Math.max(4, Math.round(fpx * TOPO.cell));
      cellW = cwD / dpr;
      cellH = chD / dpr;
      atlas.width = cwD * GLYPHS.length;
      atlas.height = chD;
      actx.font = font;
      actx.textAlign = 'left';
      actx.textBaseline = 'alphabetic';
      actx.fillStyle = color;
      const asc = m.fontBoundingBoxAscent;
      const desc = m.fontBoundingBoxDescent;
      const baseline =
        asc !== undefined && desc !== undefined ? Math.round((chD - (asc + desc)) / 2 + asc) : Math.round(chD * 0.5 + fpx * 0.32);
      const scale = luminance(color) > 0.5 ? 0.88 : 1; // light on dark reads heavier; ease it
      const dx = (cwD - m.width) / 2;
      for (let i = 1; i < GLYPHS.length; i++) {
        actx.globalAlpha = GLYPHS[i][1] * scale;
        actx.fillText(GLYPHS[i][0], i * cwD + dx, baseline);
      }
      forceFull = true;
    }

    function layout() {
      if (!ready || dead) return;
      if (!el.isConnected) {
        destroy();
        return;
      }
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || 14;
      const ratio = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      const key = [cs.fontFamily, size, cs.fontWeight, cs.color, ratio].join('|');
      const now = key + '|' + cw + 'x' + ch;
      if (now === sig && sized) return; // the observer and the window both report a resize
      sig = now;
      if (key !== styleKey) {
        styleKey = key;
        dpr = ratio;
        buildAtlas(cs.fontFamily || 'monospace', size, cs.fontWeight || '400', cs.color);
      }
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      const nc = Math.floor(bw / cwD);
      const nr = Math.floor(bh / chD);
      if (cw < 1 || ch < 1 || nc < 2 || nr < 2) {
        sized = false;
        cols = rows = 0;
        sync();
        return;
      }
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw; // CSS sizes the canvas, so this cannot feed back into the layout
        canvas.height = bh;
        forceFull = true;
      }
      offX = Math.floor((bw - nc * cwD) / 2);
      offY = Math.floor((bh - nr * chD) / 2);
      const fresh = nc !== cols || nr !== rows || !idx;
      cols = nc;
      rows = nr;
      if (fresh) {
        idx = new Uint8Array(cols * rows);
        shown = new Uint8Array(cols * rows);
        forceFull = true;
      }
      topo.resize(cols, rows, cellW, cellH, offX / dpr, offY / dpr);
      if (fresh || still()) topo.settle(still());
      sized = true;
      paint();
      sync();
    }

    function paint() {
      if (!sized) return;
      topo.render(idx);
      draw();
    }

    function draw() {
      const n = cols * rows;
      let changed = 0;
      for (let i = 0; i < n; i++) if (idx[i] !== shown[i]) changed++;
      if (!forceFull && changed === 0) return;
      ctx.imageSmoothingEnabled = false;
      if (forceFull || changed * 3 > n) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let i = 0;
        for (let r = 0; r < rows; r++) {
          const y = offY + r * chD;
          for (let c = 0; c < cols; c++, i++) {
            const k = idx[i];
            if (k !== 0) ctx.drawImage(atlas, k * cwD, 0, cwD, chD, offX + c * cwD, y, cwD, chD);
          }
        }
        shown.set(idx);
        forceFull = false;
        return;
      }
      let i = 0;
      for (let r = 0; r < rows; r++) {
        const y = offY + r * chD;
        for (let c = 0; c < cols; c++, i++) {
          const k = idx[i];
          if (k === shown[i]) continue;
          shown[i] = k;
          const x = offX + c * cwD;
          ctx.clearRect(x, y, cwD, chD);
          if (k !== 0) ctx.drawImage(atlas, k * cwD, 0, cwD, chD, x, y, cwD, chD);
        }
      }
    }

    // the pointer is in viewport coordinates; the box is somewhere in it
    function tickPointer() {
      const r = follow && ptr.inside ? el.getBoundingClientRect() : null;
      if (!r || ptr.x < r.left || ptr.x >= r.right || ptr.y < r.top || ptr.y >= r.bottom) {
        if (had) {
          had = false;
          topo.pointerLeave();
        }
        return;
      }
      const cx = (ptr.x - r.left - offX / dpr) / cellW;
      const cy = (ptr.y - r.top - offY / dpr) / cellH;
      topo.pointer(cx < 0 ? 0 : cx > cols ? cols : cx, cy < 0 ? 0 : cy > rows ? rows : cy);
      had = true;
    }

    const moving = () => ready && sized && visible && !still() && !dead;

    function tick() {
      if (!moving()) return;
      if (!el.isConnected) {
        destroy();
        return;
      }
      tickPointer();
      topo.step(FRAME / 1000);
      paint();
    }

    function theme() {
      layout();
      // pick the colour up again if a CSS transition was still settling
      setTimeout(layout, 350);
    }

    function motion() {
      if (!sized) return;
      if (still()) {
        had = false;
        topo.settle(true);
        forceFull = true;
        paint();
      }
    }

    function fonts() {
      styleKey = '';
      sig = '';
      layout();
    }

    function destroy() {
      if (dead) return;
      dead = true;
      live.delete(api);
      if (byEl.get(el) === api) byEl.delete(el);
      if (ro) ro.unobserve(el);
      if (io) io.unobserve(el);
      if (made) canvas.remove();
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!live.size) wire(false);
      syncPointer();
      sync();
    }

    const api = {
      destroy,
      layout,
      theme,
      fonts,
      motion,
      tick,
      moving,
      show(v) {
        visible = v;
      },
    };
    byEl.set(el, api);
    live.add(api);
    wire(true);
    syncPointer();
    if (ro) ro.observe(el);
    if (io) io.observe(el);

    // draw once the cell font is usable, and never later than 2.5 s; a late font rebuilds the atlas
    const go = () => {
      if (dead || ready) return;
      ready = true;
      layout();
    };
    try {
      const cs = getComputedStyle(el);
      const face = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if (document.fonts && document.fonts.load && !document.fonts.check(face, SAMPLE)) {
        Promise.race([document.fonts.load(face, SAMPLE), new Promise((r) => setTimeout(r, 2500))]).then(go, go);
        return { destroy };
      }
    } catch (err) {
      /* draw with whatever font there is */
    }
    go();
    return { destroy };
  }

  function init(root) {
    (root || document).querySelectorAll('[data-yf-field]').forEach((el) => {
      if (!byEl.has(el)) mount(el);
    });
  }

  function destroy(el) {
    const f = byEl.get(el);
    if (f) f.destroy();
  }

  yf.field = { mount, init, destroy };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
