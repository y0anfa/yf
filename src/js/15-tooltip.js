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
