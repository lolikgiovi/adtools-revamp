/**
 * Lockey Update service.
 *
 * LOCALIZATION.LANGUAGE_PACK_VERSION holds one row per deployed language-pack
 * version; LOCALIZATION.LANGUAGE_PACK_UPDATE holds the key/value rows that
 * belong to a version. Versions are allocated globally (max + 1) and can never
 * be reused. This module joins the ledger, validates a batch, and renders the
 * Oracle INSERT statements.
 */

export const LANGUAGE_PACK_VERSION_TABLE = "LOCALIZATION.LANGUAGE_PACK_VERSION";
export const LANGUAGE_PACK_UPDATE_TABLE = "LOCALIZATION.LANGUAGE_PACK_UPDATE";

export const VERSION_ID_FIELD = "LANGUAGE_PACK_VERSION_ID";

const VERSION_WIDTH = 10;
const RELEASE_ID_PATTERN = /^\d+\.\d+\.\d+$/;
const KEY_WIDTH = 100;
const VALUE_WIDTH = 1500;
const AUDIT_WIDTH = 50;

export const MAX_RELEASE_TARGETS = 4;

function byteLength(value) {
  return new TextEncoder().encode(String(value)).length;
}

/** True when a release id fits the x.x.x format and the column width. */
export function isValidReleaseId(value) {
  const normalized = String(value ?? "").trim();
  return RELEASE_ID_PATTERN.test(normalized) && byteLength(normalized) <= VERSION_WIDTH;
}

function normalizeReleaseTargets(releaseTargets) {
  return (Array.isArray(releaseTargets) ? releaseTargets : []).map((target) => String(target ?? "").trim()).filter(Boolean);
}

function versionNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDraftRow(row) {
  return {
    key: String(row?.key ?? "").trim(),
    idValue: String(row?.idValue ?? row?.id ?? row?.ID_VALUE ?? ""),
    enValue: String(row?.enValue ?? row?.en ?? row?.EN_VALUE ?? ""),
  };
}

/**
 * Join both tables, detect data anomalies, and annotate each update with what
 * changed relative to the previous version of the same key.
 */
