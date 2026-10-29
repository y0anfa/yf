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
/* yf.toast: short messages in a corner.
   yf.toast({ message, status, action, timeout }) -> { el, dismiss() }
     message  text (set with textContent, never as HTML)
     status   "info" | "success" | "warning" | "danger"; leave out for a plain note
     action   { label, onClick }, a link-style button next to the message; clicking it
              runs onClick and dismisses the toast
     timeout  ms before it goes. 0 keeps it until dismissed. Default 5000, and 8000 for a
              danger toast or one with an action. The clock stops while the pointer is over
              the toast or focus is inside it.
   yf.toast("Saved") works too. yf.toast.dismissAll() clears the stack.
   The region is a .yf-toaster with aria-live="polite"; it is created once, when the page
   loads, because a live region has to exist before it is filled. A danger toast is
   role="alert", so it is announced at once. At most five show; the oldest leaves first.
   A modal dialog makes the rest of the page inert, live region included, so while one is
   open toasts go to a region inside it (made when it opens); toasts still showing when it
   closes move back to the page's region (a reader may hear them again). Each region is a
   manual popover, shown again with each toast, which puts it in the top layer above the
   dialog. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  const STATUSES = ['info', 'success', 'warning', 'danger'];
  const MAX = 5;
  const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function topModal() {
    try {
      const open = document.querySelectorAll('dialog:modal');
      return open.length ? open[open.length - 1] : null;
    } catch (e) {
      return null; // no :modal, no inert page either
    }
  }

  function region(scope) {
    const owner = scope || topModal() || document.body;
    let el = owner.querySelector(':scope > .yf-toaster');
    if (!el) {
      el = document.createElement('div');
      el.className = 'yf-toaster';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Notifications');
      el.setAttribute('aria-live', 'polite');
      owner.appendChild(el);
    }
    if (typeof el.showPopover === 'function' && !el.hasAttribute('popover')) {
      el.setAttribute('popover', 'manual');
    }
    return el;
  }

  // to the top of the top layer, over a dialog that opened after the last toast
  function lift(host) {
    if (typeof host.showPopover !== 'function') return;
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  }

  function leave(el) {
    if (el.hasAttribute('data-leaving')) return;
    el.setAttribute('data-leaving', '');
    const remove = function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    if (still && still.matches) {
      remove();
      return;
    }
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 400); // if the animation never runs (hidden tab, no CSS), still go
  }

  function toast(options) {
    const opts = typeof options === 'string' ? { message: options } : options || {};
    const status = STATUSES.indexOf(opts.status) >= 0 ? opts.status : '';
    const host = region();

    const el = document.createElement('div');
    el.className = 'yf-toast' + (status ? ' yf-toast--' + status : '');
    if (status === 'danger') el.setAttribute('role', 'alert');

    if (status) {
      const icon = document.createElement('span');
      icon.className = 'yf-toast__icon';
      icon.setAttribute('aria-hidden', 'true');
      el.appendChild(icon);
    }

    const body = document.createElement('div');
    body.className = 'yf-toast__body';
    const message = document.createElement('p');
    message.className = 'yf-toast__message';
    message.textContent = opts.message == null ? '' : String(opts.message);
    body.appendChild(message);
    el.appendChild(body);

    let action = null;
    if (opts.action && opts.action.label) {
      action = document.createElement('button');
      action.type = 'button';
      action.className = 'yf-link yf-toast__action';
      action.textContent = String(opts.action.label);
      el.appendChild(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'yf-button yf-button--ghost yf-button--close yf-toast__dismiss';
    close.setAttribute('aria-label', 'Dismiss');
    el.appendChild(close);

    let timer = 0;
    let left = 0;
    let started = 0;
    const timeout =
      typeof opts.timeout === 'number' ? opts.timeout : status === 'danger' || action ? 8000 : 5000;

    function dismiss() {
      clearTimeout(timer);
      leave(el);
    }
    function start() {
      if (!(left > 0)) return;
      clearTimeout(timer);
      started = Date.now();
      timer = setTimeout(dismiss, left);
    }
    function pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = 0;
      left = Math.max(left - (Date.now() - started), 1000); // always a second to read on resume
    }

    close.addEventListener('click', dismiss);
    if (action) {
      action.addEventListener('click', function () {
        try {
          if (typeof opts.action.onClick === 'function') opts.action.onClick(api);
        } finally {
          dismiss();
        }
      });
    }
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', function (event) {
      if (!el.contains(event.relatedTarget)) start();
    });

    const api = { el: el, dismiss: dismiss };

    lift(host);
    host.appendChild(el);
    const live = host.querySelectorAll('.yf-toast:not([data-leaving])');
    for (let i = 0; i < live.length - MAX; i++) leave(live[i]);

    left = timeout;
    if (timeout > 0) start();
    return api;
  }

  // toasts still showing in a closed dialog go back to the page (or the dialog under it)
  function vacate(dialog) {
    const inner = dialog.querySelector(':scope > .yf-toaster');
    const staying = inner ? inner.querySelectorAll('.yf-toast:not([data-leaving])') : [];
    if (!staying.length) return;
    const host = region(topModal() || document.body);
    lift(host);
    staying.forEach(function (el) {
      host.appendChild(el);
    });
  }

  // A live region has to exist before it is filled, so the dialog's is made as it opens.
  // Both events, because some browsers fire only one of them for a dialog.
  document.addEventListener(
    'toggle',
    function (event) {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement)) return;
      if (event.newState === 'closed') vacate(dialog);
      else if (dialog === topModal()) region(dialog);
    },
    true
  );

  document.addEventListener(
    'close',
    function (event) {
      if (event.target instanceof HTMLDialogElement) vacate(event.target);
    },
    true
  );

  toast.dismissAll = function () {
    document.querySelectorAll('.yf-toaster .yf-toast').forEach(leave);
  };

  yf.toast = toast;

  function ready() {
    region();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
/* yf.dialog: opens and closes native <dialog class="yf-dialog"> elements.
   Markup: <button data-yf-dialog-open="id">    opens the dialog with that id, as a modal
           <button data-yf-dialog-close>        closes the dialog it is in
           <dialog class="yf-dialog" data-yf-dialog-static>   a click on the backdrop does not close it
   Escape, focus trapping, focus return to the opener and the top layer are the browser's.
   A <form method="dialog"> inside closes it without any script, and in browsers with
   command invokers (command="show-modal" commandfor="id") so does opening. A click on
   the backdrop closes the dialog, unless it has data-yf-dialog-static.
   API: yf.dialog.open(id | element), yf.dialog.close(id | element). The dialog fires
   the native "close" event; its returnValue is the value of the button that closed it. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  function find(ref) {
    const el = typeof ref === 'string' ? document.getElementById(ref) : ref;
    return el && el.tagName === 'DIALOG' ? el : null;
  }

  function open(ref) {
    const dialog = find(ref);
    if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    return dialog;
  }

  function close(ref, value) {
    const dialog = find(ref);
    if (dialog && dialog.open) dialog.close(value);
    return dialog;
  }

  yf.dialog = { open: open, close: close };

  function outside(dialog, event) {
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }

  // The backdrop belongs to the dialog element, so a click there targets the dialog
  // itself. Only count it when the press began outside the box too: selecting text and
  // letting go over the backdrop must not close it.
  let pressed = null;

  document.addEventListener('pointerdown', function (event) {
    const t = event.target;
    pressed =
      t instanceof Element && t.tagName === 'DIALOG' && t.open && outside(t, event) ? t : null;
  });

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const opener = target.closest('[data-yf-dialog-open]');
    if (opener) {
      // a browser with command invokers opens it itself; doing it twice only logs a warning
      const native = opener.hasAttribute('commandfor') && 'commandForElement' in HTMLButtonElement.prototype;
      if (!native) open(opener.getAttribute('data-yf-dialog-open'));
      return;
    }

    const closer = target.closest('[data-yf-dialog-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (dialog) dialog.close(closer.getAttribute('value') || undefined);
      return;
    }

    if (target === pressed && target.classList.contains('yf-dialog') && target.open) {
      pressed = null;
      if (!target.hasAttribute('data-yf-dialog-static')) target.close();
    }
  });
})();
/* yf.tabs: the ARIA tabs pattern on [data-yf-tabs].
   Markup: <div class="yf-tabs" data-yf-tabs>
             <div role="tablist"> <button role="tab" aria-controls="p1" aria-selected="true">…
             <div role="tabpanel" id="p1" aria-labelledby="…"> …
   Keys: Left and Right (Up and Down when the list has aria-orientation="vertical") move
   between tabs and select as they go, Home and End jump to the first and last. Only the
   selected tab is in the tab order; Tab from it goes to the panel. Disabled tabs are
   skipped. The tab named by the URL hash (#id of a tab) is selected when the page loads.
   Filter tabs may all point at one panel (the same aria-controls): it stays shown, and
   the page listens for yf:tabchange to filter what is in it.
   API: yf.tabs.init(root?), yf.tabs.select(tab | root, index?). Fires "yf:tabchange"
   on the root with detail { tab, panel }. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  function tabsOf(root) {
    const list = root.querySelector('[role="tablist"]');
    if (!list) return [];
    return Array.prototype.filter.call(list.querySelectorAll('[role="tab"]'), function (tab) {
      return tab.closest('[data-yf-tabs]') === root;
    });
  }

  function enabled(tab) {
    return !tab.disabled && tab.getAttribute('aria-disabled') !== 'true';
  }

  function panelOf(tab) {
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function apply(tabs, current) {
    const shown = panelOf(current);
    tabs.forEach(function (tab) {
      const on = tab === current;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = panelOf(tab);
      if (panel) panel.hidden = panel !== shown;
    });
  }

  // a list too wide for its box scrolls sideways; keep the selected tab inside it
  function reveal(tab) {
    const list = tab.parentElement;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const box = list.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left < box.left) list.scrollLeft -= box.left - at.left;
    else if (at.right > box.right) list.scrollLeft += at.right - box.right;
  }

  function select(tab, focus) {
    const root = tab.closest('[data-yf-tabs]');
    if (!root) return;
    apply(tabsOf(root), tab);
    reveal(tab);
    if (focus) tab.focus();
    root.dispatchEvent(
      new CustomEvent('yf:tabchange', { detail: { tab: tab, panel: panelOf(tab) } })
    );
  }

  function init(scope) {
    (scope || document).querySelectorAll('[data-yf-tabs]').forEach(function (root) {
      const tabs = tabsOf(root);
      if (!tabs.length) return;
      const hash = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '';
      const current =
        tabs.filter(function (tab) {
          return tab.id && tab.id === hash && enabled(tab);
        })[0] ||
        tabs.filter(function (tab) {
          return tab.getAttribute('aria-selected') === 'true' && enabled(tab);
        })[0] ||
        tabs.filter(enabled)[0];
      if (!current) return;
      apply(tabs, current); // no yf:tabchange: nobody changed anything
      reveal(current);
    });
  }

  yf.tabs = {
    init: init,
    select: function (target, index) {
      if (typeof index === 'number') {
        const tabs = tabsOf(target);
        if (tabs[index] && enabled(tabs[index])) select(tabs[index], false);
      } else {
        select(target, false);
      }
    },
  };

  document.addEventListener('click', function (event) {
    const tab = event.target instanceof Element && event.target.closest('[role="tab"]');
    if (tab && tab.closest('[data-yf-tabs]') && enabled(tab)) select(tab, false);
  });

  document.addEventListener('keydown', function (event) {
    const tab = event.target instanceof Element && event.target.closest('[role="tab"]');
    if (!tab) return;
    const root = tab.closest('[data-yf-tabs]');
    if (!root) return;
    const vertical = tab.parentElement.getAttribute('aria-orientation') === 'vertical';
    const rtl = getComputedStyle(tab).direction === 'rtl';
    const prev = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const tabs = tabsOf(root).filter(enabled);
    const at = tabs.indexOf(tab);
    let to = null;

    if (event.key === next) to = tabs[(at + 1) % tabs.length];
    else if (event.key === prev) to = tabs[(at - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') to = tabs[0];
    else if (event.key === 'End') to = tabs[tabs.length - 1];
    if (!to || event.altKey || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    select(to, true);
  });

  function ready() {
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
/* yf.menu: keyboard and placement for .yf-menu, which is a native popover.
   Markup: <button popovertarget="m" class="yf-button">…</button>
           <div class="yf-menu" id="m" popover> <button class="yf-menu__item">…
   Without this script the popover still opens and closes (popovertarget, light dismiss,
   Escape) and the items are plain buttons. With it the menu becomes a real menu: it gets
   role="menu" and role="menuitem" (a menu role promises arrow keys, so it is only added
   along with them), and
     opening        focuses the first item (the last one for ArrowUp on the trigger)
     ArrowDown/Up   next and previous item, wrapping
     Home/End       first and last
     a letter       jumps to the next item starting with it
     Tab            closes the menu and returns to the trigger
     Enter/Space    activate; the menu closes after an item is chosen,
                    unless it has data-yf-keep-open
     Escape         closes and returns focus to the trigger (the browser's own)
   Placement is CSS anchor positioning. Where that is missing or not anchored to the
   trigger, this script puts the menu under it (above if there is no room), inside the screen.
   API: yf.menu.init(root?). Disabled items ([disabled], aria-disabled="true") are skipped. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  const ITEM = '.yf-menu__item, [role^="menuitem"]';
  const GAP = 4;
  const PAD = 8;
  const triggers = new WeakMap(); // menu -> the element that last opened it
  const typed = { text: '', at: 0 };

  function enabled(el) {
    return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.hidden;
  }

  function itemsOf(menu) {
    return Array.prototype.filter.call(menu.querySelectorAll(ITEM), enabled);
  }

  function menuOf(node) {
    const menu = node instanceof Element ? node.closest('.yf-menu') : null;
    return menu && menu.hasAttribute('popover') ? menu : null;
  }

  function triggerFor(menu) {
    const known = triggers.get(menu);
    if (known && known.isConnected) return known;
    return menu.id ? document.querySelector('[popovertarget="' + menu.id + '"]') : null;
  }

  function init(scope) {
    const root = scope || document;
    root.querySelectorAll('.yf-menu[popover]').forEach(function (menu) {
      if (!menu.hasAttribute('role')) menu.setAttribute('role', 'menu');
      menu.querySelectorAll(ITEM).forEach(function (item) {
        if (!item.hasAttribute('role')) item.setAttribute('role', 'menuitem');
      });
      menu.querySelectorAll('.yf-menu__separator').forEach(function (rule) {
        if (!rule.hasAttribute('role')) rule.setAttribute('role', 'separator');
      });
      if (menu.id) {
        document.querySelectorAll('[popovertarget="' + menu.id + '"]').forEach(function (btn) {
          if (!btn.hasAttribute('aria-haspopup')) btn.setAttribute('aria-haspopup', 'menu');
        });
      }
    });
  }

  yf.menu = { init: init };

  // ---------- placement ----------

  const anchored = !!(window.CSS && CSS.supports && CSS.supports('position-area: block-end'));

  function near(a, b) {
    return Math.abs(a - b) <= 12;
  }

  function place(menu, trigger, measured) {
    const t = trigger.getBoundingClientRect();
    if (measured) {
      const m = menu.getBoundingClientRect();
      const under = near(m.top, t.bottom) || near(m.bottom, t.top);
      const beside = near(m.left, t.left) || near(m.right, t.right);
      if (anchored && under && beside) return; // CSS did it
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      let top = t.bottom + GAP;
      let left = t.left;
      if (top + m.height > vh - PAD) {
        const above = t.top - GAP - m.height;
        top = above >= PAD ? above : Math.max(PAD, vh - PAD - m.height);
      }
      if (left + m.width > vw - PAD) left = Math.max(PAD, t.right - m.width);
      manual(menu, top, left);
    } else {
      // first guess, before the menu has a size
      manual(menu, t.bottom + GAP, t.left);
    }
  }

  // plain top and left; any anchor rule is switched off so the two cannot fight
  function manual(menu, top, left) {
    menu.style.setProperty('position-area', 'none');
    menu.style.setProperty('position-try-fallbacks', 'none');
    menu.style.setProperty('margin', '0');
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }

  function release(menu) {
    const props = ['position-area', 'position-try-fallbacks', 'margin', 'top', 'left', 'transition'];
    props.forEach(function (name) {
      menu.style.removeProperty(name);
    });
  }

  function focusItem(menu, which) {
    const items = itemsOf(menu);
    if (!items.length) {
      menu.tabIndex = -1;
      menu.focus();
      return;
    }
    const item = which === 'last' ? items[items.length - 1] : items[0];
    item.focus();
  }

  document.addEventListener(
    'beforetoggle',
    function (event) {
      const menu = menuOf(event.target);
      if (!menu || event.target !== menu) return;
      if (event.newState === 'open') {
        release(menu); // a previous close pinned it in place, or cut its fade
        const source = event.source instanceof Element ? event.source : null;
        if (source) triggers.set(menu, source);
        const trigger = triggerFor(menu);
        if (trigger && !anchored) place(menu, trigger, false);
      } else {
        const known = triggers.get(menu);
        if (known && !known.isConnected) {
          // the page replaced its trigger (a re-rendered row): the menu has already lost
          // its place, so it goes at once rather than fading out somewhere else
          menu.style.transition = 'none';
          return;
        }
        // Closing drops the menu's anchor (and its invoker), so while it fades out it
        // would fall back into the page flow and paint inline. Pin it where it is.
        const box = menu.getBoundingClientRect();
        manual(menu, box.top, box.left);
      }
    },
    true
  );

  document.addEventListener(
    'toggle',
    function (event) {
      const menu = menuOf(event.target);
      if (!menu || event.target !== menu || event.newState !== 'open') return;
      const trigger = triggerFor(menu);
      if (trigger) place(menu, trigger, true);
      // an arrow key on the trigger has already put focus inside; otherwise start at the top
      if (!menu.contains(document.activeElement)) focusItem(menu, 'first');
    },
    true
  );

  // ---------- keys ----------

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const opener = target.closest('[popovertarget]');
    if (opener) {
      const menu = document.getElementById(opener.getAttribute('popovertarget'));
      if (menu && menu.classList.contains('yf-menu')) triggers.set(menu, opener);
    }

    const menu = menuOf(target);
    const item = menu && target.closest(ITEM);
    if (!item || !menu.contains(item) || !enabled(item)) return;
    if (item.hasAttribute('data-yf-keep-open') || item.getAttribute('aria-haspopup')) return;
    menu.hidePopover();
  });

  document.addEventListener('keydown', function (event) {
    const target = event.target;
    if (!(target instanceof Element) || event.altKey || event.ctrlKey || event.metaKey) return;

    // on the trigger: ArrowDown and ArrowUp open the menu
    const trigger = target.closest('[popovertarget][aria-haspopup="menu"]');
    if (trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const menu = document.getElementById(trigger.getAttribute('popovertarget'));
      if (menu && menu.classList.contains('yf-menu')) {
        event.preventDefault();
        triggers.set(menu, trigger);
        if (!menu.matches(':popover-open')) menu.showPopover();
        focusItem(menu, event.key === 'ArrowUp' ? 'last' : 'first');
      }
      return;
    }

    // inside the menu
    const menu = menuOf(target);
    if (!menu) return;
    const items = itemsOf(menu);
    if (!items.length) return;
    const at = items.indexOf(target.closest(ITEM));
    let to = null;

    if (event.key === 'ArrowDown') to = items[(at + 1) % items.length];
    else if (event.key === 'ArrowUp') to = items[(at - 1 + items.length) % items.length];
    else if (event.key === 'Home') to = items[0];
    else if (event.key === 'End') to = items[items.length - 1];
    else if (event.key === 'Tab') {
      event.preventDefault();
      menu.hidePopover();
      return;
    } else if (event.key.length === 1 && event.key !== ' ') {
      const now = Date.now();
      typed.text = now - typed.at > 600 ? event.key : typed.text + event.key;
      typed.at = now;
      const word = typed.text.toLowerCase();
      const order = items.slice(at + 1).concat(items.slice(0, at + 1));
      to = order.filter(function (item) {
        return item.textContent.trim().toLowerCase().indexOf(word) === 0;
      })[0];
    }
    if (!to) return;
    event.preventDefault();
    to.focus();
  });

  function ready() {
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
/* yf.tooltip: the small part CSS cannot do for [data-yf-tooltip].
   The tip itself is CSS (12-feedback.css). This adds what WCAG 1.4.13 asks of content
   on hover or focus, and what a screen reader needs:
     Escape       hides the tip while the pointer or focus stays on the trigger
                  (data-yf-tooltip-off, cleared when the pointer leaves or focus moves)
     description  the text is set as aria-description on triggers whose own name is
                  different, so it is read, not only seen
   API: yf.tooltip.init(root?), for tips added after the page loads. */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  function name(el) {
    return (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
  }

  function init(scope) {
    (scope || document).querySelectorAll('[data-yf-tooltip]').forEach(function (el) {
      const text = el.getAttribute('data-yf-tooltip').trim();
      if (!text || el.hasAttribute('aria-describedby') || el.hasAttribute('aria-description')) return;
      if (name(el) === text.toLowerCase()) return; // the tip repeats the name: nothing to add
      el.setAttribute('aria-description', text);
    });
  }

  yf.tooltip = { init: init };

  function clear(event) {
    const el = event.target instanceof Element && event.target.closest('[data-yf-tooltip-off]');
    if (!el) return;
    // moving between the trigger and its own children is not leaving it
    if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
    el.removeAttribute('data-yf-tooltip-off');
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-yf-tooltip]').forEach(function (el) {
      if (el.matches(':hover, :focus-visible') || el.querySelector(':focus-visible')) {
        el.setAttribute('data-yf-tooltip-off', '');
      }
    });
  });
  document.addEventListener('mouseout', clear);
  document.addEventListener('focusout', clear);

  function ready() {
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
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
/* yf.table: sortable tables.
   <table class="yf-table" data-yf-sortable> with header cells <th aria-sort="none">. A th
   that has no <button> gets one (its children move into it), so the markup reads as a plain
   header without JS. Click cycles ascending, descending, back to the original order;
   data-yf-sort-first="descending" on a th starts that column high to low (dates, scores).
   Sorts by the cell's data-sort-value when it has one, else its text. Numbers (also with
   thousands commas, %, or a currency sign) compare as numbers; everything else compares
   naturally ("item 2" before "item 10"); empty cells go last in either direction. Rows
   with .yf-table__empty never move. Fires a "yf:sort" event on the table, bubbling, with
   detail { index, direction }. Use data-sort-value for anything locale-specific.
   API: yf.table.init(root?), yf.table.sort(table, columnIndex, "ascending" | "descending" | "none"). */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  const order = new WeakMap(); // row -> its original position
  let seq = 0;

  function original(row) {
    if (!order.has(row)) order.set(row, seq++);
    return order.get(row);
  }

  function valueOf(row, col) {
    const cell = row.cells[col];
    if (!cell) return '';
    return (cell.hasAttribute('data-sort-value') ? cell.getAttribute('data-sort-value') : cell.textContent).trim();
  }

  function asNumber(text) {
    const plain = text.replace(/[\s,_%$€£]/g, '');
    return NUMBER.test(plain) ? parseFloat(plain) : NaN;
  }

  function compare(a, b) {
    const x = asNumber(a);
    const y = asNumber(b);
    return x === x && y === y ? x - y : collator.compare(a, b);
  }

  function sortBody(body, col, direction) {
    const rows = Array.from(body.rows);
    const fixed = rows.filter((r) => r.classList.contains('yf-table__empty'));
    const movable = rows.filter((r) => fixed.indexOf(r) < 0);
    const sign = direction === 'descending' ? -1 : 1;
    const keys = new Map(movable.map((r) => [r, direction === 'none' ? '' : valueOf(r, col)]));
    movable.sort((a, b) => {
      if (direction === 'none') return original(a) - original(b);
      const x = keys.get(a);
      const y = keys.get(b);
      if (x === '' || y === '') return x === y ? original(a) - original(b) : x === '' ? 1 : -1;
      return sign * compare(x, y) || original(a) - original(b);
    });
    const frag = document.createDocumentFragment();
    movable.concat(fixed).forEach((r) => frag.appendChild(r));
    body.appendChild(frag);
  }

  function sort(table, col, direction) {
    const heads = table.querySelectorAll('thead th[aria-sort]');
    heads.forEach((th) => th.setAttribute('aria-sort', th.cellIndex === col ? direction : 'none'));
    Array.from(table.tBodies).forEach((body) => {
      Array.from(body.rows).forEach(original); // remember the order the rows arrived in
      sortBody(body, col, direction);
    });
    table.dispatchEvent(new CustomEvent('yf:sort', { bubbles: true, detail: { index: col, direction } }));
  }

  function next(current, first) {
    const second = first === 'descending' ? 'ascending' : 'descending';
    return current === first ? second : current === second ? 'none' : first;
  }

  function enhance(table) {
    if (table.hasAttribute('data-yf-ready')) return;
    table.setAttribute('data-yf-ready', '');
    Array.from(table.tBodies).forEach((body) => Array.from(body.rows).forEach(original));
    table.querySelectorAll('thead th[aria-sort]').forEach((th) => {
      if (th.querySelector(':scope > button')) return;
      const button = document.createElement('button');
      button.type = 'button';
      while (th.firstChild) button.appendChild(th.firstChild);
      th.appendChild(button);
    });
    table.addEventListener('click', (event) => {
      const button = event.target.closest('thead th[aria-sort] > button');
      if (!button || !table.contains(button)) return;
      const th = button.parentNode;
      const first = th.getAttribute('data-yf-sort-first') === 'descending' ? 'descending' : 'ascending';
      sort(table, th.cellIndex, next(th.getAttribute('aria-sort'), first));
    });
  }

  function init(root) {
    (root || document).querySelectorAll('table[data-yf-sortable]').forEach(enhance);
  }

  yf.table = { init, sort };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
/* yf.copy: copy-to-clipboard buttons.
   <button type="button" data-yf-copy> copies the nearest .yf-code's <pre>;
   data-yf-copy="#id" copies that element (an input's value, else its text).
   Inside the button, [data-yf-copy-label] is the word that changes to "Copied" (override
   with data-yf-copied); a button with no label changes its aria-label instead. Any <use>
   icon in the button switches to #check for a moment. Uses navigator.clipboard; where that
   is missing or refused (an insecure page, a denied permission) it selects the text and
   tries the old copy command, and says "Selected" if that fails too, so the person can press
   the shortcut. The button's data-state is "copied" or "selected" while it shows.
   API: yf.copy.init(root?), yf.copy.write(text) -> Promise<boolean>; write falls back to
   the old command too, through a hidden textarea (put in the open modal dialog, if any,
   since the rest of the page is inert then). */
(function () {
  'use strict';
  const yf = (window.yf = window.yf || {});
  const RESET_MS = 1800;
  const timers = new WeakMap();

  function find(button) {
    const sel = button.getAttribute('data-yf-copy');
    if (sel) {
      try {
        return document.querySelector(sel);
      } catch (err) {
        return null;
      }
    }
    const box = button.closest('.yf-code');
    return box && (box.querySelector('pre') || box);
  }

  function textOf(node) {
    return 'value' in node && typeof node.value === 'string' ? node.value : node.textContent;
  }

  function select(node) {
    if (typeof node.select === 'function') {
      node.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // the fallback: select the text, then try the legacy command
  function legacy(node) {
    select(node);
    try {
      return document.execCommand('copy') ? 'copied' : 'selected';
    } catch (err) {
      return 'selected';
    }
  }

  function legacyText(text) {
    let host = document.body;
    try {
      const open = document.querySelectorAll('dialog:modal');
      if (open.length) host = open[open.length - 1];
    } catch (err) {
      // no :modal, so nothing is inert
    }
    const before = document.activeElement;
    const area = document.createElement('textarea');
    area.className = 'yf-visually-hidden';
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    host.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    host.removeChild(area);
    if (before && typeof before.focus === 'function') before.focus({ preventScroll: true });
    return ok;
  }

  function write(text) {
    const value = String(text);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).then(() => true, () => legacyText(value));
    }
    return Promise.resolve(legacyText(value));
  }

  function swapIcon(button, id) {
    button.querySelectorAll('use').forEach((use) => {
      const href = use.getAttribute('href');
      if (href == null) return;
      if (id) {
        if (!use.hasAttribute('data-yf-was')) use.setAttribute('data-yf-was', href);
        use.setAttribute('href', href.replace(/#.*$/, '') + '#' + id);
      } else if (use.hasAttribute('data-yf-was')) {
        use.setAttribute('href', use.getAttribute('data-yf-was'));
        use.removeAttribute('data-yf-was');
      }
    });
  }

  function show(button, state) {
    const label = button.querySelector('[data-yf-copy-label]');
    const text = state === 'copied' ? button.getAttribute('data-yf-copied') || 'Copied' : button.getAttribute('data-yf-selected') || 'Selected';
    if (!button.hasAttribute('data-yf-was-text')) {
      button.setAttribute('data-yf-was-text', label ? label.textContent : button.getAttribute('aria-label') || '');
    }
    if (label) label.textContent = text;
    else button.setAttribute('aria-label', text);
    button.setAttribute('data-state', state);
    swapIcon(button, state === 'copied' ? 'check' : null);
    clearTimeout(timers.get(button));
    timers.set(
      button,
      setTimeout(() => {
        const was = button.getAttribute('data-yf-was-text');
        if (label) label.textContent = was;
        else if (was) button.setAttribute('aria-label', was);
        else button.removeAttribute('aria-label');
        button.removeAttribute('data-yf-was-text');
        button.removeAttribute('data-state');
        swapIcon(button, null);
      }, RESET_MS)
    );
  }

  function onClick(event) {
    const button = event.target.closest('[data-yf-copy]');
    if (!button) return;
    const node = find(button);
    if (!node) return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textOf(node)).then(
        () => show(button, 'copied'),
        () => show(button, legacy(node))
      );
    } else {
      show(button, legacy(node)); // still inside the click, which the old command needs
    }
  }

  function init(root) {
    (root || document).querySelectorAll('[data-yf-copy] [data-yf-copy-label]').forEach((label) => {
      label.setAttribute('aria-live', 'polite'); // so the change to "Copied" is announced
    });
  }

  yf.copy = { init, write };

  // one listener on the document covers buttons added later
  document.addEventListener('click', onClick);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
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
