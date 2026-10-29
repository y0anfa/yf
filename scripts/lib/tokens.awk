# tokens.awk: turns the token blocks in a built yf.css into HTML fragments for the docs.
# The docs never restate a value: colours, contrast ratios, spacing and type sizes are read
# from the very CSS file the page links, so the page cannot drift from the release.
#
# usage: awk -v mode=MODE [-v re=REGEX] -f tokens.awk yf.css
#   mode=colour   two tables (light, dark): swatch, token, value, contrast against paper
#   mode=status   danger, warning, success per theme: text and fill, contrast on paper and on the fill
#   mode=series   the four chart ink shades, with their dash patterns, in both themes
#   mode=space    the spacing scale
#   mode=type     the type scale, with specimens
#   mode=kv       a key-value list of the tokens whose name (without --yf-) matches re
#
# Plain POSIX awk: no gawk extensions, no regex intervals, no arrays passed down to functions.

function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

function hexval(s,    i, n) {
  n = 0
  s = tolower(s)
  for (i = 1; i <= length(s); i++) n = n * 16 + index("0123456789abcdef", substr(s, i, 1)) - 1
  return n
}

# a token's value in a theme; dark falls back to light, as the cascade does
function tok(name, theme) {
  if ((theme SUBSEP name) in V) return V[theme SUBSEP name]
  return V["light" SUBSEP name]
}

# replace every var(--yf-x) with its value in the theme
function resolve(s, theme,    guard, name) {
  guard = 0
  while (match(s, /var\(--yf-[a-z0-9-]+\)/) && guard++ < 20) {
    name = substr(s, RSTART + 9, RLENGTH - 10)
    s = substr(s, 1, RSTART - 1) tok(name, theme) substr(s, RSTART + RLENGTH)
  }
  return s
}

# "r g b a" for #rrggbb, transparent, or color-mix(in srgb, A p%, B), which is all the tokens use
function colour(expr, theme,    s, i, ch, depth, cur, np, parts, A, B, pa, pb, ca, cb, w1, w2, alpha) {
  s = trim(resolve(expr, theme))
  if (s == "transparent") return "0 0 0 0"
  if (substr(s, 1, 1) == "#") return hexval(substr(s, 2, 2)) " " hexval(substr(s, 4, 2)) " " hexval(substr(s, 6, 2)) " 1"
  if (substr(s, 1, 10) != "color-mix(") { bad = "cannot read colour: " s; return "0 0 0 1" }
  s = substr(s, 11, length(s) - 11)
  np = 0; depth = 0; cur = ""
  for (i = 1; i <= length(s); i++) {
    ch = substr(s, i, 1)
    if (ch == "(") depth++
    if (ch == ")") depth--
    if (ch == "," && depth == 0) { parts[++np] = trim(cur); cur = "" } else cur = cur ch
  }
  parts[++np] = trim(cur)
  A = parts[2]; pa = -1
  if (match(A, / [0-9.]+%$/)) { pa = substr(A, RSTART + 1, RLENGTH - 2) + 0; A = trim(substr(A, 1, RSTART - 1)) }
  B = parts[3]; pb = -1
  if (match(B, / [0-9.]+%$/)) { pb = substr(B, RSTART + 1, RLENGTH - 2) + 0; B = trim(substr(B, 1, RSTART - 1)) }
  if (pa < 0 && pb < 0) { pa = 50; pb = 50 } else if (pa < 0) pa = 100 - pb; else if (pb < 0) pb = 100 - pa
  split(colour(A, theme), ca, " ")
  split(colour(B, theme), cb, " ")
  w1 = pa / 100 * ca[4]; w2 = pb / 100 * cb[4]; alpha = w1 + w2
  if (alpha <= 0) return "0 0 0 0"
  return int((w1 * ca[1] + w2 * cb[1]) / alpha + 0.5) " " int((w1 * ca[2] + w2 * cb[2]) / alpha + 0.5) " " int((w1 * ca[3] + w2 * cb[3]) / alpha + 0.5) " " alpha
}

