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

export class UsageTracker {
  /**
   * @param {import('./repository.js').UsageRepository} repository
   * @param {(domains: Iterable<string>) => Promise<void>} onUsageChanged
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
    await this.onUsageChanged(this.overLimitDomains());
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

  /** @returns {Promise<Iterable<string>>} domains currently over limit */
  async overLimitDomains() {
    const [settings, usage] = await Promise.all([
      this.repository.getSettings(),
      this.repository.getAllUsage(),
    ]);
    const today = todayKey();
    return Object.entries(settings.sites)
      .filter(([domain, site]) => {
        if (!site.enabled || site.limitMinutes <= 0) return false;
        const record = usage[domain];
        return (
          record &&
          record.date === today &&
          record.secondsUsed >= site.limitMinutes * 60
        );
      })
      .map(([domain]) => domain);
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
