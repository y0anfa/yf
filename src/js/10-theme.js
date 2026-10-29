/* yf.theme: light, dark or follow the system.
   Sets data-theme on <html> ("system" removes it, and the CSS follows the OS) and keeps
   the choice in localStorage under "yf-theme". The saved theme is applied the moment this
   script runs, so load yf.js in <head> to avoid a flash of the wrong one.
   Markup: <button data-yf-theme-toggle>      flips between light and dark
           <button data-yf-theme-toggle="light|dark|system">  sets that one (gets aria-pressed)
   The switch is a short cross-fade through document.startViewTransition, unless the
   reader prefers reduced motion.
   API: yf.theme.set(mode), yf.theme.get() (the saved choice), yf.theme.resolved()
   ("light" or "dark", as shown), yf.theme.toggle(). Fires "yf:theme" on document with
   detail { theme, resolved }. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  const KEY = 'yf-theme';
  const root = document.documentElement;
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function normalize(mode) {
    return mode === 'light' || mode === 'dark' ? mode : 'system';
  }

  // what the reader saved: "light", "dark", or null when nothing is saved
  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (e) {
      return null;
    }
  }

  // the choice in force: the saved one, else whatever the page itself says
  function read() {
    return saved() || normalize(root.getAttribute('data-theme'));
  }

  function write(mode) {
    try {
      if (mode === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) {
      /* storage blocked: the theme still applies for this page */
    }
  }

  function apply(mode) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  function resolved() {
    const mode = normalize(root.getAttribute('data-theme'));
    if (mode !== 'system') return mode;
    return dark && dark.matches ? 'dark' : 'light';
  }

  function sync() {
    const mode = normalize(root.getAttribute('data-theme'));
    document.querySelectorAll('[data-yf-theme-toggle]').forEach(function (el) {
      const value = el.getAttribute('data-yf-theme-toggle');
      if (value === 'light' || value === 'dark' || value === 'system') {
        el.setAttribute('aria-pressed', String(value === mode));
      }
    });
    document.dispatchEvent(
      new CustomEvent('yf:theme', { detail: { theme: mode, resolved: resolved() } })
    );
  }

  function swap(mode) {
    const update = function () {
      apply(mode);
      sync();
    };
    if (typeof document.startViewTransition !== 'function' || (still && still.matches)) {
      update();
      return;
    }
    let transition;
    try {
      transition = document.startViewTransition({ update: update, types: ['theme'] });
    } catch (e) {
      // older engines only take a callback
      transition = document.startViewTransition(update);
    }
    // a skipped transition (hidden tab, a second switch) rejects these; the theme is set either way
    ['ready', 'finished', 'updateCallbackDone'].forEach(function (name) {
      if (transition && transition[name] && transition[name].catch) {
        transition[name].catch(function () {});
      }
    });
  }

  function set(mode, opts) {
    mode = normalize(mode);
    write(mode);
    if (opts && opts.animate === false) {
      apply(mode);
      sync();
    } else {
      swap(mode);
    }
    return mode;
  }

  function toggle() {
    return set(resolved() === 'dark' ? 'light' : 'dark');
  }

  // apply the saved theme now, before first paint when the script is in <head>. With
  // nothing saved the page's own data-theme (or the system) stands.
  if (saved()) apply(saved());

  yf.theme = { set: set, get: read, resolved: resolved, toggle: toggle };

  document.addEventListener('click', function (event) {
    const el = event.target instanceof Element && event.target.closest('[data-yf-theme-toggle]');
    if (!el) return;
    const value = el.getAttribute('data-yf-theme-toggle');
    if (value === 'light' || value === 'dark' || value === 'system') set(value);
    else toggle();
  });

  // another tab changed it
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY) return;
    apply(saved() || 'system');
    sync();
  });

  function ready() {
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
