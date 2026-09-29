# ReelRest — take back your time on social media

ReelRest is a free, open-source Chrome extension that helps you spend
less time on social media. You decide how many minutes per day you're willing
to give each site — Facebook, Instagram, TikTok, X/Twitter, YouTube, whatever
eats your evenings. Once your daily budget is spent, the site is blocked until
tomorrow. No willpower required; the extension does the remembering for you.
And because a block page shouldn't be a dead end, when a site is blocked the
app suggests more interesting content to read right there on the blocking
page.

## Why?

Because "just 5 more minutes" is a lie we tell ourselves. Feeds are designed
to keep you scrolling, and an on-screen clock is easy to ignore. ReelRest makes the limit _real_: when your time is up, the site is simply gone
until the next day.

## How to use it

### 1. Install (no store required)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle, top right)
3. Click **Load unpacked** and select this folder

The shield icon appears in your toolbar. (Tip: pin it with the puzzle-piece
button so it's one click away.)

### 2. Add a site and set your limit

Click the shield icon. In the popup:

1. Type a site's address — `instagram.com`, `youtube.com`, … — and a daily
   limit in minutes (for example 30).
2. Click **Add**.

That's it. From now on, the extension quietly counts the time you spend on
that site (on its subdomains too: `www.instagram.com` counts as
`instagram.com`) — and only while you're actually there: switching tabs
pauses the clock, and after a minute of no keyboard or mouse activity
(machine locked, or you just walked away) it pauses too. The popup shows,
for each site:

- a **progress bar** — green while you have time left, amber when you're
  close, red when you're out
- how many minutes you've used today against your limit

You can adjust a site's limit anytime from the popup. Time only counts while
the site's tab is open _and in front of you_ — switching tabs pauses the
clock, and so does going idle (no input for a minute) or locking your
machine. Each day at midnight, every counter starts fresh.

### A heads-up before time runs out

No one reads a clock while scrolling, so ReelRest taps you on the shoulder:
by default, **5 minutes before a site's daily limit runs out** you get a
browser notification ("Only 5 min left on youtube.com today"). You can
change the lead time — or turn warnings off — in **Manage / reset sites ↗**
(0 disables them). Each site warns at most once a day; resetting a site's
usage also re-arms its warning.

### 3. When the limit is reached

The tab you're on is replaced with a "time's up" page, and the site won't
load again until tomorrow. There is no snooze button where you'll meet it —
by design.

### 4. Resetting or removing a site (the honest way)

Resetting a timer is _deliberately_ kept out of the popup, so that in a weak
moment a single accidental click can't wipe your progress. If you genuinely
need it — you're a parent, you're testing, or you've decided to renegotiate
your own limits:

1. Click **Manage / reset sites ↗** at the bottom of the popup (it opens in
   a full browser tab — enough friction to make you ask "do I really want
   this?").
2. There you can change limits, reset a site's day, reset everything, or
   remove a site. Every destructive action asks for confirmation.

### 5. Learning cards, personalized

When a site is blocked you land on a page with a **learning card** — a short
article pick (title, one-line summary, link) you can read in a new tab
instead of scrolling. Cards rotate: you won't see the same one until the
deck cycles. Two ways cards stay interesting:

- **You choose the topics.** In the popup, open **Manage / reset sites ↗**
  and tick the topics you care about — Wellbeing, AI, Focus, Science,
  Philosophy, Career.
- **Fresh picks, twice a day.** The extension bundles ~36 hand-picked
  articles, and once a day it quietly refreshes a small cache of new
  article links from Medium's public per-topic feeds for your chosen
  topics. No account, no tracking; if you're offline or the fetch fails,
  the bundled articles still show.

### Privacy

Everything stays on your computer. The extension has no account, no server,
no analytics: it only stores your site list, today's usage, and a small
learning-card cache in your browser's local storage. The only network
request it makes is the daily article-feed refresh from medium.com — skip
the topic feature and the extension never touches the network. Uninstalling
deletes all of it.

---

# For contributors

ReelRest is a Chrome MV3 extension: plain ES modules, no build step, no
dependencies, no TypeScript.

## Project layout

| File                               | Responsibility                                       |
| ---------------------------------- | ---------------------------------------------------- |
| `src/background/main.js`           | Composition root: wires listeners, messages, alarms  |
| `src/background/repository.js`     | Storage abstraction (`chrome.storage.local`)         |
| `src/background/domain-matcher.js` | URL → base-domain extraction and matching (Public Suffix List algorithm) |
| `src/background/public-suffixes.js` | Generated PSL data (ICANN section) — regenerate with `node tools/generate-public-suffixes.mjs` |
| `tests/domain-matcher.test.js`     | `node:test` unit tests for the domain matcher        |
| `src/background/limit-policy.js`   | Pure limit logic (over-limit? remaining? accumulate) |
| `src/background/usage-tracker.js`  | Accrues active-tab time via events + alarm           |
| `src/background/site-blocker.js`   | `declarativeNetRequest` dynamic rules                |
| `src/background/warn-notifier.js`  | Once-per-day pre-limit warning notifications         |
| `src/background/card-feed.js`      | Learning-card RSS refresh (Medium feeds) + cache     |
| `src/background/config.js`         | Shared constants                                     |
| `src/popup/*`                      | Settings UI (talks to the worker via messages only)  |
| `src/blocked/*`                    | The block page users land on                         |

The popup serves two modes: the default popup view is read/limit-adjust only,
while `popup.html?view=options` (also registered as the extension's options
page) exposes reset/remove actions behind confirmation dialogs.

## Working on the code

- Load unpacked as described above; after editing background code, click the
  extension's **Reload** arrow on `chrome://extensions` and refresh open tabs.
- Validate changes: `node --check` every touched JS file;
  `python3 -c "import json; json.load(open('manifest.json'))"` for the
  manifest. Run the unit tests with `node --test tests/`.
- The popup talks to the service worker **only** via
  `chrome.runtime.sendMessage` — no direct storage access from UI code.

## Critical invariants — do not break

- **No timers in the service worker.** MV3 kills workers aggressively.
  Correctness comes from event timestamps (`lastTick`) + the `usage-flush`
  alarm + persisted storage. A `setInterval`-based approach silently loses or
  double-counts time.
- **Time accrues only on the focused active tab.** `UsageTracker` defines
  what counts; each flush is clamped (`MAX_CREDIT_SECONDS`) so
  sleep/hibernate never dumps hours into one tick.
- **DNR rule IDs are deterministic** (`SiteBlocker.ruleIdFor` hashes the
  domain). Never use random IDs — add/remove depends on stability across
  worker restarts.
- **Storage shape:** `settings.sites` is keyed by base domain; `usage`
  records are `{date: 'YYYY-MM-DD', secondsUsed}`. Daily reset is implicit —
  `LimitPolicy` ignores records not dated today; there is no midnight alarm.
- **The background worker is the single source of truth for blocking.** The
  popup duplicates the over-limit check only for display.

## Conventions

- Plain ES modules, JSDoc typedefs stand in for types (`SiteLimit`,
  `UsageRecord`, `Settings` in `repository.js`) — keep them updated when
  changing shapes.
- Keep permissions minimal (`tabs`, `storage`, `alarms`,
  `declarativeNetRequest`, `notifications`, `idle`) — don't add permissions
  without strong justification.

## Ideas welcome

Weekly usage stats. See the TODO list in
[`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the full list.
