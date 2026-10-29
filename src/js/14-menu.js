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
