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
