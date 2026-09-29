/**
 * Single-responsibility wrapper around chrome.storage.local.
 * The rest of the codebase depends on this interface, not on the
 * chrome.* API directly, so storage can be swapped or mocked (DIP).
 */

import { TOPIC_FEEDS, DEFAULT_WARN_MINUTES } from './config.js';

const KEYS = Object.freeze({
  SETTINGS: 'settings',
  USAGE: 'usage',
  WARNED: 'warned',
});

class UsageRepository {
  /**
   * @returns {Promise<Settings>}
   */
  async getSettings() {
    const result = await chrome.storage.local.get(KEYS.SETTINGS);
    // Merge with defaults so new fields are always present.
    return { ...defaultSettings, ...(result[KEYS.SETTINGS] ?? {}) };
  }

  /** @param {Settings} settings */
  async saveSettings(settings) {
    await chrome.storage.local.set({ [KEYS.SETTINGS]: settings });
  }

  /**
   * @param {string} domain
   * @returns {Promise<UsageRecord|null>}
   */
  async getUsage(domain) {
    const result = await chrome.storage.local.get(KEYS.USAGE);
    return result[KEYS.USAGE]?.[domain] ?? null;
  }

  /**
   * Atomically upserts one site's usage record.
   * @param {string} domain
   * @param {(prev: UsageRecord|null) => UsageRecord} updater
   */
  async updateUsage(domain, updater) {
    const result = await chrome.storage.local.get(KEYS.USAGE);
    const all = result[KEYS.USAGE] ?? {};
    all[domain] = updater(all[domain] ?? null);
    await chrome.storage.local.set({ [KEYS.USAGE]: all });
    return all[domain];
  }

  /** @returns {Promise<Record<string, UsageRecord>>} */
  async getAllUsage() {
    const result = await chrome.storage.local.get(KEYS.USAGE);
    return result[KEYS.USAGE] ?? {};
  }

  /**
   * Resets usage for one domain, or for all domains when omitted.
   * Also clears the matching limit-warning flags so a warning can fire
   * again after an (honest) reset.
   * @param {string} [domain]
   */
  async resetUsage(domain) {
    if (domain) {
      await this.updateUsage(domain, (prev) => ({
        date: prev?.date ?? '',
        secondsUsed: 0,
      }));
      await this.clearWarnedFlag(domain);
      return;
    }
    await chrome.storage.local.set({ [KEYS.USAGE]: {}, [KEYS.WARNED]: {} });
  }

  /**
   * @returns {Promise<Record<string, string>>} domain → 'YYYY-MM-DD'
   * the last limit warning was sent on
   */
  async getWarnedFlags() {
    const result = await chrome.storage.local.get(KEYS.WARNED);
    return result[KEYS.WARNED] ?? {};
  }

  /**
   * Records that a limit warning was sent for a domain today.
   * @param {string} domain
   * @param {string} date 'YYYY-MM-DD'
   */
  async markWarned(domain, date) {
    const result = await chrome.storage.local.get(KEYS.WARNED);
    const flags = result[KEYS.WARNED] ?? {};
    flags[domain] = date;
    await chrome.storage.local.set({ [KEYS.WARNED]: flags });
  }

  /**
   * Removes one domain's warning flag so today's warning can fire again.
   * @param {string} domain
   */
  async clearWarnedFlag(domain) {
    const result = await chrome.storage.local.get(KEYS.WARNED);
    const flags = result[KEYS.WARNED] ?? {};
    if (!(domain in flags)) return;
    delete flags[domain];
    await chrome.storage.local.set({ [KEYS.WARNED]: flags });
  }
}

/**
 * @typedef {Object} SiteLimit
 * @property {string} domain       Match domain (subdomains included automatically)
 * @property {number} limitMinutes Daily limit in minutes; 0 = unlimited
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} Settings
 * @property {Record<string, SiteLimit>} sites Keyed by domain
 * @property {string[]} cardTopics             Topics shown on the block page
 * @property {number} warnMinutesBefore        Warn this many minutes before a
 *                                             limit hits; 0 = warnings off
 */

/** All card topics; also the default cardTopics value. Derived from TOPIC_FEEDS to stay in sync. */
export const ALL_CARD_TOPICS = Object.freeze(Object.keys(TOPIC_FEEDS));

/** @type {Settings} */
const defaultSettings = Object.freeze({
  sites: {
    'facebook.com': { domain: 'facebook.com', limitMinutes: 30, enabled: true },
    'instagram.com': { domain: 'instagram.com', limitMinutes: 30, enabled: true },
    'x.com': { domain: 'x.com', limitMinutes: 30, enabled: true },
    'twitter.com': { domain: 'twitter.com', limitMinutes: 30, enabled: true },
    'youtube.com': { domain: 'youtube.com', limitMinutes: 60, enabled: true },
    'tiktok.com': { domain: 'tiktok.com', limitMinutes: 30, enabled: true },
    'reddit.com': { domain: 'reddit.com', limitMinutes: 30, enabled: true },
    'linkedin.com': { domain: 'linkedin.com', limitMinutes: 15, enabled: true },
  },
  cardTopics: [...ALL_CARD_TOPICS],
  warnMinutesBefore: DEFAULT_WARN_MINUTES,
});

/**
 * @typedef {Object} UsageRecord
 * @property {string} date        ISO date (YYYY-MM-DD) the usage belongs to
 * @property {number} secondsUsed Accumulated seconds for that date
 */

export const repository = new UsageRepository();
export { KEYS, defaultSettings };
