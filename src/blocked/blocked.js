/**
 * Block page controller. Shows which domain triggered the block (from the
 * query string set by the SiteBlocker redirect rule), plus a rotating
 * learning card. Cards come from the bundled deck (cards.json) merged
 * with feed items cached by the background worker (key 'cardFeed');
 * filtered to the user's chosen topics (settings.cardTopics). User
 * feedback — opening an article (👍) or "Not for me" (👎) — feeds back
 * into per-topic weights and a disliked-card list via recordFeedback.
 * Every card-related failure must degrade gracefully to the static
 * message —
 * the block itself always works, and this page never touches the network.
 */

import { rotateCard, cardsForTopics, recordFeedback } from './card-picker.js';

const TOPIC_LABELS = {
  wellbeing: 'Wellbeing',
  ai: 'AI',
  focus: 'Focus',
  science: 'Science',
  philosophy: 'Philosophy',
  career: 'Career',
};

/** @returns {Promise<{version: number, cards: Array}|null>} */
async function loadDeck() {
  try {
    const res = await fetch('cards.json');
    if (!res.ok) return null;
    const deck = await res.json();
    return Array.isArray(deck?.cards) ? deck : null;
  } catch {
    return null;
  }
}

/**
 * Reads the worker's feed cache and the user's topic prefs.
 * @returns {Promise<{feedCards: Array, topics: string[]}>}
 */
async function loadPrefsAndFeed() {
  try {
    const { settings, cardFeed } = await chrome.storage.local.get([
      'settings',
      'cardFeed',
    ]);
    const feedCards = Object.values(cardFeed?.byTopic ?? {}).flat();
    return { feedCards, topics: settings?.cardTopics ?? null };
  } catch {
    return { feedCards: [], topics: null };
  }
}

const cardSection = document.getElementById('card');
/** The card currently on screen — the target of any 👍/👎 feedback. */
let currentCard = null;

/** Fills the card UI. Text only via textContent; href behind a scheme guard. */
function renderCard(card) {
  const badge = document.getElementById('card-badge');
  const source = document.getElementById('card-source');
  const title = document.getElementById('card-title');
  const blurb = document.getElementById('card-blurb');
  const link = document.getElementById('card-link');

  badge.textContent = TOPIC_LABELS[card.topic] ?? card.topic ?? 'Read';
  badge.className = `badge topic-${card.topic ?? 'other'}`;
  source.textContent = card.source ?? '';
  source.hidden = !card.source;
  title.textContent = card.title;
  blurb.textContent = card.blurb ?? '';
  blurb.hidden = !card.blurb;

  if (/^https?:\/\//.test(card.url)) {
    link.href = card.url;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }

  cardSection.hidden = false;
  currentCard = card;
  const intro = document.getElementById('card-intro');
  if (intro) intro.hidden = false;
  // Restart the entrance animation on every card swap.
  cardSection.style.animation = 'none';
  void cardSection.offsetWidth;
  cardSection.style.animation = '';
}

/** Wires the block page: domain label first, card second (best effort). */
async function init() {
  const domain = new URLSearchParams(window.location.search).get('domain');
  if (domain) document.getElementById('domain').textContent = domain;

  const [deck, { feedCards, topics }] = await Promise.all([
    loadDeck(),
    loadPrefsAndFeed(),
  ]);
  const allCards = [
    ...(deck?.cards ?? []),
    ...feedCards,
  ];
  if (allCards.length === 0) return; // static message stands alone

  const pool = cardsForTopics(allCards, topics);
  const anotherBtn = document.getElementById('another');
  const notForMeBtn = document.getElementById('not-for-me');
  if (pool.length < 2) {
    anotherBtn.hidden = true;
    notForMeBtn.hidden = true;
  }

  const show = async () => {
    const card = await rotateCard(pool);
    if (card) renderCard(card);
  };

  // 👍 is implicit: opening the article is the positive signal.
  document
    .getElementById('card-link')
    .addEventListener('click', () => void recordFeedback(currentCard, 'like'));
  // 👎 is explicit: exclude the card and demote its topic, then move on.
  notForMeBtn.addEventListener('click', () => {
    void recordFeedback(currentCard, 'dislike');
    void show();
  });
  anotherBtn.addEventListener('click', () => void show());
  await show();
}

init().catch(() => {
  // A card bug must never blank the page; the static message is already
  // rendered, so just keep the card hidden.
  if (cardSection) cardSection.hidden = true;
  const intro = document.getElementById('card-intro');
  if (intro) intro.hidden = true;
});
