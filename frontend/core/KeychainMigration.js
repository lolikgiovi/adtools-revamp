/**
 * Keychain Migration Helper
 *
 * Handles one-time migration from multiple keychain entries to a unified keychain entry.
 * This reduces the number of password prompts after app updates.
 *
 * Old structure:
 * - ad-tools:jenkins/__username__ (migrated to localStorage separately)
 * - ad-tools:jenkins/{username} (Jenkins API token)
 * - ad-tools:confluence/pat (Confluence PAT)
 *
 * New structure:
 * - ad-tools:credentials/secrets (JSON: {"jenkins_token": "...", "confluence_pat": "..."})
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./Runtime.js";

const MIGRATION_FLAG_KEY = "keychain.unified.migrated";

/**
 * Check if migration has already been completed
 */
export function hasMigrated() {
  return localStorage.getItem(MIGRATION_FLAG_KEY) === "true";
}

/**
 * Mark migration as completed
 */
function setMigrated() {
  localStorage.setItem(MIGRATION_FLAG_KEY, "true");
}

/**
 * Perform the unified keychain migration.
 * This should be called from entry points: Settings, Run Query, Run Batch, Master Lockey.
 *
 * @returns {Promise<{migrated: boolean, jenkinsToken: boolean, confluencePat: boolean}>}
 */
export async function migrateToUnifiedKeychain() {
  // Skip if not running in Tauri
  if (!isTauri()) {
    return { migrated: false, jenkinsToken: false, confluencePat: false };
  }

  // Skip if already migrated
  if (hasMigrated()) {
    return { migrated: false, jenkinsToken: false, confluencePat: false };
  }

  try {
    // Get username from localStorage (already migrated there)
    const username = localStorage.getItem("config.jenkins.username") || "";

    // Call Rust backend to perform migration
    const result = await invoke("migrate_to_unified_keychain", { username });

    console.log("[KeychainMigration] Migration result:", result);

    // Mark as migrated if:
    // 1. Something was actually migrated, OR
    // 2. Unified secrets already existed (already_unified = true), OR
    // 3. No credentials exist anywhere (new user - nothing to migrate)
    // This ensures we don't mark as migrated if user cancelled the keychain prompt
    if (result.migrated_jenkins || result.migrated_confluence || result.already_unified || result.no_credentials) {
      setMigrated();
    }

    return {
      migrated: result.migrated_jenkins || result.migrated_confluence,
      jenkinsToken: result.migrated_jenkins,
      confluencePat: result.migrated_confluence,
    };
  } catch (err) {
    // Don't mark as migrated on error - user may have cancelled the keychain prompt
    // This allows retry on next app launch
    console.debug("[KeychainMigration] Migration failed or skipped:", err);
    return { migrated: false, jenkinsToken: false, confluencePat: false };
  }
}

/**
 * Ensure migration is complete before proceeding.
 * This is a convenience wrapper that handles errors silently.
 */
export async function ensureUnifiedKeychain() {
  try {
    await migrateToUnifiedKeychain();
  } catch (_) {
    // Silent fail - migration is best-effort
  }
}
