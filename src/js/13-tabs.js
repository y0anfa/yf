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