function lin(c) { c = c / 255; return c <= 0.04045 ? c / 12.92 : exp(2.4 * log((c + 0.055) / 1.055)) }
function lum(r, g, b) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
function ratio(l1, l2,    t) { if (l1 < l2) { t = l1; l1 = l2; l2 = t } return (l1 + 0.05) / (l2 + 0.05) }
# floored to one decimal: a near miss is never rounded up to a pass
function fmt(x) { return sprintf("%.1f:1", int(x * 10) / 10) }
function hex(r, g, b) { return sprintf("#%02x%02x%02x", r, g, b) }

# evaluates a token in a theme into globals: BASE (its hex), ALPHA, FLAT (hex laid over paper), LUM (of FLAT)
function eval_token(name, theme,    c, p, a) {
  split(colour("var(--yf-" name ")", theme), c, " ")
  split(colour("var(--yf-bg)", theme), p, " ")
  a = c[4]
  BASE = hex(c[1], c[2], c[3])
  ALPHA = a
  FR = int(c[1] * a + p[1] * (1 - a) + 0.5); FG = int(c[2] * a + p[2] * (1 - a) + 0.5); FB = int(c[3] * a + p[3] * (1 - a) + 0.5)
  FLAT = hex(FR, FG, FB)
  LUM = lum(FR, FG, FB)
}

function paper(theme) { eval_token("bg", theme); return LUM }

function swatch(h) {
  return "<svg class=\"docs-swatch\" viewBox=\"0 0 4 2\" preserveAspectRatio=\"none\" aria-hidden=\"true\"><rect width=\"4\" height=\"2\" fill=\"" h "\"/></svg>"
}

function describe(name) {
  if (name == "bg") return "paper: the page"
  if (name == "fg") return "ink: text, rules, the primary action"
  if (name == "muted") return "secondary text"
  if (name == "rule") return "dividers, a decoration"
  if (name == "sunk") return "panels, code, controls"
  if (name == "control-border") return "the edge of a control"
  if (name == "hover") return "hover fill"
  if (name == "selected") return "selected fill"
  return ""
}

function colour_table(theme, title,    names, n, i, name, pl, note) {
  pl = paper(theme)
  print "<div class=\"docs-theme\">"
  print "<h4 class=\"docs-theme__title\">" title "</h4>"
  print "<div class=\"yf-table-wrap\" tabindex=\"0\" role=\"region\" aria-label=\"" title " theme colour tokens\">"
  print "<table class=\"yf-table\">"
  print "<thead><tr><th scope=\"col\"><span class=\"yf-visually-hidden\">Swatch</span></th><th scope=\"col\">token</th><th scope=\"col\">value</th><th scope=\"col\" class=\"yf-num\">on paper</th></tr></thead>"
  print "<tbody>"
  n = split("bg fg muted rule sunk control-border hover selected", names, " ")
  for (i = 1; i <= n; i++) {
    name = names[i]
    eval_token(name, theme)
    note = describe(name)
    if (ALPHA < 1) note = note " (" BASE " at " int(ALPHA * 100 + 0.5) "%)"
    printf "<tr><td>%s</td><th scope=\"row\"><span class=\"yf-mono\">--yf-%s</span><span class=\"docs-note\">%s</span></th><td class=\"yf-mono\">%s</td>", swatch(FLAT), name, note, FLAT
    if (ALPHA < 1) print "<td class=\"yf-num yf-muted\">fill</td></tr>"
    else if (name == "bg") print "<td class=\"yf-num yf-muted\">paper</td></tr>"
    else printf "<td class=\"yf-num\">%s</td></tr>\n", fmt(ratio(LUM, pl))
  }
  print "</tbody></table></div></div>"
}

