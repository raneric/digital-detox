/** Shared constants for the background service worker. */

export const BLOCKED_PAGE_URL = "src/blocked/blocked.html";
/** DNR rule ids are numeric; reserved range avoids colliding with static rules. */
export const RULE_ID_BASE = 100000;
/** How often accumulated usage is flushed to storage (minutes). */
export const FLUSH_INTERVAL_MINUTES = 0.5;
/** Grace period added to each flush tick so the user isn't cut off mid-page-load. */
export const WARN_BEFORE_BLOCK_SECONDS = 0;

// --- Learning cards ---------------------------------------------------------

/** chrome.storage.local key holding the fetched-feed card cache. */
export const CARD_FEED_KEY = "cardFeed";
/** Re-fetch feeds when the cache is older than this. */
export const CARD_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
/** Public Medium per-tag RSS feeds backing each card topic. */
export const TOPIC_FEEDS = Object.freeze({
  wellbeing: "psychology",
  ai: "artificial-intelligence",
  focus: "focus",
  science: "science",
  philosophy: "philosophy",
  career: "careers",
  space: "space",
  history: "history",
  design: "design",
  money: "money",
  writing: "writing",
  creativity: "creativity",
});
