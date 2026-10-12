# GitHub Pages deployment

Production: https://projects.ahmadjalil.com/scaner/

The default `https://ahzs645.github.io/scaner/` URL redirects to this inherited
account Pages domain. HTTPS enforcement is enabled on this repository.

The repository contains both browser and desktop code. The Pages workflow builds
only the browser application and deploys only `web-app/dist` using GitHub's Pages
artifact/deployment actions. Its environment is `github-pages`; concurrent
publication runs are serialized. Actions are pinned to immutable commits.

`npm ci --ignore-scripts` and `ELECTRON_SKIP_BINARY_DOWNLOAD=1` avoid downloading
or running Electron during CI. Electron's JavaScript dependency metadata remains
in the shared lockfile for local development. No desktop packaging or release job
is configured. Desktop source changes also stay in the repo.

The workflow runs on pushes to `main` and manual dispatch. Repository Settings →
Pages → Build and deployment → Source must be **GitHub Actions**. The workflow
needs `contents: read` for checkout and `pages: write` / `id-token: write` in the
isolated deployment job. It does not need stored deployment credentials.

The build includes local OCR models, workers, JPEG decoding and color WASM assets.
Relative URLs support the `/scaner/` project path. The deployed artifact excludes
Electron, Python, tests, real scans, installer files and research captures.

GitHub Pages does not use the custom response headers from the local development
server. Browser permissions and HTTPS still apply. USB access requires a user
grant in desktop Chrome/Edge; network transport requires the optional Electron
runtime. The site has no document upload endpoint. Browser storage is separate
from localhost and other origins.

Browser tests using private capture fixtures skip when those local files are
absent; optional native Pillow comparisons skip if Pillow is unavailable. Public
synthetic fixtures and the normal driver, lifecycle, storage, processing and
color tests run in CI.
