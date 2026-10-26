import config from "../frontend/pages/settings/config.json";

export const DEPARTMENTS = ["RETAIL", "SME", "NBDS", "ENTERPRISE", "PARTNERSHIP", "WHOLESALE"];

function collect(categories) {
  return categories.flatMap((category) => {
    if (["appearance", "updates"].includes(category.id)) return [];
    return [
      ...(category.items || []).filter(
        (item) =>
          !["secret", "action"].includes(item.type) &&
          item.storageKey !== "theme" &&
          !item.storageKey.startsWith("update.") &&
          !item.key.endsWith(".username"),
      ),
      ...collect(category.categories || []),
    ];
  });
}

export const PUBLISHABLE_SETTINGS = collect(config.categories);
const byKey = new Map(PUBLISHABLE_SETTINGS.map((item) => [item.storageKey, item]));

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function text(value, label, max = 4096) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    fail(`${label}: enter valid text (maximum ${max} characters).`);
  }
}
function url(value, label) {
  text(value, label);
  if (!value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label}: enter an HTTP or HTTPS URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail(`${label}: use HTTP or HTTPS without embedded credentials.`);
  }
}
function rows(value, fields, required, label) {
  if (!Array.isArray(value) || value.length > 200) fail(`${label}: use a list with at most 200 entries.`);
  const names = new Set();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((key) => !fields.includes(key))) {
      fail(`${label}: unsupported fields. Credentials cannot be published.`);
    }
    for (const [key, val] of Object.entries(row)) text(val, `${label} ${key}`);
    for (const key of required) if (!row[key]?.trim()) fail(`${label}: ${key} is required.`);
    const name = row.name.trim().toLowerCase();
    if (names.has(name)) fail(`${label}: duplicate name.`);
    names.add(name);
  }
}

export function validateSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || !Object.keys(settings).length) {
    fail("Select at least one setting.");
  }
  for (const [key, value] of Object.entries(settings)) {
    const item = byKey.get(key);
    if (!item) fail(`Setting cannot be published: ${key}`);
    const label = item.label;
    if (item.type === "boolean") {
      if (typeof value !== "boolean") fail(`${label}: use true or false.`);
    } else if (item.type === "number") {
      if (!Number.isInteger(value) || value < item.validation?.min || value > item.validation?.max) fail(`${label}: invalid number.`);
    } else if (item.type === "string-list") {
      if (!Array.isArray(value) || value.length > 200) fail(`${label}: use a list with at most 200 entries.`);
      for (const entry of value) {
        text(entry, label, 255);
        if (!entry.trim()) fail(`${label}: empty entry.`);
      }
    } else if (item.type === "environments") {
      rows(value, ["id", "name", "criticalConnection", "complementaryConnection", "cdnPublicUrl", "cdnDirectUrl"], ["name"], label);
      const ids = value.map((row) => row.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) fail(`${label}: duplicate environment ID.`);
      for (const row of value) {
        url(row.cdnPublicUrl || "", label);
        url(row.cdnDirectUrl || "", label);
      }
    } else if (item.type === "oracle-connections") {
      rows(value, ["name", "connect_string"], ["name", "connect_string"], label);
      for (const row of value) {
        if (/@|\b(?:password|user|userid)\s*=|:\/\//i.test(row.connect_string)) {
          fail(`${label}: use a connection address without credentials.`);
        }
      }
    } else if (item.type === "kafka-brokers") {
      rows(value, ["id", "name", "brokers"], ["name", "brokers"], label);
      for (const row of value) {
        if (!row.brokers.split(",").every((broker) => /^(?:[\w.-]+|\[[a-f\d:]+\]):\d{1,5}$/i.test(broker.trim()))) {
          fail(`${label}: use host:port addresses separated by commas.`);
        }
      }
    } else {
      text(value, label);
      if (item.validation?.required && !value.trim()) fail(`${label}: a value is required.`);
      if (item.validation?.pattern && value && !new RegExp(item.validation.pattern).test(value)) fail(`${label}: invalid value.`);
      if (item.options && !item.options.some((option) => option.value === value)) fail(`${label}: unsupported option.`);
      if (/\.(url|domain)$/.test(key)) url(value, label);
    }
  }
  return settings;
}

export function validatePublication(data) {
  text(data?.title, "Publication name", 120);
  if (!data.title.trim()) fail("Enter a publication name.");
  validateSettings(data.settings);
  const target = data.target;
  if (
    !["emails", "departments"].includes(target?.type) ||
    !Array.isArray(target.values) ||
    !target.values.length ||
    target.values.length > 100
  ) {
    fail("Select 1–100 emails or departments.");
  }
  const values = [
    ...new Set(
      target.values.map((value) => {
        text(value, "Recipient", 255);
        return target.type === "emails" ? value.trim().toLowerCase() : value.trim().toUpperCase();
      }),
    ),
  ].sort();
  if (
    values.some((value) => (target.type === "departments" ? !DEPARTMENTS.includes(value) : !/^[^\s@]+@bankmandiri\.co\.id$/.test(value)))
  ) {
    fail("Use registered Bank Mandiri emails or valid departments.");
  }
  return { title: data.title.trim(), settings: data.settings, target: { type: target.type, values } };
}
