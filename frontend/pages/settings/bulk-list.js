function parseArray(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON. Check commas, quotes, and brackets.");
  }
  if (!Array.isArray(rows)) throw new Error("Use a JSON array.");
  return rows;
}
function unique(rows, key) {
  const keys = rows.map(key);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate entries. Give each item a unique name or key.");
}
function describeChanges(current, next, key) {
  const entries = [];
  for (const row of next) {
    const previous = current.find((value) => key(value) === key(row));
    const change = previous === undefined ? "added" : JSON.stringify(previous) === JSON.stringify(row) ? "unchanged" : "updated";
    entries.push({ name: typeof row === "string" ? row : (row.name ?? row.key), change });
  }
  for (const row of current) {
    if (!next.some((value) => key(row) === key(value)))
      entries.push({ name: typeof row === "string" ? row : (row.name ?? row.key), change: "removed" });
  }
  const summary = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  entries.forEach((entry) => {
    summary[entry.change] += 1;
  });
  return { entries, summary, next, snapshot: JSON.stringify(current) };
}
export function buildListPlan(text, current, type, validate) {
  const rows = parseArray(text);
  const next = rows.map((row, index) => {
    if (type === "string-list") {
      if (typeof row !== "string" || !row.trim()) throw new Error(`Item ${index + 1}: enter a non-empty string.`);
      return row.trim();
    }
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !["key", "value"].includes(key)) ||
      typeof row.key !== "string" ||
      !row.key.trim() ||
      typeof row.value !== "string" ||
      !row.value.trim()
    ) {
      throw new Error(`Item ${index + 1}: use an object with non-empty key and value strings.`);
    }
    return { key: row.key.trim(), value: row.value.trim() };
  });
  const key = type === "string-list" ? (value) => value.toLowerCase() : (value) => value.key;
  unique(next, key);
  const result = validate(next);
  if (!result.valid) throw new Error(result.message);
  return describeChanges(current, next, key);
}
export function buildKafkaPlan(text, current) {
  const rows = parseArray(text).map((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !["name", "brokers"].includes(key)) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.trim().length > 48 ||
      typeof row.brokers !== "string" ||
      !row.brokers.trim()
    ) {
      throw new Error(`Broker ${index + 1}: use name (up to 48 characters) and brokers strings.`);
    }
    return { name: row.name.trim(), brokers: row.brokers.trim() };
  });
  unique(rows, (row) => row.name.toLowerCase());
  const next = current.map((row) => ({ ...row }));
  for (const row of rows) {
    const index = next.findIndex((value) => value.name.toLowerCase() === row.name.toLowerCase());
    if (index >= 0) next[index] = { id: next[index].id, ...row };
    else next.push({ id: crypto.randomUUID(), ...row });
  }
  return describeChanges(current, next, (row) => row.id);
}
export async function applyListPlan(plan, read, write) {
  if (JSON.stringify(read()) !== plan.snapshot) throw new Error("Saved items changed. Generate a new preview before applying.");
  write(plan.next);
  if (JSON.stringify(read()) !== JSON.stringify(plan.next))
    throw new Error("Could not verify saved items. Review the list before retrying.");
}
