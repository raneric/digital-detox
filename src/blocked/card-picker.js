/**
 * Picks learning cards for the block page. Selection is a pure function
 * (unit-testable); the storage-backed wrapper keeps a seen-list so the
 * same card doesn't repeat until the deck is exhausted.
 */

/**
 * @typedef {Object} LearningCard
 * @property {string} id                    Stable slug/id, used for seen-tracking
 * @property {string} topic                 Badge shown on the card
 * @property {string} title
 * @property {string} [blurb]
 * @property {string} url
 * @property {string} [source]              Optional author/publication byline
 */

/** @typedef {{card: LearningCard, nextSeen: string[]}|null} PickResult */

/**
 * Filters a deck down to the user's chosen topics. A null/empty topic
 * list means "no preference" and returns the full deck.
 * @param {LearningCard[]} cards
 * @param {string[]|null|undefined} topics
 * @returns {LearningCard[]}
 */
export function cardsForTopics(cards, topics) {
  if (!Array.isArray(cards)) return [];
  if (!Array.isArray(topics) || topics.length === 0) return cards;
  const chosen = new Set(topics);
  const filtered = cards.filter((c) => c?.topic && chosen.has(c.topic));
  // Safety net: if the prefs match nothing in this deck, show everything.
  return filtered.length > 0 ? filtered : cards;
}

/**
 * Picks a random unseen card; wraps around to the full deck once every
 * card has been seen, so the selection never dries up.
 * @param {LearningCard[]} cards
 * @param {string[]} seenIds
 * @param {() => number} [rng] Injectable for tests
 * @returns {PickResult}
 */
export function pickNext(cards, seenIds, rng = Math.random) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const unseen = cards.filter((c) => c?.id && !seenIds.includes(c.id));
  const pool = unseen.length > 0 ? unseen : cards;
  const card = pool[Math.floor(rng() * pool.length)];
  const nextSeen = unseen.length > 0 ? [...seenIds, card.id] : [card.id];
  return { card, nextSeen };
}

/**
 * Reads the seen-list, picks the next card, and persists the updated
 * list. Storage failures degrade to showing the card without state.
 * @param {LearningCard[]} cards
 * @returns {Promise<LearningCard|null>}
 */
export async function rotateCard(cards) {
  let seenIds = [];
  try {
    const result = await chrome.storage.local.get('cardState');
    seenIds = result?.cardState?.seenIds ?? [];
  } catch {
    seenIds = [];
  }
  const picked = pickNext(cards, seenIds);
  if (!picked) return null;
  try {
    await chrome.storage.local.set({ cardState: { seenIds: picked.nextSeen } });
  } catch {
    // Worst case is a repeat next time; never block the card.
  }
  return picked.card;
}
