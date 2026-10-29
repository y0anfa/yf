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
