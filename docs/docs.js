/* docs.js: the docs page's own small behaviours. The page is served with script-src 'self',
   so nothing here is inline and nothing needs an inline handler.

   The theme toggle, tabs, menu, dialogs, tooltips, sorting, sparklines, charts, the topo field and
   every copy button are yf's own (yf.js); they need nothing from this file. This file is only:
     the section nav (a panel on a phone, the current section marked while scrolling)
     the demo buttons (toasts, the motion sample)
     one checkbox that can only be made "mixed" from script
     the path on the 404 page */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('docs-js');

  var wide = window.matchMedia ? window.matchMedia('(min-width: 60rem)') : null;

  // ---------- 404: say what was not found ----------

  var path = document.querySelector('[data-docs-path]');
  if (path) path.textContent = location.pathname;

  // ---------- nav ----------

  var nav = document.getElementById('nav');
  var toggle = document.querySelector('[data-docs-nav-toggle]');

  function setOpen(open) {
    if (!nav || !toggle) return;
    if (open) nav.setAttribute('data-open', '');
    else nav.removeAttribute('data-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide sections' : 'Show sections');
  }

  if (nav && toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      setOpen(!nav.hasAttribute('data-open'));
    });
    // choosing a section closes the panel
    nav.addEventListener('click', function (event) {
      if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.hasAttribute('data-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    if (wide && wide.addEventListener) {
      wide.addEventListener('change', function () {
        if (wide.matches) setOpen(false);
      });
    }
  }

  // mark the section being read: the last heading that has passed the top of the page
  if (nav) {
    var links = {};
    var order = [];
    nav.querySelectorAll('a[href^="#"]').forEach(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var heading = document.getElementById(id);
      if (heading) {
        links[id] = link;
        order.push(heading);
      }
    });

    var current = null;
    var waiting = false;

    var mark = function (id) {
      if (id === current) return;
      if (current && links[current]) links[current].removeAttribute('aria-current');
      current = id;
      if (!id) return;
      var link = links[id];
      link.setAttribute('aria-current', 'true');
      // keep the link in view inside a sidebar that scrolls on its own
      if (wide && wide.matches && nav.scrollHeight > nav.clientHeight) {
        var top = link.offsetTop - 48;
        var bottom = link.offsetTop + link.offsetHeight + 48;
        if (top < nav.scrollTop) nav.scrollTop = top;
        else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = bottom - nav.clientHeight;
      }
    };

    var update = function () {
      waiting = false;
      var line = 120; // px from the top of the window
      var found = null;
      for (var i = 0; i < order.length; i++) {
        if (order[i].getBoundingClientRect().top <= line) found = order[i].id;
        else break;
      }
      mark(found);
    };

    var onScroll = function () {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  // ---------- demos ----------

  var undo = function () {
    window.yf.toast({ message: 'Undone.' });
  };

  var samples = {
    '': { message: 'Copied to the clipboard.' },
    info: { message: 'Export started. We will email you.', status: 'info' },
    success: { message: 'Report saved.', status: 'success', action: { label: 'Undo', onClick: undo } },
    warning: { message: 'Connection is slow; retrying.', status: 'warning' },
    danger: { message: 'Could not delete the report.', status: 'danger' },
  };

  document.addEventListener('click', function (event) {
    if (!(event.target instanceof Element) || !window.yf) return;

    var toast = event.target.closest('[data-docs-toast]');
    if (toast && window.yf.toast) {
      window.yf.toast(samples[toast.getAttribute('data-docs-toast')]);
      return;
    }
    if (event.target.closest('[data-docs-toast-clear]') && window.yf.toast) {
      window.yf.toast.dismissAll();
      return;
    }

    var play = event.target.closest('[data-docs-play]');
    if (play) {
      var box = play.closest('[data-docs-motion]');
      if (box) {
        if (box.hasAttribute('data-on')) box.removeAttribute('data-on');
        else box.setAttribute('data-on', '');
      }
    }
  });

  // "mixed" cannot be written in HTML
  var mixed = document.getElementById('in-mixed');
  if (mixed) mixed.indeterminate = true;
})();
