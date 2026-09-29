/**
 * Fires the "N minutes left" warning notification, once per domain per
 * day. Like everything that must survive MV3 worker restarts, the
 * already-warned state lives in persisted storage (`warned` flags), not
 * in memory.
 *
 * Ordering: the flag is written BEFORE the notification is created
 * (at-most-once — a worker killed between create and flag-write is the
 * duplicate window), and rolled back if the create fails so the next
 * flush tick retries. The deterministic notification id is the second
 * line of defense: a stray re-create replaces instead of stacking.
 */

import { todayKey } from './limit-policy.js';
import { NOTIFICATION_ICON } from './config.js';

export class WarnNotifier {
  /** @param {import('./repository.js').UsageRepository} repository */
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * Sends warnings for every domain in the list that has not been
   * warned today yet. Failures never propagate — a missed warning is
   * cosmetic compared to blocking, which always runs first.
   * @param {{domain: string, secondsRemaining: number}[]} warnings
   */
  async sync(warnings) {
    if (!warnings || warnings.length === 0) return;
    const today = todayKey();
    const flags = await this.repository.getWarnedFlags();
    for (const { domain, secondsRemaining } of warnings) {
      if (flags[domain] === today) continue;
      await this.repository.markWarned(domain, today);
      try {
        await this.create(domain, secondsRemaining);
      } catch {
        // Create failed: undo the flag so the next tick retries.
        await this.repository.clearWarnedFlag(domain);
      }
    }
  }

  /**
   * Creates one warning notification. Uses the callback form of
   * notifications.create (the promisified API is unreliable across
   * Chrome versions) and rejects when Chrome reports an error.
   * @param {string} domain
   * @param {number} secondsRemaining
   * @returns {Promise<void>}
   */
  create(domain, secondsRemaining) {
    const minutes = Math.max(1, Math.round(secondsRemaining / 60));
    return new Promise((resolve, reject) => {
      chrome.notifications.create(`reelrest-warn-${domain}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
        title: 'ReelRest',
        message: `Only ${minutes} min left on ${domain} today`,
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }
}
