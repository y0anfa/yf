# examples.awk: expands the docs template, so each example is written once.
#
#   <!--example LABEL [+modifier ...]-->  markup  <!--/example-->
#       the markup, live, then the same markup as an escaped, copyable code block.
#       What you read is exactly what runs; the two cannot disagree.
#   <!--code LABEL [+modifier ...]-->  text  <!--/code-->
#       an escaped code block only (css, js, sh, or html that must not run).
#   A +modifier adds the class docs-demo--modifier to the frame (docs.css styles it).
#   <!--include NAME-->
#       the contents of INCDIR/NAME.html.
#
# Inside an example, {{SPRITE}} is the sprite path: the real URL in the live markup, and
# "icons/yf-icons.svg" in the snippet, which is what an app would write.
# Snippets are escaped text, never markup: nothing here reaches the page as live HTML
# unless it was written as live HTML.
#
# usage: awk -v incdir=DIR -f examples.awk docs/index.html > expanded.html

function replace(s, from, to,    out, i) {
  out = ""
  while ((i = index(s, from)) > 0) {
    out = out substr(s, 1, i - 1) to
    s = substr(s, i + length(from))
  }
  return out s
}

function esc(s) {
  s = replace(s, "&", "&amp;")
  s = replace(s, "<", "&lt;")
  s = replace(s, ">", "&gt;")
  return s
}

# leading spaces on a line
function indent(s,    n) {
  n = 0
  while (substr(s, n + 1, 1) == " ") n++
  return n
}

# "html +tiles" -> label "html", mods " docs-demo--tiles"
function parse_label(raw,    parts, np, i) {
  mods = ""
  label = ""
  np = split(raw, parts, " ")
  for (i = 1; i <= np; i++) {
    if (substr(parts[i], 1, 1) == "+") mods = mods " docs-demo--" substr(parts[i], 2)
    else label = (label == "" ? parts[i] : label " " parts[i])
  }
  if (label == "") label = "html"
}

function code_block(label,    i, min, ind, line, last) {
  last = n
  while (last > 0 && buf[last] ~ /^[ \t]*$/) last--
  min = -1
  for (i = 1; i <= last; i++) {
    if (buf[i] ~ /^[ \t]*$/) continue
    ind = indent(buf[i])
    if (min < 0 || ind < min) min = ind
  }
  if (min < 0) min = 0
  print "<div class=\"yf-code\">"
  print "<div class=\"yf-code__head\"><span class=\"yf-code__file\">" label "</span><button class=\"yf-code__copy\" type=\"button\" data-yf-copy data-yf-copied=\"copied\"><svg class=\"yf-icon yf-icon--sm\" aria-hidden=\"true\"><use href=\"{{BASE}}/icons/yf-icons.svg#copy\"/></svg><span data-yf-copy-label>copy</span></button></div>"
  for (i = 1; i <= last; i++) {
    line = esc(substr(buf[i], min + 1))
    line = replace(line, "{{SPRITE}}", "icons/yf-icons.svg")
    if (i == 1) printf "<pre tabindex=\"0\"><code>%s", line
    else printf "\n%s", line
  }
  print "</code></pre>"
  print "</div>"
}

function live_block(    i, line) {
  for (i = 1; i <= n; i++) {
    line = replace(buf[i], "{{SPRITE}}", "{{BASE}}/icons/yf-icons.svg")
    print line
  }
}

/^[ \t]*<!--example( [^>]*)? ?-->[ \t]*$/ {
  if (kind != "") fail("example inside " kind)
  kind = "example"
  raw = $0
  sub(/^[ \t]*<!--example ?/, "", raw); sub(/ ?-->[ \t]*$/, "", raw)
  parse_label(raw)
  n = 0
  start = NR
  next
}

/^[ \t]*<!--code [^>]*-->[ \t]*$/ {
  if (kind != "") fail("code inside " kind)
  kind = "code"
  raw = $0
  sub(/^[ \t]*<!--code /, "", raw); sub(/ ?-->[ \t]*$/, "", raw)
  parse_label(raw)
  n = 0
  start = NR
  next
}

/^[ \t]*<!--\/example-->[ \t]*$/ {
  if (kind != "example") fail("</example> without <example>")
  print "<div class=\"docs-demo" mods "\">"
  print "<div class=\"docs-demo__live\">"
  live_block()
  print "</div>"
  code_block(label)
  print "</div>"
  kind = ""
  next
}

/^[ \t]*<!--\/code-->[ \t]*$/ {
  if (kind != "code") fail("</code> without <code>")
  print "<div class=\"docs-demo" mods "\">"
  code_block(label)
  print "</div>"
  kind = ""
  next
}

kind != "" { buf[++n] = $0; next }

/^[ \t]*<!--include [a-z0-9-]+-->[ \t]*$/ {
  name = $0
  sub(/^[ \t]*<!--include /, "", name); sub(/-->[ \t]*$/, "", name)
  file = incdir "/" name ".html"
  # getline gives -1 for a file that is not there and 0 for one that is empty; an empty fragment is fine
  got = (getline line < file)
  if (got < 0) { print "examples.awk: missing include '" name "' (" file ")" > "/dev/stderr"; failed = 1 }
  while (got > 0) { print line; got = (getline line < file) }
  close(file)
  next
}

{ print }

function fail(msg) {
  print "examples.awk: line " NR ": " msg > "/dev/stderr"
  failed = 1
  exit 1
}

END {
  if (kind != "") { print "examples.awk: unterminated " kind " from line " start > "/dev/stderr"; exit 1 }
  exit failed
}
