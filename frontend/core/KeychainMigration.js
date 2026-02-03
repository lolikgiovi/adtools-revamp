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
const ORACLE_MIGRATION_FLAG_KEY = "keychain.oracle.unified.migrated";

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
 * @returns {Promise<{migrated: boolean, jenkinsToken: boolean, confluencePat: boolean, oracle: boolean}>}
 */
export async function migrateToUnifiedKeychain() {
  // Skip if not running in Tauri
  if (!isTauri()) {
    return { migrated: false, jenkinsToken: false, confluencePat: false, oracle: false };
  }

  const needsBaseMigration = !hasMigrated();
  const needsOracleMigration = localStorage.getItem(ORACLE_MIGRATION_FLAG_KEY) !== "true";

  // Skip if all migrations already done
  if (!needsBaseMigration && !needsOracleMigration) {
    return { migrated: false, jenkinsToken: false, confluencePat: false, oracle: false };
  }

  try {
    // Get username from localStorage (already migrated there)
    const username = localStorage.getItem("config.jenkins.username") || "";

    // Call Rust backend to perform migration (idempotent - handles all credential types)
    const result = await invoke("migrate_to_unified_keychain", { username });

    console.log("[KeychainMigration] Migration result:", result);

    // Mark base migration as done if:
    // 1. Something was actually migrated, OR
    // 2. Unified secrets already existed (already_unified = true)
    // Note: We do NOT mark as migrated for no_credentials - new users will have migration
    // triggered again after they save credentials for the first time, which is fine.
    // This ensures we don't incorrectly mark as migrated if user cancelled the keychain prompt.
    if (result.migrated_jenkins || result.migrated_confluence || result.already_unified) {
      setMigrated();
    }

    // Mark Oracle migration as done separately (existing users already have base flag set)
    if (result.migrated_oracle || result.already_has_oracle) {
      localStorage.setItem(ORACLE_MIGRATION_FLAG_KEY, "true");
    }

    return {
      migrated: result.migrated_jenkins || result.migrated_confluence || result.migrated_oracle,
      jenkinsToken: result.migrated_jenkins,
      confluencePat: result.migrated_confluence,
      oracle: result.migrated_oracle,
    };
  } catch (err) {
    // Don't mark as migrated on error - user may have cancelled the keychain prompt
    // This allows retry on next app launch
    console.debug("[KeychainMigration] Migration failed or skipped:", err);
    return { migrated: false, jenkinsToken: false, confluencePat: false, oracle: false };
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
