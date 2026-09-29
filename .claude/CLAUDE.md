# Digital Detox — Chrome Extension

Chrome MV3 extension that lets users set daily time limits per social media site. When a limit is reached, the site is blocked (redirected to a block page) until the next day.

## Build & Run

No build step — plain ES modules, loaded directly from this folder.

- Load: `chrome://extensions` → Developer mode → **Load unpacked** → select this folder
- After editing background code, click the extension's "Reload" arrow on `chrome://extensions` (or the popup's reload button) and refresh any open tabs
- Validate changes: `node --check` every JS file; `python3 -c "import json; json.load(open('manifest.json'))"` for the manifest

## Architecture

MV3 service worker + popup UI. Data flows through `chrome.runtime.sendMessage` between popup and worker.

```
src/background/main.js          # composition root — wiring only, no logic
src/background/repository.js    # storage abstraction over chrome.storage.local (settings + usage)
src/background/domain-matcher.js# URL → base domain extraction/matching (e.g. www.x.com → x.com)
src/background/limit-policy.js  # pure decision logic (over-limit, remaining, accumulate) — unit-testable
src/background/usage-tracker.js # accrues active-tab time via events + 30s alarm flush
src/background/site-blocker.js  # declarativeNetRequest dynamic rules, deterministic rule IDs
src/background/warn-notifier.js # one-per-day "N minutes left" chrome.notifications warning
src/background/card-feed.js     # learning-card RSS refresh (Medium tag feeds) + cache
src/background/config.js        # shared constants
src/popup/*                     # settings UI (talks to worker via messages only)
src/blocked/*                   # the block page users land on
```

## Critical invariants — do not break

- **No timers in the service worker.** MV3 kills workers aggressively. All correctness comes from event timestamps (`lastTick`) + the `usage-flush` alarm + persisted storage. A `setInterval`-based approach will silently lose or double-count time.
- **Time accrues only on the focused active tab, and only while the user is active.** `UsageTracker.detectActiveDomain()` defines what counts; `chrome.idle` (`onStateChanged` → `isIdle`) pauses accrual when the user is AFK/locked; flushing clamps elapsed time (`MAX_CREDIT_SECONDS`) so sleep/hibernate never dumps hours into one tick.
- **DNR rule IDs must stay deterministic** (`SiteBlocker.ruleIdFor` hashes the domain). Never generate random IDs — sync add/remove relies on stability across worker restarts.
- **Storage shape:** `settings.sites` is keyed by base domain; `usage` records are `{date: 'YYYY-MM-DD', secondsUsed}`; `warned` maps domain → 'YYYY-MM-DD' last warned (per-day de-dup for warnings). Daily reset is implicit — records dated before today are ignored/reset by `LimitPolicy`, no midnight alarm exists.
- **Popup duplicates the over-limit check only for display.** The background worker is the single source of truth for actual blocking.

## Conventions

- Plain ES modules, no TypeScript, no bundler, no external dependencies.
- JSDoc typedefs stand in for types (`SiteLimit`, `UsageRecord`, `Settings` in `repository.js`) — keep them updated when changing shapes.
- Permissions are minimal (`tabs`, `storage`, `alarms`, `declarativeNetRequest`, `notifications` for the pre-limit warning, `idle` so AFK time doesn't count, plus `host_permissions` for `https://medium.com/*` used only by the learning-card feed refresh) — don't add permissions without strong justification.

## Planned improvements (TODO)

- [ ] Tests: `limit-policy.js` is pure — wire up Vitest (or plain `node:test`) first. `domain-matcher.js` already has `tests/domain-matcher.test.js` (`node --test tests/domain-matcher.test.js`).
- [x] Warning notification N minutes before a limit hits (`chrome.notifications`) — global `warnMinutesBefore` setting, fired once per domain per day from the usage tick.
- [ ] "Pause for 5 minutes" grace period with confirmation friction.
- [ ] Weekly/monthly usage stats view (usage history currently only keeps today).
- [x] Proper public-suffix handling in `DomainMatcher` — `src/background/public-suffixes.js` bundles the PSL ICANN section (regenerate via `node tools/generate-public-suffixes.mjs`).
- [ ] Extension icons (16/48/128 PNG) + action badge showing remaining minutes.
- [ ] Sync settings across devices (`chrome.storage.sync`).
- [x] Idle detection (`chrome.idle`) so AFK time doesn't count (60s threshold, `IDLE_DETECTION_INTERVAL_SECONDS` in `config.js`).
