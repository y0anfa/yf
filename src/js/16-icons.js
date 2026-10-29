/* yf.icons: puts the icon sprite in the page, so <use href="#name"> works from any origin.
   Browsers refuse a <use> that points at another origin, so an app on another subdomain
   cannot reference https://ds.yoanfaure.com/vX.Y.Z/icons/yf-icons.svg#name directly. This
   fetches the sprite once (CORS is open on released versions), keeps only its <symbol>s,
   strips anything active from them, and appends them to a hidden .yf-sprite at the start
   of <body>. Any <use> that still points at a yf-icons.svg on another origin is rewritten
   to its #name.
   The sprite is found next to yf.js (icons/yf-icons.svg beside the script); set
   <html data-yf-icons="url"> to use another copy, or data-yf-icons="off" to skip loading
   (a page that inlines the symbols itself, or a Claude artifact, whose CSP blocks the fetch).
   It loads on its own when the page has a .yf-icon; a page that adds icons later calls
   yf.icons.load(). The page's CSP needs the sprite's origin in connect-src.
   API: yf.icons.load(url?) -> Promise<boolean>, yf.icons.url. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});
  const SPRITE = 'yf-icons.svg';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const script = document.currentScript;
  let pending = null;

  function spriteUrl() {
    const set = document.documentElement.getAttribute('data-yf-icons');
    if (set === 'off') return null;
    try {
      if (set) return new URL(set, document.baseURI).href;
      if (script && script.src) return new URL('icons/' + SPRITE, script.src).href;
    } catch (err) {
      return null;
    }
    return null;
  }

  // Only drawing survives: no scripts, no foreign content, no event handlers, and no
  // reference that leaves the sprite.
  function clean(node) {
    for (const child of Array.from(node.children)) {
      const tag = child.localName;
      if (tag === 'script' || tag === 'foreignObject' || tag === 'iframe') {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
          child.removeAttribute(attr.name);
        }
      }
      clean(child);
    }
  }

  function host() {
    let box = document.querySelector('svg.yf-sprite[data-yf-icons]');
    if (box) return box;
    box = document.createElementNS(SVG_NS, 'svg');
    box.setAttribute('class', 'yf-sprite');
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('focusable', 'false');
    box.setAttribute('data-yf-icons', '');
    document.body.prepend(box);
    return box;
  }

  function adopt(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
      return false;
    }
    const box = host();
    let added = 0;
    for (const symbol of Array.from(root.getElementsByTagNameNS(SVG_NS, 'symbol'))) {
      if (!symbol.id || document.getElementById(symbol.id)) continue;
      const copy = document.importNode(symbol, true);
      clean(copy);
      box.appendChild(copy);
      added++;
    }
    return added > 0 || box.childElementCount > 0;
  }

  // <use href="https://other.origin/…/yf-icons.svg#check"> becomes <use href="#check">.
  function relink() {
    for (const use of document.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (href.startsWith('#') || !href.includes(SPRITE + '#')) continue;
      let url;
      try {
        url = new URL(href, document.baseURI);
      } catch (err) {
        continue;
      }
      if (url.origin === location.origin) continue;
      use.setAttribute('href', url.hash);
      use.removeAttribute('xlink:href');
    }
  }

  function load(url) {
    const src = url ? new URL(url, document.baseURI).href : spriteUrl();
    if (!src) return Promise.resolve(false);
    if (pending) return pending;
    pending = fetch(src, { mode: 'cors', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('sprite ' + res.status);
        return res.text();
      })
      .then(function (text) {
        const ok = adopt(text);
        if (ok) relink();
        return ok;
      })
      .catch(function () {
        pending = null;
        return false;
      });
    return pending;
  }

  function init() {
    if (document.querySelector('.yf-icon')) load();
  }

  yf.icons = { load: load, get url() { return spriteUrl(); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
