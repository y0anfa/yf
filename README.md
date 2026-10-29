# yf

yf is Yoan Faure's design system. It is the visual language of [yoanfaure.com](https://yoanfaure.com), extended for webapps on `*.yoanfaure.com` and for Claude artifacts: ink on paper, a square layout, plain CSS and a little vanilla JavaScript. No framework, no build step for the people who use it.

- **Docs:** https://ds.yoanfaure.com, a live reference built with yf itself.
- **Use it:** link a pinned version.

  ```html
  <link rel="stylesheet" href="https://ds.yoanfaure.com/v0.1.0/yf.css">
  <script src="https://ds.yoanfaure.com/v0.1.0/yf.js" defer></script>
  ```

  `yf.js` is optional; every component reads correctly without it. The version folder also holds `fonts/` and `icons/yf-icons.svg`.
- **Contract:** [SPEC.md](SPEC.md). If the code and the spec disagree, change one of them on purpose.

## Versioning

Versions are semver, and they are **pinned**. There is no `latest` alias, on purpose.

- A released version is a frozen folder, `releases/vX.Y.Z/`. It is served at `https://ds.yoanfaure.com/vX.Y.Z/` and never changes: the same bytes today and in five years, cached for a year (`immutable`). A page that links it cannot break because yf moved.
- To upgrade, change the version in the URL and look at the page.
- Patch releases fix bugs. Minor releases add components, variants and tokens. Major releases may rename or remove classes, tokens, data attributes or JavaScript APIs. Before 1.0 a minor release may break things too.
- A fix never reaches a page that pins an older version. That is the trade.

CI enforces it: a push that changes anything under an already-released `releases/vX.Y.Z/` fails (see [Deploy](#deploy)).

## Local development

POSIX `sh` and `awk`, no dependencies. `python3` is needed only to serve the preview.

```sh
scripts/build               # dist/dev (the source, built) and dist/site (the deployable site)
scripts/build --serve       # build, then serve dist/site at http://127.0.0.1:4300 (--serve 8080 for another port)
scripts/serve [port]        # serve an existing dist/site
scripts/build --dev         # point the docs at /dev/ (src/) even when releases exist
scripts/build --production  # the deploy build: fails with no release, leaves out /dev/
scripts/release X.Y.Z       # freeze a release
```

**`scripts/build`** concatenates `src/css/*.css` (in file-name order) into `yf.css` and `src/js/*.js` into `yf.js`, and copies fonts and icons: that is `dist/dev/`. It then assembles `dist/site/`:

| Path | What |
|---|---|
| `v*/` | every frozen release, copied from `releases/` |
| `index.html` | the docs page, linking the **latest** release (highest semver) |
| `_docs/` | the docs page's own `docs.css` and `docs.js` |
| `404.html` | a yf error page (`.yf-error-page`, `.yf-terminal`, `.yf-topo`) |
| `_headers` | Cloudflare headers, generated |
| `dev/` | a copy of `dist/dev`, in local builds only, so the page is previewable before the first release |

With no release yet, the docs link `/dev/`. The colour tables, contrast ratios, spacing and type scales and the icon grid are generated from the `yf.css` and sprite the docs link, so the page cannot disagree with what it describes.

**`scripts/serve`** is python3's `http.server` plus two things, so the preview behaves like the deploy: it applies the rules in `dist/site/_headers` (a Content Security Policy violation shows in the browser console, as it would in production) and it answers an unknown path with `404.html` and a 404 status. `Cache-Control` is always `no-cache` locally.

### Releasing

1. Set `VERSION` to the new `X.Y.Z` and commit it, along with the source changes. `scripts/release` does not edit `VERSION`; it refuses to run if `VERSION` and the argument differ, so a release is a deliberate act.
2. `scripts/release X.Y.Z` runs the dev build and copies `dist/dev/` to `releases/vX.Y.Z/`, adding a `RELEASE` file (version, source commit, UTC date). It refuses if `releases/vX.Y.Z` exists, if the version is not plain `X.Y.Z`, and, under git, if `src/` or `VERSION` has uncommitted changes (`YF_ALLOW_DIRTY=1` overrides and marks the commit `-dirty`). It commits nothing.
3. Commit `releases/vX.Y.Z` together with any docs that describe it, and push to `main`. The deploy workflow builds and publishes it.

The docs page is deployed with the latest release, and its examples run against that release's CSS. Document a new feature in the same push that releases it; to preview docs for unreleased work, use `scripts/build --dev`.

### The docs page

`docs/index.html` is a template. An `<!--example-->` block is written once and the build emits it twice, live and as an escaped, copyable code block, so what you read is exactly what runs. `<!--code-->` is a code block only. `<!--include name-->` inserts a generated fragment. The page uses no inline script and no inline style, because it is served with `script-src 'self'` and `style-src 'self'` (see `_headers`): it is the proof that yf works under a strict CSP.

## Using yf in Claude artifacts

An artifact cannot load external CSS: its content security policy allows stylesheets from Google Fonts only. So an artifact inlines `yf.css` in a `<style>` block and loads Inter and JetBrains Mono from Google Fonts. The three `@font-face` rules at the top of `yf.css` use relative `fonts/` URLs that will not resolve there; delete them from the inlined copy so the Google Fonts families of the same names apply. The icon sprite has to be pasted inline for the same reason (inside `<svg class="yf-sprite">`, referenced as `href="#check"`). The docs page walks through it.

The same limit applies to any app on another origin: a `<use>` reference to a sprite must be same-origin, so copy `icons/yf-icons.svg` to your own origin or paste it inline. CSS, JS and fonts load cross-origin without trouble (CORS is open on every version folder).

## Deploy

`.github/workflows/deploy.yml` runs on a push to `main` and on manual dispatch:

1. checks the scripts parse (`sh -n`);
2. checks that no already-released `releases/vX.Y.Z/` folder changed in the push (compared with `HEAD^`, so merge `main` with squash or merge commits: each push is then one commit);
3. runs `scripts/build --production`, which fails if there is no release;
4. uploads `dist/site`, and, on `main` only, deploys it with Wrangler to the `yf-ds` Worker (`wrangler.jsonc`: assets only, `ds.yoanfaure.com` as a Workers custom domain, `404.html` for unknown paths).

It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, a GitHub environment named `production`, and `yoanfaure.com` as a zone in that Cloudflare account.

## Licences

- yf's own code and docs: [MIT](LICENSE).
- Inter and JetBrains Mono (in `src/fonts/`): SIL Open Font License 1.1, with their licence texts beside the files.
- Icons: a subset of [Phosphor Icons](https://phosphoricons.com) (Regular), MIT. See `src/icons/LICENSE-phosphor.txt`.
