/**
 * Owns the declarativeNetRequest dynamic rules that block over-limit sites.
 * Single responsibility: translating over-limit domains into redirect rules.
 */

import { BLOCKED_PAGE_URL, RULE_ID_BASE } from './config.js';

export class SiteBlocker {
  constructor() {
    /** @type {Set<string>} domains currently blocked */
    this.blockedDomains = new Set();
  }

  /**
   * Syncs the active DNR rules to exactly the given set of over-limit domains.
   * @param {Iterable<string>} overLimitDomains
   */
  async sync(overLimitDomains) {
    const targets = new Set(overLimitDomains);
    const toRemove = [...this.blockedDomains].filter((d) => !targets.has(d));
    const toAdd = [...targets].filter((d) => !this.blockedDomains.has(d));

    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: toRemove.map((d) => SiteBlocker.ruleIdFor(d)),
      });
      toRemove.forEach((d) => this.blockedDomains.delete(d));
    }

    if (toAdd.length > 0) {
      const addRules = toAdd.map((domain) => ({
        id: SiteBlocker.ruleIdFor(domain),
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { url: SiteBlocker.blockedUrlFor(domain) },
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['main_frame'],
        },
      }));
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules,
      });
      toAdd.forEach((d) => this.blockedDomains.add(d));
    }
  }

  /** Restores in-memory state from persisted rules (service-worker restarts). */
  async hydrate() {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    this.blockedDomains = new Set(
      rules
        .filter((r) => r.id >= RULE_ID_BASE)
        .map((r) => r.condition?.requestDomains?.[0])
        .filter(Boolean),
    );
  }

  /** Clears every rule this extension manages (called on uninstall of state / full reset). */
  async clearAll() {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const ids = rules.map((r) => r.id);
    if (ids.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
    }
    this.blockedDomains.clear();
  }

  /**
   * Deterministic stable rule id per domain so add/remove stays consistent
   * across service-worker restarts (DNR ids are numbers, domains are strings,
   * so we hash).
   * @param {string} domain
   */
  static ruleIdFor(domain) {
    let hash = 0;
    for (let i = 0; i < domain.length; i += 1) {
      hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
    }
    return RULE_ID_BASE + (hash % 100000);
  }

  /**
   * @param {string} domain
   */
  static blockedUrlFor(domain) {
    const target = new URL(chrome.runtime.getURL(BLOCKED_PAGE_URL));
    target.searchParams.set('domain', domain);
    return target.toString();
  }
}
