# ATHECS Integrated Supervision — development close-out

Version at close: **app 5.8.3 · server (Code.gs) 5.8.4** · 28 October 2026
Addresses: https://athecs.pages.dev (main) · https://anyiang-che.github.io/athecs-supervision/ (old link)

## 1. What the app is

An offline-first web app (PWA) for integrated supervision in the West Region: supervisors
fill the 64-question tool at facilities, facility staff follow their action plans, and the
coordination console approves, follows up and reports. Everything is saved on the phone
first and sent to the Google Sheet when there is signal.

- `index.html` — the whole app. `sw.js` — keeps it working with no network.
- `dashboard.html` — public national dashboard. `reset.html` / `update.html` / `heal.html` — repair pages.
- `Code.gs` — the server, in Google Apps Script, writing to one Google Sheet. **Not in GitHub.**

## 2. Who is who, and how each signs in

| Account | Created by | Door on the sign-in screen | First sign-in |
|---|---|---|---|
| Supervisor | enrols on their phone, approved in the console | Supervisor | chooses a PIN at enrolment |
| Facility staff | enrols on their phone, approved in the console | Facility staff | same |
| Super user | an **administrator assigns a post** (U001–U020) | Administration | 6-digit code, then chooses a PIN |
| Administrator | the Apps Script editor (`activerAdmin`, `activerAdmin2`) | Administration | 6-digit code, then chooses a PIN |

**The PIN** is checked on the phone, with no network. Since 5.8.0 it is also saved on the
account, so the same PIN works on any phone and on both addresses (the first sign-in on a
new phone needs signal once).

**Forgotten PIN / new phone without a saved PIN:** console ▸ user ▸ 🔑 gives a temporary
6-digit code (shown only once the server holds it). The person types it in the PIN box and
chooses a new PIN, which is then saved on the account.

**Making a supervisor a super user** (also for people enrolled as supervisors by mistake):
console ▸ Users ▸ role list ▸ **⬆ Make super user…** (or the ⬆ button on their card). This
assigns a free post with their name and phone filled in and shows a 6-digit code. They use
it at the **Administration** door on the same phone. Their supervisor account stays as it
is; deactivate it afterwards only if they will no longer supervise. A role list can never
set "Super user" or "Administrator" directly — those are posts, given by code.

## 3. Releasing a change

1. Change and commit in the local `ATHECS` folder; raise `APP_VERSION` in `index.html`.
2. `git push origin main` — GitHub Pages and Cloudflare both rebuild from that commit
   (about a minute). Installed phones on either address update themselves.
3. If `Code.gs` changed: Apps Script ▸ paste ▸ Save ▸ Deploy ▸ Manage deployments ▸
   Edit ▸ **New version**. Never "New deployment".
4. Never upload to Cloudflare directly, and never move users to another address to get an
   update — their unsent work lives on the address they use.

Rules for future work are in `CLAUDE.md`.

## 4. Fixed in this round (5.7.1 → 5.8.2)

- "Asks for the 6-digit code again after sign-out" — the PIN now lives on the account.
- The "Choose your PIN" box disappearing after a code was accepted.
- Screen shaking: the console no longer repaints every 25 s when nothing changed.
- Console showed "active" for accounts that only worked on one phone.
- Temporary codes read out before the server had them, then refused.
- An old "PIN owed" marker taking over sign-in after the 5.8.0 update.
- Role list offering "Super user"/"Administrator": refused by the server, then the account
  vanished from the admin's phone. Replaced by **⬆ Make super user…**.
- Server overload (5.8.3): codes "refused" without being judged, and a slow app. Every
  quick pull read the whole ANSWERS tab; the post list read USERS 22 times; phones stacked
  a new round on top of an unfinished one. All three fixed, and a busy server is now
  reported as busy ("your code was not used") instead of "refused" / "wrong PIN".
  Server 5.8.4: settings read once per request, and only the end of the Journal is read.
- Forgotten-PIN requests now show in the national Users table (🔑 filter and button).
- Deployment: one push now updates both addresses; `Code.gs` removed from the repository
  and from every public Cloudflare deployment.

## 5. Open items (owner: administrator)

1. **A001 (administrator)** — if the usual PIN is refused, run `activerAdmin` in the
   editor and activate again with the code shown.
2. **Super users active on one phone only** (console shows *actif · 1 téléphone*): issue
   each a ↻ New code once; their PIN is then on the account.
3. **Make the GitHub repository private**, then **change `TOKEN` and `DASH_TOKEN`** in a
   quiet window after data collection (older commits still contain `Code.gs`). Changing
   the token needs `index.html`, `dashboard.html` and `Code.gs` released together.

## 6. Later: Play Store and App Store

The app is already an installable PWA, so the store builds wrap it rather than rewrite it.

| Step | Play Store (Android) | App Store (iPhone) |
|---|---|---|
| Account | Google Play Console, one-time US$25 | Apple Developer Program, US$99 / year |
| Wrapper | Trusted Web Activity, generated with **PWABuilder** or Bubblewrap | **PWABuilder** iOS package or Capacitor; built on a Mac with Xcode |
| Proof the site is yours | `/.well-known/assetlinks.json` on the app's address | associated-domains file |
| Required pages | privacy policy URL, data-safety form | privacy policy, App Privacy labels |
| Review risk | low for a TWA | higher: Apple rejects "just a website"; offline use and installability help |

Before starting: (1) put the app on a **custom domain** (for example `app.<organisation>.org`)
pointed at Cloudflare, so the store build is tied to an address you own; (2) write the
privacy policy (health-facility data, no patient identifiers); (3) decide who owns the store
accounts (ICAP / NACC). Store builds are then rebuilt only when the wrapper changes — app
updates keep arriving through the normal push.

## 7. Suggested next development round (after data collection)

- Automated end-to-end tests of the sign-in, PIN and sync flows (Playwright), run before
  every release.
- A visual refresh of the console and forms, done as a design pass with screenshots
  reviewed before release.
- A security review (token rotation, server-side permission checks).
