import { PLAIN, WILDCARD, EXCEPTION } from './public-suffixes.js';

// Set lookups are O(1); built once per module load.
const PLAIN_SET = new Set(PLAIN);
const WILDCARD_SET = new Set(WILDCARD);
const EXCEPTION_SET = new Set(EXCEPTION);

/**
 * Extracts and matches domains. Single responsibility: nothing here knows
 * about storage, limits, or blocking.
 */
export class DomainMatcher {
  /**
   * Extracts the registrable base domain from a URL
   * (e.g. "www.instagram.com/p/123" -> "instagram.com",
   * "www.bbc.co.uk/news" -> "bbc.co.uk").
   * @param {string} url
   * @returns {string|null} null when the URL is not a matchable http(s) page
   */
  static extractBaseDomain(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    // Extension/blank pages have no host.
    if (!host || host === 'localhost' || DomainMatcher.isIpAddress(host)) {
      return null;
    }
    return DomainMatcher.toBaseDomain(host);
  }

  /**
   * True when `host` is `baseDomain` or a subdomain of it.
   * @param {string} host
   * @param {string} baseDomain
   */
  static matches(host, baseDomain) {
    const base = DomainMatcher.toBaseDomain(host);
    return base === baseDomain;
  }

  /**
   * Registers the registrable domain of `host` per the Public Suffix List
   * algorithm (https://publicsuffix.org/list/, "Algorithm" section).
   * Rules are checked longest-first; the prevailing rule determines the
   * public suffix, and the registrable domain is the suffix plus one
   * preceding label. Only the multi-label rules are stored — a single
   * trailing label (e.g. "com") is always a valid suffix by default.
   * @param {string} host
   */
  static toBaseDomain(host) {
    const labels = host.split('.');

    // Exceptions win outright: "<suffix>" is itself registrable
    // (e.g. "!city.kawasaki.jp" -> "city.kawasaki.jp" is registrable).
    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.');
      if (EXCEPTION_SET.has(rest)) {
        return rest;
      }
    }

    // Find the prevailing (longest) rule: candidates are scanned
    // longest-first, so the first hit wins. A wildcard rule "*.<base>"
    // matches when the candidate is exactly one label followed by <base>.
    // The default rule "*" (last label only) always applies as fallback.
    let suffixLabelCount = 1;
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join('.');
      const base = labels.slice(i + 1).join('.');
      if (PLAIN_SET.has(candidate) || WILDCARD_SET.has(base)) {
        suffixLabelCount = labels.length - i;
        break;
      }
    }

    // The registrable domain is the suffix plus one preceding label. If the
    // whole host is a public suffix (e.g. "co.uk"), there is none — keep the
    // host as-is so callers still get a stable key.
    const start = labels.length - suffixLabelCount - 1;
    if (start < 0) {
      return host;
    }
    return labels.slice(start).join('.');
  }

  /** @param {string} host */
  static isIpAddress(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  }
}