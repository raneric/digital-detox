# Digital Detox — Social Media Time Limiter (Chrome Extension)

Set a daily time limit per social media site. When the limit is reached, the
site is blocked (redirected to a "time's up" page) until the next day.

## Load it in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

## Features

- Per-site daily limits (minutes), configurable in the popup
- Tracks time spent on the **active tab**, including subdomains
  (`www.instagram.com` counts for `instagram.com`)
- Blocks the site once the limit is reached; unblocks automatically at midnight
- Survives service-worker restarts, browser restarts, and sleep/hibernate
  (time is never double-counted or dumped in a single burst)
- Default sites preconfigured: Facebook, Instagram, X/Twitter, YouTube,
  TikTok, Reddit, LinkedIn — add or remove any site from the popup
- "Reset usage" per site or globally

## Architecture (MV3)

| File                               | Responsibility                                       |
| ---------------------------------- | ---------------------------------------------------- |
| `src/background/main.js`           | Composition root: wires listeners, messages, alarms  |
| `src/background/repository.js`     | Storage abstraction (`chrome.storage.local`)         |
| `src/background/domain-matcher.js` | URL → base-domain extraction and matching            |
| `src/background/limit-policy.js`   | Pure limit logic (over-limit? remaining? accumulate) |
| `src/background/usage-tracker.js`  | Accrues active-tab time via events + alarm           |
| `src/background/site-blocker.js`   | `declarativeNetRequest` dynamic rules                |
| `src/popup/*`                      | Settings UI (talks to the worker via messages only)  |
| `src/blocked/*`                    | The block page users land on                         |