function status_table(theme, title,    names, n, i, name, pl, fl, fg_hex, fg_lum, fill_hex) {
  pl = paper(theme)
  print "<div class=\"docs-theme\">"
  print "<h4 class=\"docs-theme__title\">" title "</h4>"
  print "<div class=\"yf-table-wrap\" tabindex=\"0\" role=\"region\" aria-label=\"" title " theme status colours\">"
  print "<table class=\"yf-table\">"
  print "<thead><tr><th scope=\"col\"><span class=\"yf-visually-hidden\">Swatch</span></th><th scope=\"col\">token</th><th scope=\"col\" class=\"yf-num\">on paper</th><th scope=\"col\" class=\"yf-num\">on fill</th></tr></thead>"
  print "<tbody>"
  n = split("danger warning success", names, " ")
  for (i = 1; i <= n; i++) {
    name = names[i]
    eval_token(name, theme); fg_hex = FLAT; fg_lum = LUM
    eval_token(name "-bg", theme); fill_hex = FLAT; fl = LUM
    printf "<tr><td><span class=\"docs-swatches\">%s%s</span></td>", swatch(fg_hex), swatch(fill_hex)
    printf "<th scope=\"row\"><span class=\"docs-token\"><span class=\"yf-mono\">--yf-%s</span><span class=\"docs-note yf-mono\">%s</span></span><span class=\"docs-token\"><span class=\"yf-mono\">--yf-%s-bg</span><span class=\"docs-note yf-mono\">%s</span></span></th>", name, fg_hex, name, fill_hex
    printf "<td class=\"yf-num\">%s</td><td class=\"yf-num\">%s</td></tr>\n", fmt(ratio(fg_lum, pl)), fmt(ratio(fg_lum, fl))
  }
  print "</tbody></table></div></div>"
}

function series_table(    i, ll, dl) {
  print "<div class=\"yf-table-wrap\" tabindex=\"0\" role=\"region\" aria-label=\"Chart series tokens\">"
  print "<table class=\"yf-table\">"
  print "<thead><tr><th scope=\"col\"><span class=\"yf-visually-hidden\">Preview</span></th><th scope=\"col\">token</th><th scope=\"col\">dash</th><th scope=\"col\">light</th><th scope=\"col\">dark</th></tr></thead>"
  print "<tbody>"
  ll = paper("light"); dl = paper("dark")
  for (i = 1; i <= 4; i++) {
    printf "<tr><td><svg class=\"docs-series\" viewBox=\"0 0 48 8\" aria-hidden=\"true\"><line class=\"yf-series-%d\" x1=\"0\" y1=\"4\" x2=\"48\" y2=\"4\" stroke-width=\"2\"/></svg></td>", i
    printf "<th scope=\"row\"><span class=\"yf-mono\">--yf-series-%d</span></th><td class=\"yf-mono\">%s</td>", i, tok("dash-" i, "light")
    eval_token("series-" i, "light"); printf "<td class=\"yf-mono\">%s <span class=\"yf-muted\">%s</span></td>", FLAT, fmt(ratio(LUM, ll))
    eval_token("series-" i, "dark"); printf "<td class=\"yf-mono\">%s <span class=\"yf-muted\">%s</span></td></tr>\n", FLAT, fmt(ratio(LUM, dl))
  }
  print "</tbody></table></div>"
}

# a length token as pixels, for the reader who thinks in pixels
function px(v,    n, parts) {
  if (v ~ /^[0-9.]+rem$/) { sub(/rem$/, "", v); return sprintf("%gpx", v * 16) }
  if (v ~ /^[0-9.]+px$/) return v
  if (substr(v, 1, 6) == "clamp(") {
    n = split(substr(v, 7, length(v) - 7), parts, ",")
    sub(/rem$/, "", parts[1]); sub(/rem$/, "", parts[n])
    return sprintf("%g to %gpx", trim(parts[1]) * 16, trim(parts[n]) * 16)
  }
  return ""
}

