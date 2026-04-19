export function cleanAnalyticsMeta(meta = {}) {
  const cleaned = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  });
  return cleaned;
}

export function toCountMapString(counts = {}) {
  return Object.entries(counts || {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
}

export function countTextLines(value = "") {
  const text = String(value || "");
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

export function summarizeText(value = "", prefix = "input") {
  const text = String(value || "");
  return {
    [`${prefix}_size`]: text.length,
    [`${prefix}_line_count`]: countTextLines(text),
  };
}

export function summarizeFiles(files = []) {
  const list = Array.isArray(files) ? files : Array.from(files || []);
  const typeCounts = {};
  const extensionCounts = {};
  let totalSize = 0;

  list.forEach((file) => {
    const type = String(file?.type || "unknown").trim() || "unknown";
    const name = String(file?.name || "");
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "none";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    extensionCounts[extension] = (extensionCounts[extension] || 0) + 1;
    totalSize += Number(file?.size || 0) || 0;
  });

  return {
    file_count: list.length,
    total_size: totalSize,
    file_types: toCountMapString(typeCounts),
    file_extensions: toCountMapString(extensionCounts),
  };
}

export function getObjectShapeMeta(value) {
  if (Array.isArray(value)) {
    return {
      top_level_type: "array",
      item_count: value.length,
      key_count: 0,
    };
  }
  if (value && typeof value === "object") {
    return {
      top_level_type: "object",
      item_count: 0,
      key_count: Object.keys(value).length,
    };
  }
  return {
    top_level_type: value === null ? "null" : typeof value,
    item_count: 0,
    key_count: 0,
  };
}
