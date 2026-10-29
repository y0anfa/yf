# icons.awk: the icon grid for the docs, read from the sprite itself.
# Each <symbol id="..."> becomes a cell with the icon, its name and a copy-name button
# (wired by data-yf-copy, so it needs no docs script). The sprite's own "<!-- group -->"
# comments become the group headings.
#
# usage: awk -f icons.awk yf-icons.svg > icons.html
# {{BASE}} is left in the hrefs for the build to fill in.

function open_group(title) {
  print "<section class=\"docs-icon-group\">"
  print "<h4 class=\"docs-icon-group__title yf-eyebrow\">" title "</h4>"
  print "<ul class=\"docs-icons\">"
  opened = 1
}

function close_group() {
  if (opened) { print "</ul>"; print "</section>" }
  opened = 0
}

/^  <!-- .* -->[ \t]*$/ {
  title = $0
  sub(/^  <!-- /, "", title); sub(/ -->[ \t]*$/, "", title)
  close_group()
  open_group(title)
  next
}

/<symbol id="/ {
  id = $0
  sub(/.*<symbol id="/, "", id); sub(/".*/, "", id)
  if (!opened) open_group("icons")
  printf "<li class=\"docs-icon\"><svg class=\"yf-icon yf-icon--lg\" aria-hidden=\"true\"><use href=\"{{BASE}}/icons/yf-icons.svg#%s\"/></svg>", id
  printf "<code id=\"icon-%s\">%s</code>", id, id
  printf "<button class=\"yf-button yf-button--ghost yf-button--icon docs-icon__copy\" type=\"button\" data-yf-copy=\"#icon-%s\" aria-label=\"Copy the name %s\"><svg class=\"yf-icon yf-icon--sm\" aria-hidden=\"true\"><use href=\"{{BASE}}/icons/yf-icons.svg#copy\"/></svg></button></li>\n", id, id
  n++
}

END {
  close_group()
  if (n == 0) { print "icons.awk: no symbols found" > "/dev/stderr"; exit 1 }
}
