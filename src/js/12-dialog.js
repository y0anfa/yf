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
