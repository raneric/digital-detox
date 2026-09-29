/**
 * Syncs settings across devices via chrome.storage.sync.
 *
 * Design notes:
 *  - Only *settings* (sites, card topics, warn lead time) sync. Usage and
 *    warned flags stay local: time spent is inherently per-device, and the
 *    daily-reset semantics would break across timezones.
 *  - Conflict resolution is newest-wins by an `updatedAt` timestamp stored
 *    in the sync snapshot and locally alongside the settings.
 *  - The timestamp doubles as the self-echo guard: our own sync writes
 *    carry the same `updatedAt` that was recorded locally, so the
 *    storage.onChanged handler ignores them. After a worker restart the
 *    reconciliation compares the same timestamps with the same outcome.
 *  - A fresh install (never saved locally, updatedAt === 0) never pushes
 *    its defaults: it either adopts a customized peer's snapshot or waits
 *    for the user's first change, so two devices can't clobber each other
 *    with untailored defaults.
 */

import { KEYS } from './repository.js';

export class SettingsSync {
  /**
   * @param {import('./repository.js').UsageRepository} repository
   * @param {(settings: import('./repository.js').Settings) => Promise<void>} onSettingsAdopted
   *        Called after a remote snapshot is written locally, so the caller
   *        can re-enforce blocking and refresh dependent caches.
   */
  constructor(repository, onSettingsAdopted) {
    this.repository = repository;
    this.onSettingsAdopted = onSettingsAdopted;
  }

  /** Registers the remote-change listener. Called once at worker startup. */
  start() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[KEYS.SETTINGS_SYNC]) {
        void this.adoptRemote().catch(() => {
          // Sync is best effort; the next save or startup reconciles again.
        });
      }
    });
  }

  /**
   * Startup reconciliation: adopt a newer remote snapshot, or publish the
   * local one when it is newer (e.g. changed offline). Idempotent.
   */
  async reconcile() {
    let remote;
    try {
      remote = await this.repository.getSyncedSnapshot();
    } catch {
      return; // sync unavailable (e.g. signed out) — stay local-only
    }
    const localUpdatedAt = await this.repository.getSettingsUpdatedAt();

    if (remote?.settings && remote.updatedAt > localUpdatedAt) {
      await this.adoptRemote();
      return;
    }
    if (localUpdatedAt > 0 && (!remote?.settings || remote.updatedAt < localUpdatedAt)) {
      const settings = await this.repository.getSettings();
      await this.repository.pushSettingsToSync(settings, localUpdatedAt);
    }
  }

  /**
   * Applies the synced snapshot locally when it is newer than what we have.
   * Ignored when the snapshot is our own echo (equal timestamps).
   */
  async adoptRemote() {
    const remote = await this.repository.getSyncedSnapshot();
    if (!remote?.settings) return;
    const localUpdatedAt = await this.repository.getSettingsUpdatedAt();
    if (remote.updatedAt <= localUpdatedAt) return;
    await this.repository.saveLocalSettings(remote.settings, remote.updatedAt);
    await this.onSettingsAdopted(remote.settings);
  }
}