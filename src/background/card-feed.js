/**
 * Keeps the learning-card feed cache fresh. Fetches Medium per-tag RSS
 * for the user's chosen topics (only on a stale TTL — no dedicated
 * alarm), parses items with regex because MV3 service workers have no
 * DOMParser, and caches to chrome.storage.local. The bundled deck in
 * src/blocked/cards.json is always the offline fallback; the block page
 * itself never touches the network.
 */

import { CARD_FEED_KEY, CARD_REFRESH_TTL_MS, TOPIC_FEEDS } from './config.js';

const MEDIUM_FEED_BASE = 'https://medium.com/feed/tag/';

/**
 * Stable feed-item id: FNV-1a 32-bit hex of the URL (sync, no DOM,
 * same spirit as SiteBlocker.ruleIdFor).
 * @param {string} url
 * @returns {string}
 */
export function feedItemId(url) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Decodes basic XML entities and strips tags from a snippet. */
function cleanText(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** First <foo>...</foo> or <foo><![CDATA[...]]></foo> content in `block`. */
function extractTag(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`),
  );
  return match ? match[1] : '';
}

/**
 * Parses Medium tag-feed XML into learning cards. Pure and regex-based;
 * items with no usable title/link are skipped.
 * @param {string} xml Raw feed text
 * @param {string} topic Topic id to stamp on each card
 * @returns {import('./card-picker.js').LearningCard[]}
 */
export function parseFeed(xml, topic) {
  if (!xml) return [];
  const cards = [];
  for (const block of xml.split('<item>').slice(1)) {
    const title = cleanText(extractTag(block, 'title'));
    let link = extractTag(block, 'link').trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    // Strip Medium's tracking query off the permalink.
    link = link.split('?')[0];
    const source = cleanText(extractTag(block, 'dc:creator'));
    const snippet = block.match(/medium-feed-snippet">([\s\S]{0,300}?)<\/p>/);
    const blurb = snippet ? cleanText(snippet[1]).slice(0, 200) : '';
    const pubDate = extractTag(block, 'pubDate');
    cards.push({
      id: feedItemId(link),
      topic,
      title,
      blurb,
      url: link,
      source,
      publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
    });
  }
  return cards;
}

/** @returns {Promise<{byTopic: Object, fetchedAt: number}|null>} */
async function readCache() {
  try {
    const result = await chrome.storage.local.get(CARD_FEED_KEY);
    return result[CARD_FEED_KEY] ?? null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the cache when stale. Fetches only the user's chosen topics,
 * silently skipping any feed that fails (bundled deck covers the gap).
 * @param {import('./repository.js').Settings} settings
 * @param {number} [now=Date.now()] Injectable for tests
 * @returns {Promise<void>}
 */
export async function maybeRefresh(settings, now = Date.now()) {
  const topics = (settings.cardTopics ?? []).filter((t) => TOPIC_FEEDS[t]);
  const cache = await readCache();
  if (cache && topics.length > 0 && now - cache.fetchedAt < CARD_REFRESH_TTL_MS) {
    return;
  }
  const byTopic = {};
  await Promise.all(
    topics.map(async (topic) => {
      try {
        const res = await fetch(MEDIUM_FEED_BASE + TOPIC_FEEDS[topic]);
        if (!res.ok) return;
        const xml = await res.text();
        const items = parseFeed(xml, topic).slice(0, 20);
        if (items.length > 0) byTopic[topic] = items;
      } catch {
        // Offline or feed unavailable: the bundled deck covers it.
      }
    }),
  );
  if (Object.keys(byTopic).length === 0) return;
  try {
    await chrome.storage.local.set({
      [CARD_FEED_KEY]: { byTopic, fetchedAt: now },
    });
  } catch {
    // Cache write is best-effort; nothing breaks without it.
  }
}

/** @returns {Promise<import('./card-picker.js').LearningCard[]>} */
export async function getCachedCards() {
  const cache = await readCache();
  if (!cache?.byTopic) return [];
  return Object.values(cache.byTopic).flat();
}
