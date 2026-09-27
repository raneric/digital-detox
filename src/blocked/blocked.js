/**
 * Block page controller. Shows which domain triggered the block (from the
 * query string set by the SiteBlocker redirect rule), plus a rotating
 * learning card. Every card-related failure must degrade gracefully to
 * the static message — the block itself always works.
 */

import { rotateCard } from './card-picker.js';

const TOPIC_LABELS = { wellbeing: 'Wellbeing', ai: 'AI' };

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

const cardSection = document.getElementById('card');

/** Fills the card UI. Text only via textContent; href behind a scheme guard. */
function renderCard(card) {
  const badge = document.getElementById('card-badge');
  const source = document.getElementById('card-source');
  const title = document.getElementById('card-title');
  const blurb = document.getElementById('card-blurb');
  const link = document.getElementById('card-link');

  badge.textContent = TOPIC_LABELS[card.topic] ?? 'Read';
  badge.className = `badge ${card.topic === 'ai' ? 'ai' : 'wellbeing'}`;
  source.textContent = card.source ?? '';
  title.textContent = card.title;
  blurb.textContent = card.blurb;

  if (/^https?:\/\//.test(card.url)) {
    link.href = card.url;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }

  cardSection.hidden = false;
  // Restart the entrance animation on every card swap.
  cardSection.style.animation = 'none';
  void cardSection.offsetWidth;
  cardSection.style.animation = '';
}

/** Wires the block page: domain label first, card second (best effort). */
async function init() {
  const domain = new URLSearchParams(window.location.search).get('domain');
  if (domain) document.getElementById('domain').textContent = domain;

  const deck = await loadDeck();
  if (!deck) return; // static message stands alone

  const anotherBtn = document.getElementById('another');
  if (deck.cards.length < 2) anotherBtn.hidden = true;

  const show = async () => {
    const card = await rotateCard(deck.cards);
    if (card) renderCard(card);
  };

  anotherBtn.addEventListener('click', () => void show());
  await show();
}

init().catch(() => {
  // A card bug must never blank the page; the static message is already
  // rendered, so just keep the card hidden.
  if (cardSection) cardSection.hidden = true;
});