export function analyzeLedger(ledger = {}) {
  const versions = Array.isArray(ledger.versions) ? ledger.versions : [];
  const updates = Array.isArray(ledger.updates) ? ledger.updates : [];

  const versionIdCounts = new Map();
  const versionNumberCounts = new Map();
  const versionsById = new Map();
  const invalidVersions = [];
  let maxVersion = 0;

  versions.forEach((version) => {
    const id = String(version[VERSION_ID_FIELD] ?? "").trim();
    if (id) versionIdCounts.set(id, (versionIdCounts.get(id) || 0) + 1);

    const number = versionNumber(version.LANGUAGE_PACK_VERSION);
    if (number === null) {
      invalidVersions.push(version);
    } else {
      maxVersion = Math.max(maxVersion, number);
      versionNumberCounts.set(number, (versionNumberCounts.get(number) || 0) + 1);
    }

    if (id && !versionsById.has(id)) versionsById.set(id, version);
  });

  const usedVersionIds = new Set();
  const joined = [];
  const orphans = [];

  updates.forEach((update) => {
    const id = String(update?.[VERSION_ID_FIELD] ?? "").trim();
    const version = versionsById.get(id);
    if (!version) {
      orphans.push(update);
      return;
    }
    usedVersionIds.add(id);
    const number = versionNumber(version.LANGUAGE_PACK_VERSION);
    joined.push({
      updateId: String(update.LANGUAGE_PACK_UPDATE_ID ?? ""),
      versionId: id,
      version: number === null ? -1 : number,
      releaseId: String(version.RELEASE_ID ?? ""),
      key: String(update.LOCALIZATION_KEY ?? ""),
      idValue: String(update.ID_VALUE ?? ""),
      enValue: String(update.EN_VALUE ?? ""),
      createdTime: String(update.CREATED_TIME ?? ""),
      updatedTime: String(update.UPDATED_TIME ?? ""),
      raw: update,
      changes: { isNewKey: false, id: false, en: false },
      duplicateKeyInVersion: false,
    });
  });

  const ascending = [...joined].sort((left, right) => {
    if (left.version !== right.version) return left.version - right.version;
    if (left.key !== right.key) return left.key.localeCompare(right.key);
    return left.updatedTime.localeCompare(right.updatedTime);
  });

  const previousByKey = new Map();
  const keyCounts = new Map();
  ascending.forEach((row) => {
    const previous = previousByKey.get(row.key);
    row.changes = previous
      ? {
          isNewKey: false,
          id: previous.idValue !== row.idValue,
          en: previous.enValue !== row.enValue,
        }
      : { isNewKey: true, id: false, en: false };
    previousByKey.set(row.key, { idValue: row.idValue, enValue: row.enValue });

    const occurrenceKey = `${row.versionId}\u0000${row.key}`;
    keyCounts.set(occurrenceKey, (keyCounts.get(occurrenceKey) || 0) + 1);
  });
  ascending.forEach((row) => {
    row.duplicateKeyInVersion = (keyCounts.get(`${row.versionId}\u0000${row.key}`) || 0) > 1;
  });

  const history = [...ascending].sort((left, right) => {
    if (left.version !== right.version) return right.version - left.version;
    if (left.key !== right.key) return left.key.localeCompare(right.key);
    return right.updatedTime.localeCompare(left.updatedTime);
  });

  const versionsWithoutUpdates = versions.filter((version) => {
    const id = String(version[VERSION_ID_FIELD] ?? "").trim();
    return id && !usedVersionIds.has(id);
  });

  const duplicateVersionNumbers = Array.from(versionNumberCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((left, right) => left - right);

  const duplicateVersionIds = Array.from(versionIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const releases = Array.from(new Set(versions.map((version) => String(version.RELEASE_ID ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true }),
  );

  return {
    versions,
    updates,
    versionsById,
    history,
    orphans,
    versionsWithoutUpdates,
    invalidVersions,
    duplicateVersionNumbers,
    duplicateVersionIds,
    releases,
    maxVersion,
  };
}

/**
 * Validate a batch across up to MAX_RELEASE_TARGETS release ids. Every target
 * receives its own version row, so duplicates would create identical releases.
 * Version allocation happens in the database through the MAX + 1 subquery.
 */
export function validateBatch({ releaseTargets = [], auditUser = "SYSTEM", rows = [] } = {}) {
  const errors = [];
  const warnings = [];

  const normalizedTargets = normalizeReleaseTargets(releaseTargets);
  const targetErrors = normalizedTargets.map(() => []);
  const normalizedAudit = String(auditUser ?? "").trim();
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map(normalizeDraftRow)
    .filter((row) => row.key !== "" || row.idValue !== "" || row.enValue !== "");

  if (normalizedTargets.length === 0) {
    errors.push("Add at least one release target.");
  } else if (normalizedTargets.length > MAX_RELEASE_TARGETS) {
    errors.push(`Up to ${MAX_RELEASE_TARGETS} release targets per batch.`);
  }

  const seenTargets = new Set();
  normalizedTargets.forEach((target, index) => {
    const label = `Release target ${index + 1} (${target})`;
    if (!RELEASE_ID_PATTERN.test(target)) {
      targetErrors[index].push(`${label}: must use the x.x.x format (for example 2.0.29).`);
    } else if (byteLength(target) > VERSION_WIDTH) {
      targetErrors[index].push(`${label}: must be ${VERSION_WIDTH} characters or fewer (got ${byteLength(target)}).`);
    }

    if (seenTargets.has(target)) {
      targetErrors[index].push(`${label}: duplicate release target.`);
    } else {
      seenTargets.add(target);
    }
  });
  targetErrors.forEach((messages) => errors.push(...messages));

  if (!normalizedAudit) {
    errors.push("Audit trail is required.");
  } else if (byteLength(normalizedAudit) > AUDIT_WIDTH) {
    errors.push(`Audit trail must be ${AUDIT_WIDTH} characters or fewer.`);
  }

  if (normalizedRows.length === 0) {
    errors.push("Add at least one localization key to the batch.");
  }

  const seenKeys = new Map();
  const seenLowerKeys = new Map();
  normalizedRows.forEach((row, index) => {
    const rowLabel = row.key ? `"${row.key}"` : `row ${index + 1}`;
    if (!row.key) {
      errors.push(`${rowLabel}: localization key is required.`);
    } else if (byteLength(row.key) > KEY_WIDTH) {
      errors.push(`${rowLabel}: localization key exceeds ${KEY_WIDTH} characters.`);
    }

    if (byteLength(row.idValue) > VALUE_WIDTH) {
      errors.push(`${rowLabel}: ID_VALUE exceeds ${VALUE_WIDTH} characters (${byteLength(row.idValue)}).`);
    }
    if (byteLength(row.enValue) > VALUE_WIDTH) {
      errors.push(`${rowLabel}: EN_VALUE exceeds ${VALUE_WIDTH} characters (${byteLength(row.enValue)}).`);
    }
    if (!row.idValue.trim()) {
      warnings.push(`${rowLabel}: ID_VALUE is empty.`);
    }
    if (!row.enValue.trim()) {
      warnings.push(`${rowLabel}: EN_VALUE is empty.`);
    }

    if (row.key) {
      if (seenKeys.has(row.key)) {
        errors.push(`Duplicate localization key "${row.key}" in one version. Each key can appear only once per version.`);
      } else {
        seenKeys.set(row.key, index);
      }

      const lower = row.key.toLowerCase();
      if (seenLowerKeys.has(lower) && seenLowerKeys.get(lower) !== row.key) {
        warnings.push(`Keys "${seenLowerKeys.get(lower)}" and "${row.key}" differ only by case.`);
      } else if (!seenLowerKeys.has(lower)) {
        seenLowerKeys.set(lower, row.key);
      }
    }
  });

  const releaseInvalid =
    normalizedTargets.length === 0 ||
    normalizedTargets.length > MAX_RELEASE_TARGETS ||
    targetErrors.some((messages) => messages.length > 0);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    releaseTargets: normalizedTargets,
    targets: normalizedTargets.map((releaseId, index) => ({ releaseId, errors: targetErrors[index] })),
    invalidFields: {
      releaseTargets: releaseInvalid,
      auditUser: !normalizedAudit || byteLength(normalizedAudit) > AUDIT_WIDTH,
    },
    auditUser: normalizedAudit,
    rows: normalizedRows,
  };
}

/** Escape a value for an Oracle string literal. */
export function escapeSqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function fallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return fallbackUuid();
}

/**
 * Render the same combined script Quick Query produces for the two
 * localization tables. Each release target gets its own version row and its
 * own copy of the update rows. Versions are allocated by Oracle at execution
 * time, so the statements must run in order and the script is independent of
 * any loaded ledger.
 */
export function generateInsertSql({ releaseTargets = [], auditUser = "SYSTEM", rows = [], uuidFn = newUuid } = {}) {
  const targets = normalizeReleaseTargets(releaseTargets);
  const audit = escapeSqlLiteral(auditUser);
  const lines = ["SET DEFINE OFF;", ""];

  targets.forEach((releaseId, targetIndex) => {
    const versionId = uuidFn();
    lines.push(
      `-- RELEASE_ID ${targetIndex + 1}: ${releaseId}`,
      `INSERT INTO ${LANGUAGE_PACK_VERSION_TABLE} (language_pack_version_id, release_id, language_pack_version, created_by, created_time, updated_by, updated_time)`,
      "VALUES (" +
        `${escapeSqlLiteral(versionId)}, ${escapeSqlLiteral(releaseId)}, ` +
        "(SELECT NVL(MAX(LANGUAGE_PACK_VERSION)+1, 1) FROM LOCALIZATION.LANGUAGE_PACK_VERSION), " +
        `${audit}, SYSDATE, ${audit}, SYSDATE);`,
      "",
    );

    rows.forEach((row) => {
      lines.push(
        `INSERT INTO ${LANGUAGE_PACK_UPDATE_TABLE} (language_pack_update_id, language_pack_version_id, localization_key, id_value, en_value, created_by, created_time, updated_by, updated_time)`,
        "VALUES (" +
          `${escapeSqlLiteral(uuidFn())}, ${escapeSqlLiteral(versionId)}, ${escapeSqlLiteral(row.key)}, ` +
          `${escapeSqlLiteral(row.idValue)}, ${escapeSqlLiteral(row.enValue)}, ${audit}, SYSDATE, ${audit}, SYSDATE);`,
        "",
      );
    });
  });

  const fetchRows = rows.length * targets.length + 10;
  lines.push(
    "------ SELECT Statement --------",
    "SELECT lpv.RELEASE_ID , lpv.LANGUAGE_PACK_VERSION AS VER, lpu.LOCALIZATION_KEY , lpu.ID_VALUE , lpu.EN_VALUE ",
    `FROM ${LANGUAGE_PACK_VERSION_TABLE} lpv`,
    `JOIN ${LANGUAGE_PACK_UPDATE_TABLE} lpu ON lpu.LANGUAGE_PACK_VERSION_ID = lpv.LANGUAGE_PACK_VERSION_ID`,
    "ORDER BY lpv.LANGUAGE_PACK_VERSION DESC",
    `FETCH FIRST ${fetchRows} ROWS ONLY;`,
    "",
    "------ Recently updated versions (last 2 minutes) --------",
    `SELECT * FROM ${LANGUAGE_PACK_VERSION_TABLE} WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE`,
    "ORDER BY updated_time DESC;",
    "",
    "------ Recently updated rows (last 2 minutes) --------",
    `SELECT * FROM ${LANGUAGE_PACK_UPDATE_TABLE} WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE`,
    "ORDER BY updated_time DESC;",
    "",
  );

  return lines.join("\n");
}
