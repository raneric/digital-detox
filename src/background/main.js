/**
 * Service-worker entry point. Wires the collaborators together —
 * it contains no policy or logic of its own (composition root).
 */

import { repository } from './repository.js';
import { UsageTracker } from './usage-tracker.js';
import { SiteBlocker } from './site-blocker.js';
import { WarnNotifier } from './warn-notifier.js';
import { LimitPolicy } from './limit-policy.js';
import { DomainMatcher } from './domain-matcher.js';
import { maybeRefresh } from './card-feed.js';
import { FLUSH_INTERVAL_MINUTES } from './config.js';

const blocker = new SiteBlocker();
const warnNotifier = new WarnNotifier(repository);

/** Refreshes the learning-card feed cache if it is stale (best effort). */
async function refreshCards() {
  try {
    await maybeRefresh(await repository.getSettings());
  } catch {
    // Card freshness is cosmetic; never let it disturb tracking/blocking.
  }
}

/**
 * Keeps DNR rules in lockstep with over-limit domains, then fires any
 * due limit warnings (fire-and-forget: a notifier failure must never
 * delay or break blocking).
 * @param {{overLimit: string[], warnings: {domain: string, secondsRemaining: number}[]}} evaluation
 */
async function syncBlocking(evaluation) {
  await blocker.sync(evaluation.overLimit);
  await redirectOpenTabs(evaluation.overLimit);
  void warnNotifier.sync(evaluation.warnings).catch(() => {
    // Warnings are cosmetic; the flag rollback inside handles retries.
  });
}

/**
 * DNR rules only apply to *new* main-frame navigations, so tabs already
 * sitting on an over-limit site would stay usable. Actively redirect them.
 * @param {Iterable<string>} overLimitDomains
 */
async function redirectOpenTabs(overLimitDomains) {
  const targets = new Set(overLimitDomains);
  if (targets.size === 0) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => {
        if (!tab.url) return false;
        const domain = DomainMatcher.extractBaseDomain(tab.url);
        return domain !== null && targets.has(domain);
      })
      .map((tab) =>
        chrome.tabs.update(tab.id, {
          url: SiteBlocker.blockedUrlFor(
            /** @type {string} */ (DomainMatcher.extractBaseDomain(tab.url)),
          ),
        }),
      ),
  );
}

// Usage warnings deliberately ride only the alarm tick (not enforce()):
// warnings at browser startup or on settings changes would be noise, and
// the 30s tick bounds the delay to well under a minute.
const tracker = new UsageTracker(repository, (evaluation) =>
  syncBlocking(evaluation),
);
tracker.start();

/**
 * Recomputes blocking for every managed site from persisted state.
 * Used at startup, after popup changes, and on any settings/usage write.
 * Deliberately does NOT fire limit warnings: those belong to the usage
 * tick only (a warning at browser launch or on a limit change would be
 * noise).
 */
async function enforce() {
  const [settings, usage] = await Promise.all([
    repository.getSettings(),
    repository.getAllUsage(),
  ]);
  const overLimit = Object.entries(settings.sites)
    .filter(([domain, site]) => LimitPolicy.isOverLimit(site, usage[domain]))
    .map(([domain]) => domain);
  await blocker.sync(overLimit);
}

/** Creates the flush alarm if it does not exist yet. */
async function ensureAlarm() {
  const existing = await chrome.alarms.get('usage-flush');
  if (!existing) {
    chrome.alarms.create('usage-flush', {
      periodInMinutes: FLUSH_INTERVAL_MINUTES,
    });
  }
}

// --- Event wiring -----------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await enforce();
});

chrome.runtime.onStartup.addListener(async () => {
  await blocker.hydrate();
  await ensureAlarm();
  await enforce();
});

// Every time the service worker wakes up it must restore blocking state.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'usage-flush') {
    await tracker.tick();
    await refreshCards();
  }
});

// One-shot flush on startup of a new worker (covers cold starts).
void (async () => {
  await blocker.hydrate();
  await enforce();
})();

// Messages from the popup UI.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_STATE': {
        const [settings, usage] = await Promise.all([
          repository.getSettings(),
          repository.getAllUsage(),
        ]);
        sendResponse({ settings, usage });
        break;
      }
      case 'SAVE_SETTINGS':
        await repository.saveSettings(message.settings);
        await enforce();
        void refreshCards(); // topics may have changed
        sendResponse({ ok: true });
        break;
      case 'RESET_USAGE':
        await repository.resetUsage(message.domain);
        await enforce();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep the channel open for the async sendResponse
});
