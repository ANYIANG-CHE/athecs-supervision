# ATHECS — working rules

Integrated supervision PWA (West Region): `index.html` (whole app, one file), `sw.js`,
`dashboard.html`, `reset.html` / `update.html` / `heal.html`, served statically.
Server: `Code.gs` in Google Apps Script (not in this repo — see below).

## Deploying — one way only

1. Edit and commit here, on `main`.
2. `git push origin main` → GitHub `ANYIANG-CHE/athecs-supervision`.
3. Both addresses rebuild from that same commit:
   - https://anyiang-che.github.io/athecs-supervision/ (GitHub Pages, the old link)
   - https://athecs.pages.dev (Cloudflare Pages, connected to the same repo)

Never upload to Cloudflare directly (`wrangler pages deploy`): the next GitHub build
replaces it, and the two addresses drift apart.

## Code.gs never goes to GitHub

It holds the link password (`TOKEN`) and the dashboard password. It is in
`.gitignore`; the local copy here is the source. Deploy it from the Apps Script
editor: Deploy ▸ Manage deployments ▸ Edit ▸ New version. Never "New deployment"
— that changes the `/exec` address every phone uses.

## Versions

- `APP_VERSION` in `index.html`: raise it for every release; the service worker
  announces the change and phones update themselves.
- `SCRIPT_VERSION` in `Code.gs`: the server's version.
- `APP_EXPECTED` in `Code.gs`: phones below it show an "update" banner. Raise it only
  once both addresses serve the new `index.html`.

## Field safety

Users collect data offline; unsent supervisions live in the browser storage of the
address they use. Never ask users to switch address to get an update — fix the host
they already use. Changes must stay compatible with the deployed `Code.gs` and with
phones on the previous version.
