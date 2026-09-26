/**
 * Extracts and matches domains. Single responsibility: nothing here knows
 * about storage, limits, or blocking.
 */

export class DomainMatcher {
  /**
   * Extracts the registrable-looking base domain from a URL
   * (e.g. "www.instagram.com/p/123" -> "instagram.com").
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
   * Strips a leading "www." and keeps the last two labels
   * (a pragmatic approximation of the public suffix list that is
   * sufficient for the social-media domains this extension manages).
   * @param {string} host
   */
  static toBaseDomain(host) {
    const labels = host.replace(/^www\./, '').split('.');
    return labels.slice(-2).join('.');
  }

  /** @param {string} host */
  static isIpAddress(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  }
}
