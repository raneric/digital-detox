/**
 * Picks learning cards for the block page. Selection is a pure function
 * (unit-testable); the storage-backed wrapper keeps a seen-list so the
 * same card doesn't repeat until the deck is exhausted, and folds user
 * feedback (implicit 👍 on "Read the article", explicit 👎 on "Not for
 * me") into per-topic weights and a disliked-card exclusion list.
 */

/** How much a card can be boosted by repeated 👍 on its topic. */
const LIKE_CAP = 4;
/** Floor for a topic's weight, so a hated topic can still surface rarely. */
const WEIGHT_FLOOR = 0.15;
/** Neutral weight for topics with no feedback yet. */
const DEFAULT_SCORE = 1;
/** Disliked-card ids are kept bounded; oldest entries fall off first. */
const DISLIKED_CAP = 200;

/**
 * @typedef {Object} CardState
 * @property {string[]} seenIds
 * @property {string[]} dislikedIds
 * @property {Object<string, number>} topicScores
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
 * Applies one 👍/👎 to a topic's weight. Pure. Likes grow linearly up to
 * LIKE_CAP; dislikes halve the score down to WEIGHT_FLOOR, so every
 * topic keeps a nonzero chance of coming back.
 * @param {Object<string, number>} topicScores
 * @param {string} topic
 * @param {'like'|'dislike'} feedback
 * @returns {Object<string, number>} New scores object (input untouched)
 */
export function applyTopicFeedback(topicScores, topic, feedback) {
  const next = { ...topicScores };
  const current =
    typeof next[topic] === 'number' && next[topic] > 0 ? next[topic] : DEFAULT_SCORE;
  next[topic] =
    feedback === 'like'
      ? Math.min(current + 1, LIKE_CAP)
      : Math.max(current * 0.5, WEIGHT_FLOOR);
  return next;
}

/** Random pick from `pool`, proportional to per-topic weights. A topic's
 * weight is split evenly across its cards, so a topic with more cards
 * doesn't dominate just by having more entries — P(topic) ∝ its score. */
function weightedPick(pool, topicScores, rng) {
  if (!topicScores) return pool[Math.floor(rng() * pool.length)];
  const countByTopic = new Map();
  for (const card of pool) {
    const key = card?.topic ?? '\0untopicked';
    countByTopic.set(key, (countByTopic.get(key) ?? 0) + 1);
  }
  let total = 0;
  const weights = pool.map((card) => {
    const score = topicScores[card?.topic];
    const topicScore =
      typeof score === 'number' && score > 0 ? score : DEFAULT_SCORE;
    const weight = topicScore / (countByTopic.get(card?.topic ?? '\0untopicked') ?? 1);
    total += weight;
    return weight;
  });
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Picks a card the user hasn't seen and hasn't disliked; when all unseen
 * cards are gone it wraps around to everything except disliked cards, so
 * the selection never dries up. With topicScores set, the pick is
 * weighted: a 👍-ed topic shows up proportionally more often, a 👎-ed
 * topic less.
 * @param {LearningCard[]} cards
 * @param {string[]} seenIds
 * @param {{excludedIds?: string[], topicScores?: Object<string, number>|null, rng?: () => number}} [options]
 * @returns {PickResult}
 */
export function pickNext(cards, seenIds, options = {}) {
  const { excludedIds = [], topicScores = null, rng = Math.random } = options;
  if (!Array.isArray(cards) || cards.length === 0) return null;
  // No feedback recorded yet -> plain uniform pick, same as before.
  const scores =
    topicScores && Object.keys(topicScores).length > 0 ? topicScores : null;
  const excluded = new Set(excludedIds);
  const unseen = cards.filter(
    (c) => c?.id && !seenIds.includes(c.id) && !excluded.has(c.id),
  );
  const pool =
    unseen.length > 0
      ? unseen
      : cards.filter((c) => c?.id && !excluded.has(c.id));
  const finalPool = pool.length > 0 ? pool : cards;
  const card = weightedPick(finalPool, scores, rng);
  const nextSeen = unseen.length > 0 ? [...seenIds, card.id] : [card.id];
  return { card, nextSeen };
}

/** @returns {Promise<CardState>} */
async function readCardState() {
  const fallback = { seenIds: [], dislikedIds: [], topicScores: {} };
  try {
    const result = await chrome.storage.local.get('cardState');
    const state = result?.cardState ?? {};
    return {
      seenIds: Array.isArray(state.seenIds) ? state.seenIds : [],
      dislikedIds: Array.isArray(state.dislikedIds) ? state.dislikedIds : [],
      topicScores: state.topicScores ?? {},
    };
  } catch {
    return fallback;
  }
}

/**
 * Reads state, picks the next card, and persists the updated seen-list.
 * Storage failures degrade to showing the card without state.
 * @param {LearningCard[]} cards
 * @returns {Promise<LearningCard|null>}
 */
export async function rotateCard(cards) {
  const state = await readCardState();
  const picked = pickNext(cards, state.seenIds, {
    excludedIds: state.dislikedIds,
    topicScores: state.topicScores,
  });
  if (!picked) return null;
  try {
    await chrome.storage.local.set({
      cardState: { ...state, seenIds: picked.nextSeen },
    });
  } catch {
    // Worst case is a repeat next time; never block the card.
  }
  return picked.card;
}

/**
 * Records user feedback for the card currently on screen. A 👍 ("Read
 * the article" click) only boosts the topic; a 👎 ("Not for me") also
 * excludes the card id from future picks. Fire-and-forget friendly:
 * every failure is swallowed — feedback must never break the page.
 * @param {LearningCard|null} card
 * @param {'like'|'dislike'} feedback
 * @returns {Promise<void>}
 */
export async function recordFeedback(card, feedback) {
  if (!card) return;
  try {
    const state = await readCardState();
    const topicScores = card.topic
      ? applyTopicFeedback(state.topicScores, card.topic, feedback)
      : state.topicScores;
    const dislikedIds =
      feedback === 'dislike' && card.id
        ? [...state.dislikedIds, card.id].slice(-DISLIKED_CAP)
        : state.dislikedIds;
    await chrome.storage.local.set({
      cardState: { ...state, topicScores, dislikedIds },
    });
  } catch {
    // Feedback is best-effort; the block page works without it.
  }
}
