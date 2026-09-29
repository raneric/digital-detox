/**
 * Popup controller. Talks to the service worker exclusively through
 * messages (separation of concerns) and renders from state.
 *
 * The same page serves two modes:
 *  - popup mode (default): view usage and adjust limits only - no
 *    reset or delete buttons rendered, to reduce temptation.
 *  - options mode (?view=options, opened in a tab via the footer link):
 *    destructive actions (reset usage / remove site) are available,
 *    each behind a confirmation dialog.
 */

/**
 * Thin client over the runtime messaging protocol. Matches the message
 * types handled in background/main.js.
 */
class BackgroundClient {
  /** @returns {Promise<{settings: object, usage: object}>} */
  static getState() {
    return chrome.runtime.sendMessage({ type: "GET_STATE" });
  }

  /** @param {object} settings */
  static saveSettings(settings) {
    return chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  }

  /** @param {string} [domain] */
  static resetUsage(domain) {
    return chrome.runtime.sendMessage({ type: "RESET_USAGE", domain });
  }
}

const IS_OPTIONS_MODE =
  new URLSearchParams(location.search).get("view") === "options";

const listEl = document.getElementById("site-list");
const rowTemplate = document.getElementById("site-row");
const addForm = document.getElementById("add-form");
const emptyEl = document.getElementById("empty-state");
const confirmDialog = document.getElementById("confirm-dialog");
const topicsSection = document.getElementById("topics-section");
const topicsList = document.getElementById("topics-list");
const warnSection = document.getElementById("warn-section");
const warnMinutesInput = document.getElementById("warn-minutes");

const TOPIC_LABELS = {
  wellbeing: "Wellbeing",
  ai: "AI",
  focus: "Focus",
  science: "Science",
  philosophy: "Philosophy",
  career: "Career",
  space: "Space",
  history: "History",
  design: "Design",
  money: "Money",
  writing: "Writing",
  creativity: "Creativity",
};

if (IS_OPTIONS_MODE) {
  document.body.classList.add("options-mode");
}

