/** Shared constants for the background service worker. */

export const BLOCKED_PAGE_URL = 'src/blocked/blocked.html';
/** DNR rule ids are numeric; reserved range avoids colliding with static rules. */
export const RULE_ID_BASE = 100000;
/** How often accumulated usage is flushed to storage (minutes). */
export const FLUSH_INTERVAL_MINUTES = 0.5;
/** Grace period added to each flush tick so the user isn't cut off mid-page-load. */
export const WARN_BEFORE_BLOCK_SECONDS = 0;
