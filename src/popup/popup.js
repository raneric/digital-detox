/**
 * Popup controller. Talks to the service worker exclusively through
 * messages (separation of concerns), and renders from state.
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

const listEl = document.getElementById("site-list");
const rowTemplate = document.getElementById("site-row");
const addForm = document.getElementById("add-form");

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
    this.nameEl = this.root.querySelector(".site-name");
    this.usageEl = this.root.querySelector(".usage");
    this.limitEl = this.root.querySelector(".limit");

    this.nameEl.textContent = site.domain;
    this.nameEl.classList.toggle("over-limit", this.overLimit);
    this.limitEl.value = String(site.limitMinutes);
    this.usageEl.textContent = SiteRow.formatUsage(usage, site, this.overLimit);

    this.limitEl.addEventListener("change", () => {
      onChange({
        ...site,
        limitMinutes: Math.max(0, Number(this.limitEl.value) || 0),
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

  static formatUsage(usage, site, overLimit) {
    const mins = usage?.secondsUsed ? Math.floor(usage.secondsUsed / 60) : 0;
    if (overLimit) return `used ${mins} m — blocked until tomorrow`;
    return `${mins} m used of ${site.limitMinutes || "∞"}`;
  }
}

/** Loads state and renders the site list. */
async function render() {
  const { settings, usage } = await BackgroundClient.getState();
  listEl.replaceChildren(
    ...Object.values(settings.sites).map((site) => {
      const row = new SiteRow(site, usage[site.domain] ?? null, {
        onChange: (updated) => persist(updated),
        onRemove: () => remove(site.domain),
        onReset: () => resetOne(site.domain),
      });
      return row.render();
    })
  );
}

/**
 * Updates one site entry and saves. A site that is removed from the
 * settings can no longer accrue usage — its usage record is dropped too.
 * @param {import('../background/repository.js').SiteLimit} site
 */
async function persist(site) {
  const { settings } = await BackgroundClient.getState();
  settings.sites[site.domain] = site;
  await BackgroundClient.saveSettings(settings);
}

/** @param {string} domain */
async function remove(domain) {
  const { settings } = await BackgroundClient.getState();
  delete settings.sites[domain];
  await BackgroundClient.saveSettings(settings);
  await render();
}

/** @param {string} [domain] */
async function resetOne(domain) {
  await BackgroundClient.resetUsage(domain);
  await render();
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const domain = document
    .getElementById("new-domain")
    .value.trim()
    .toLowerCase();
  const limitMinutes = Math.max(
    0,
    Number(document.getElementById("new-limit").value) || 0
  );
  const { settings } = await BackgroundClient.getState();
  if (settings.sites[domain]) {
    settings.sites[domain].limitMinutes = limitMinutes;
  } else {
    settings.sites[domain] = { domain, limitMinutes, enabled: true };
  }
  await BackgroundClient.saveSettings(settings);
  addForm.reset();
  document.getElementById("new-limit").value = "30";
  await render();
});

document.getElementById("reset-all").addEventListener("click", async () => {
  await BackgroundClient.resetUsage();
  await render();
});

render();
