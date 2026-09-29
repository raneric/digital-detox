/**
 * Tracks how long the active tab spends on a known site per day.
 *
 * Design notes (MV3 service workers die constantly, so correctness comes
 * from event timestamps + a low-frequency alarm, never from in-memory
 * timers):
 *  - Every visibility event flushes the elapsed time of the *previous*
 *    active domain, then switches to the new one.
 *  - A periodic alarm flushes the *current* domain so time still accrues
 *    while the user reads one page without any events firing.
 *  - Elapsed time per flush is clamped so sleep/hibernate can't dump
 *    hours of "usage" into a single tick.
 */

import { DomainMatcher } from './domain-matcher.js';
import { LimitPolicy, todayKey } from './limit-policy.js';
import { FLUSH_INTERVAL_MINUTES } from './config.js';

/** Never credit more than this per flush tick (2x interval + slack). */
const MAX_CREDIT_SECONDS = FLUSH_INTERVAL_MINUTES * 60 * 2 + 30;

/**
 * Result of one evaluation pass: which sites must be blocked, and which
 * are approaching their limit (candidates for a warning notification).
 *
 * @typedef {Object} UsageEvaluation
 * @property {string[]} overLimit                            Domains to block
 * @property {{domain: string, secondsRemaining: number}[]} warnings
 *           Domains inside the warn window, with time left today
 */

export class UsageTracker {
  /**
   * @param {import('./repository.js').UsageRepository} repository
   * @param {(result: UsageEvaluation) => Promise<void>} onUsageChanged
   */
  constructor(repository, onUsageChanged) {
    this.repository = repository;
    this.onUsageChanged = onUsageChanged;
    /** @type {string|null} base domain of the tracked (active) tab */
    this.activeDomain = null;
    /** @type {number} epoch ms of the last flush */
    this.lastTick = Date.now();
  }

  /** Registers all listeners. Called once at service-worker startup. */
  start() {
    chrome.tabs.onActivated.addListener(() => this.handleFocusEvent());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === 'complete') {
        if (tab.active) this.handleFocusEvent();
      }
    });
    chrome.windows.onFocusChanged.addListener(() => this.handleFocusEvent());
  }

  /**
   * Flushes elapsed usage for the current domain and re-detects the
   * domain of the currently focused tab.
   */
  async handleFocusEvent() {
    await this.flush();
    this.activeDomain = await this.detectActiveDomain();
  }

  /** Alarm callback: accrue time for the domain the user is still on. */
  async tick() {
    await this.flush();
    await this.onUsageChanged(await this.evaluate());
  }

  /**
   * Credits elapsed wall-clock time (since lastTick) to `this.activeDomain`
   * and pushes the envelope forward. Returns the list of domains that are
   * now over their limit.
   */
  async flush() {
    const now = Date.now();
    const elapsed = Math.min(
      MAX_CREDIT_SECONDS,
      Math.round((now - this.lastTick) / 1000),
    );
    this.lastTick = now;

    if (!this.activeDomain || elapsed <= 0) {
      return;
    }
    const site = (await this.repository.getSettings()).sites[this.activeDomain];
    // Only managed, enabled sites accrue time; others are simply ignored.
    if (!site || !site.enabled) return;

    await this.repository.updateUsage(this.activeDomain, (prev) =>
      LimitPolicy.accumulate(prev, elapsed),
    );
  }

  /**
   * Evaluates every managed site against today's usage in a single
   * storage read: over-limit domains (to block) and domains inside the
   * warn window (to notify, with their remaining seconds).
   *
   * Note: because flushes are clamped (MAX_CREDIT_SECONDS), after sleep
   * or hibernate a warning can surface slightly later than wall-clock
   * time would suggest — the same accounting the blocker inherits.
   *
   * @returns {Promise<UsageEvaluation>}
   */
  async evaluate() {
    const [settings, usage] = await Promise.all([
      this.repository.getSettings(),
      this.repository.getAllUsage(),
    ]);
    const today = todayKey();
    /** @type {string[]} */
    const overLimit = [];
    /** @type {{domain: string, secondsRemaining: number}[]} */
    const warnings = [];
    for (const [domain, site] of Object.entries(settings.sites)) {
      if (!site.enabled || site.limitMinutes <= 0) continue;
      const record = usage[domain];
      if (record && record.date === today) {
        if (record.secondsUsed >= site.limitMinutes * 60) {
          overLimit.push(domain);
          continue;
        }
        if (
          LimitPolicy.isInWarnWindow(
            site,
            record,
            (settings.warnMinutesBefore ?? 0) * 60,
          )
        ) {
          warnings.push({
            domain,
            secondsRemaining: LimitPolicy.secondsRemaining(site, record),
          });
        }
      }
    }
    return { overLimit, warnings };
  }

  /** @returns {Promise<string|null>} base domain of the focused tab, if managed */
  async detectActiveDomain() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!tab || !tab.url) return null;
      return DomainMatcher.extractBaseDomain(tab.url);
    } catch {
      return null;
    }
  }
}