/** Browser-style confirmation via <dialog>. Resolves true when accepted. */
function confirmAction(message) {
  return new Promise((resolve) => {
    confirmDialog.querySelector(".dialog-text").textContent = message;
    const yes = confirmDialog.querySelector(".confirm-yes");
    const no = confirmDialog.querySelector(".confirm-no");
    const done = (result) => {
      confirmDialog.close();
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      confirmDialog.removeEventListener("close", onClose);
      resolve(result);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    const onClose = () => done(false); // Esc key
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    confirmDialog.addEventListener("close", onClose);
    confirmDialog.showModal();
  });
}

/**
 * Shown when the user raises a daily limit — raising your own screen-time
 * cap deserves a little friendly judgement. {domain}, {extra} and {total}
 * are filled in by extendExcuse(); a random one is picked each time.
 * @type {string[]}
 */
const EXTEND_EXCUSES = [
  "'Just {extra} more minutes' ; the most expensive sentence on the internet. Extend {domain} to {total} min?",
  "{domain} just did a happy little dance. It knows something you don't. Grant {extra} more minutes?",
  "Your future self just sighed from 2043. Extend {domain} to {total} min?",
  "Breaking news: local human negotiates with their own attention span. Extend {domain} by {extra} min?",
  "{domain} has requested {extra} more minutes of your one wild and precious life. Approve?",
  "Plot twist: in {extra} minutes you'll be deep in 'just one more video' territory. Extend {domain} anyway?",
  "The doomscroll demands a tribute: {extra} more minutes. Pay {domain} its ransom?",
  "Adding {extra} min to {domain}. This dialog will judge you silently either way. Confirm?",
];

/**
 * Builds the confirmation message for raising a site's daily limit.
 * @param {string} domain
 * @param {number} oldLimit previous limit in minutes
 * @param {number} newLimit new limit in minutes
 * @returns {string}
 */
function extendExcuse(domain, oldLimit, newLimit) {
  const message =
    EXTEND_EXCUSES[Math.floor(Math.random() * EXTEND_EXCUSES.length)];
  return message
    .replaceAll("{domain}", domain)
    .replaceAll("{extra}", String(newLimit - oldLimit))
    .replaceAll("{total}", String(newLimit));
}

/** One row of UI bound to one site entry. */
class SiteRow {
  /**
   * @param {import('../background/repository.js').SiteLimit} site
   * @param {import('../background/repository.js').UsageRecord|null} usage
   * @param {(site: import('../background/repository.js').SiteLimit) => void} onChange
   * @param {() => void} onRemove
   * @param {() => void} onReset
   */
  constructor(site, usage, { onChange, onRemove, onReset }) {
    this.site = site;
    this.usage = usage;
    this.overLimit = SiteRow.isOverLimit(site, usage);

    this.root = rowTemplate.content.cloneNode(true);
    const nameEl = this.root.querySelector(".site-name");
    const usageEl = this.root.querySelector(".usage");
    const fillEl = this.root.querySelector(".progress-fill");
    const limitEl = this.root.querySelector(".limit");
    const limitLabelEl = this.root.querySelector(".limit-label");

    nameEl.textContent = site.domain;
    nameEl.classList.toggle("over-limit", this.overLimit);
    limitEl.value = String(site.limitMinutes);
    limitLabelEl.textContent = site.limitMinutes
      ? site.limitMinutes + " min / day"
      : "unlimited";
    usageEl.textContent = SiteRow.formatUsage(usage, site, this.overLimit);
    usageEl.classList.toggle("over-limit", this.overLimit);

    const ratio = SiteRow.progressRatio(site, usage);
    fillEl.style.width = `${Math.round(ratio * 100)}%`;
    fillEl.classList.toggle("warn", ratio >= 0.7 && ratio < 1);
    fillEl.classList.toggle("over", ratio >= 1);

    limitEl.addEventListener("change", async () => {
      const newLimit = Math.max(0, Number(limitEl.value) || 0);
      // Raising a limit is a tempting-thing-by-design: confirm it, and only
      // persist on acceptance. Lowering stays friction-free.
      if (IS_OPTIONS_MODE && newLimit > site.limitMinutes) {
        const ok = await confirmAction(
          extendExcuse(site.domain, site.limitMinutes, newLimit),
        );
        if (!ok) {
          limitEl.value = String(site.limitMinutes); // revert on cancel
          return;
        }
      }
      onChange({
        ...site,
        limitMinutes: newLimit,
      });
    });
    this.root.querySelector(".remove").addEventListener("click", onRemove);
    this.root.querySelector(".reset").addEventListener("click", onReset);
  }

  /** @returns {Node} */
  render() {
    return this.root;
  }

  /**
   * The policy itself lives in the background worker (single source of
   * truth); the popup only mirrors the same pure rule for display.
   */
  static isOverLimit(site, usage) {
    if (!site.enabled || site.limitMinutes <= 0) return false;
    if (!usage) return false;
    const today = new Date();
    const key = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    return usage.date === key && usage.secondsUsed >= site.limitMinutes * 60;
  }

  /** @returns {number} fraction of the daily limit consumed, 0..1+ */
  static progressRatio(site, usage) {
    if (!site.enabled || site.limitMinutes <= 0) return 0;
    const secondsToday =
      usage && usage.date === SiteRow.todayKey() ? usage.secondsUsed : 0;
    return secondsToday / (site.limitMinutes * 60);
  }

  static todayKey() {
    const t = new Date();
    return [
      t.getFullYear(),
      String(t.getMonth() + 1).padStart(2, "0"),
      String(t.getDate()).padStart(2, "0"),
    ].join("-");
  }

  static formatUsage(usage, site, overLimit) {
    const mins =
      usage && usage.secondsUsed ? Math.floor(usage.secondsUsed / 60) : 0;
    if (overLimit) return "used " + mins + " m - blocked until tomorrow";
    return mins + " m used of " + (site.limitMinutes || "unlimited");
  }
}

/**
 * Options mode only: topic checkboxes for the block-page learning cards.
 * Uses SAVE_SETTINGS like every other settings change.
 */
async function renderTopics(settings) {
  if (!IS_OPTIONS_MODE) return;
  topicsSection.hidden = false;
  const chosen = new Set(settings.cardTopics ?? []);
  const topics = Object.keys(TOPIC_LABELS);
  topicsList.replaceChildren(
    ...topics.map((topic) => {
      const label = document.createElement("label");
      label.className = "topic-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = chosen.has(topic);
      box.addEventListener("change", async () => {
        const next = box.checked
          ? [...chosen, topic]
          : [...chosen].filter((t) => t !== topic);
        chosen.clear();
        next.forEach((t) => chosen.add(t));
        const { settings: current } = await BackgroundClient.getState();
        current.cardTopics = [...chosen];
        await BackgroundClient.saveSettings(current);
      });
      const text = document.createElement("span");
      text.textContent = TOPIC_LABELS[topic];
      label.append(box, text);
      return label;
    }),
  );
}

/**
 * Options mode only: the global "warn N minutes before the limit"
 * setting. Uses SAVE_SETTINGS like every other settings change.
 */
async function renderWarnSetting(settings) {
  if (!IS_OPTIONS_MODE) return;
  warnSection.hidden = false;
  warnMinutesInput.value = String(settings.warnMinutesBefore ?? 0);
}

warnMinutesInput.addEventListener("change", async () => {
  const { settings: current } = await BackgroundClient.getState();
  current.warnMinutesBefore = Math.max(
    0,
    Math.min(120, Number(warnMinutesInput.value) || 0),
  );
  await BackgroundClient.saveSettings(current);
});

/** Loads state and renders the site list. */
async function render() {
  const { settings, usage } = await BackgroundClient.getState();
  const sites = Object.values(settings.sites);
  emptyEl.hidden = sites.length > 0;
  await renderTopics(settings);
  await renderWarnSetting(settings);
  listEl.replaceChildren(
    ...sites.map((site) => {
      const row = new SiteRow(site, usage[site.domain] || null, {
        onChange: (updated) => persist(updated),
        onRemove: () => removeSite(site.domain),
        onReset: () => resetOne(site.domain),
      });
      return row.render();
    }),
  );
}

/**
 * Updates one site entry and saves. A site that is removed from the
 * settings can no longer accrue usage - its usage record is dropped too.
 * @param {import('../background/repository.js').SiteLimit} site
 */
async function persist(site) {
  const { settings } = await BackgroundClient.getState();
  settings.sites[site.domain] = site;
  await BackgroundClient.saveSettings(settings);
}

/** @param {string} domain */
async function removeSite(domain) {
  if (IS_OPTIONS_MODE) {
    const ok = await confirmAction(
      'Remove "' + domain + '"? Its usage history will be deleted too.',
    );
    if (!ok) return;
  }
  const { settings } = await BackgroundClient.getState();
  delete settings.sites[domain];
  await BackgroundClient.saveSettings(settings);
  await render();
}

/** @param {string} [domain] */
async function resetOne(domain) {
  if (IS_OPTIONS_MODE) {
    const ok = await confirmAction(
      "Reset today's usage" +
        (domain ? ' for "' + domain + '"?' : " for ALL sites?"),
    );
    if (!ok) return;
  }
  await BackgroundClient.resetUsage(domain);
  await render();
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const domainInput = document.getElementById("new-domain");
  const limitInput = document.getElementById("new-limit");
  const domain = domainInput.value.trim().toLowerCase();
  const limitMinutes = Math.max(0, Number(limitInput.value) || 0);
  const { settings } = await BackgroundClient.getState();
  if (settings.sites[domain]) {
    const oldLimit = settings.sites[domain].limitMinutes;
    // Same friction as editing a row: raising an existing limit needs
    // confirmation, in popup mode too (the form is the only editor there).
    if (limitMinutes > oldLimit) {
      const ok = await confirmAction(
        extendExcuse(domain, oldLimit, limitMinutes),
      );
      if (!ok) return;
    }
    settings.sites[domain].limitMinutes = limitMinutes;
  } else {
    settings.sites[domain] = { domain, limitMinutes, enabled: true };
  }
  await BackgroundClient.saveSettings(settings);
  addForm.reset();
  limitInput.value = "30";
  await render();
});

document
  .getElementById("reset-all")
  .addEventListener("click", () => resetOne());

render();
