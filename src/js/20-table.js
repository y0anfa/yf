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