function space_table(    i, v) {
  print "<div class=\"yf-table-wrap\" tabindex=\"0\" role=\"region\" aria-label=\"Spacing tokens\">"
  print "<table class=\"yf-table\">"
  print "<thead><tr><th scope=\"col\"><span class=\"yf-visually-hidden\">Size</span></th><th scope=\"col\">token</th><th scope=\"col\">value</th><th scope=\"col\" class=\"yf-num\">pixels</th></tr></thead>"
  print "<tbody>"
  for (i = 1; (("light" SUBSEP "space-" i) in V); i++) {
    v = tok("space-" i, "light")
    printf "<tr><td><span class=\"docs-space docs-space--%d\"></span></td><th scope=\"row\"><span class=\"yf-mono\">--yf-space-%d</span></th><td class=\"yf-mono\">%s</td><td class=\"yf-num\">%s</td></tr>\n", i, i, v, px(v)
  }
  print "</tbody></table></div>"
}

function type_table(    n, i, names, v) {
  print "<div class=\"yf-table-wrap\" tabindex=\"0\" role=\"region\" aria-label=\"Type scale\">"
  print "<table class=\"yf-table\">"
  print "<thead><tr><th scope=\"col\">specimen</th><th scope=\"col\">class</th><th scope=\"col\">value</th><th scope=\"col\" class=\"yf-num\">pixels</th></tr></thead>"
  print "<tbody>"
  n = split("xs sm base lg xl 2xl 3xl", names, " ")
  for (i = 1; i <= n; i++) {
    v = tok("text-" names[i], "light")
    printf "<tr><td><span class=\"yf-text-%s docs-specimen\">Ink on paper</span></td><th scope=\"row\"><span class=\"yf-mono\">.yf-text-%s</span><span class=\"docs-note yf-mono\">--yf-text-%s</span></th><td class=\"yf-mono\">%s</td><td class=\"yf-num\">%s</td></tr>\n", names[i], names[i], names[i], v, px(v)
  }
  print "</tbody></table></div>"
}

function kv_list(    i, name) {
  print "<dl class=\"yf-kv\">"
  for (i = 1; i <= count; i++) {
    name = order[i]
    if (name ~ re) printf "<div><dt class=\"yf-mono\">--yf-%s</dt><dd class=\"yf-mono\">%s</dd></div>\n", name, tok(name, "light")
  }
  print "</dl>"
}

# ---------- reading the css ----------
# Only the two blocks that set the palette: ":root {" (light) and ":root[data-theme="dark"] {".
# The system-dark block repeats the dark values and is skipped.

/^  :root \{/ { theme = "light"; next }
/^  :root\[data-theme="dark"\] \{/ { theme = "dark"; next }
/^  [}@:.a-z]/ { theme = ""; next }
theme != "" && /^    --yf-[a-z0-9-]+:/ {
  line = $0
  sub(/\/\*.*\*\//, "", line)
  name = line
  sub(/^    --yf-/, "", name); sub(/:.*/, "", name)
  val = line
  sub(/^[^:]*:/, "", val); sub(/;[ \t]*$/, "", val)
  V[theme SUBSEP name] = trim(val)
  if (theme == "light") order[++count] = name
}

END {
  if (count == 0) { print "tokens.awk: no tokens found in the input" > "/dev/stderr"; exit 1 }
  if (mode == "colour") {
    print "<div class=\"docs-themes\">"
    colour_table("light", "light"); colour_table("dark", "dark")
    print "</div>"
  } else if (mode == "status") {
    print "<div class=\"docs-themes\">"
    status_table("light", "light"); status_table("dark", "dark")
    print "</div>"
  } else if (mode == "series") series_table()
  else if (mode == "space") space_table()
  else if (mode == "type") type_table()
  else if (mode == "kv") kv_list()
  else { print "tokens.awk: unknown mode: " mode > "/dev/stderr"; exit 1 }
  if (bad != "") { print "tokens.awk: " bad > "/dev/stderr"; exit 1 }
}
