/**
 * Pure decision logic: given settings + usage, is a site over its limit?
 * Single responsibility, no side effects, trivially unit-testable (SRP/DIP).
 */

/** @returns {string} Local calendar day as YYYY-MM-DD */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class LimitPolicy {
  /**
   * @param {import('./repository.js').SiteLimit} site
   * @param {import('./repository.js').UsageRecord|null} usage
   * @returns {boolean}
   */
  static isOverLimit(site, usage) {
    if (!site.enabled || site.limitMinutes <= 0) return false;
    if (!usage || usage.date !== todayKey()) return false;
    return usage.secondsUsed >= site.limitMinutes * 60;
  }

  /**
   * @param {import('./repository.js').SiteLimit} site
   * @param {import('./repository.js').UsageRecord|null} usage
   * @returns {number} seconds remaining today (0 when over limit)
   */
  static secondsRemaining(site, usage) {
    if (!site.enabled || site.limitMinutes <= 0) return Infinity;
    const secondsToday =
      usage && usage.date === todayKey() ? usage.secondsUsed : 0;
    return Math.max(0, site.limitMinutes * 60 - secondsToday);
  }

  /**
   * Normalizes a usage record to today (resets stale days).
   * @param {import('./repository.js').UsageRecord|null} prev
   * @param {number} secondsToAdd
   */
  static accumulate(prev, secondsToAdd) {
    const today = todayKey();
    const secondsUsed =
      prev && prev.date === today ? prev.secondsUsed + secondsToAdd : secondsToAdd;
    return { date: today, secondsUsed };
  }
}
