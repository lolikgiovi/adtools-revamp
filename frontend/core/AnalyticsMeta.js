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

export function bucketCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count === 0) return "0";
  if (count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 100) return "51-100";
  if (count <= 500) return "101-500";
  if (count <= 1_000) return "501-1000";
  return "1000+";
}

export function bucketDepth(value) {
  const depth = Math.max(0, Number(value) || 0);
  if (depth === 0) return "0";
  if (depth <= 2) return "1-2";
  if (depth <= 5) return "3-5";
  if (depth <= 10) return "6-10";
  return "11+";
}

export function bucketSize(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size === 0) return "0";
  if (size < 1_000) return "<1K";
  if (size < 10_000) return "1K-10K";
  if (size < 100_000) return "10K-100K";
  if (size < 1_000_000) return "100K-1M";
  return "1M+";
}

export function getJsonComplexityMeta(value, maxNodes = 10_000) {
  const queue = [{ value, depth: 0 }];
  let cursor = 0;
  let visited = 0;
  let maxDepth = 0;
  let objectCount = 0;
  let arrayCount = 0;
  let fieldCount = 0;
  let leafCount = 0;

  while (cursor < queue.length && visited < maxNodes) {
    const current = queue[cursor];
    cursor += 1;
    visited += 1;
    maxDepth = Math.max(maxDepth, current.depth);

    if (Array.isArray(current.value)) {
      arrayCount += 1;
      current.value.forEach((item) => queue.push({ value: item, depth: current.depth + 1 }));
    } else if (current.value && typeof current.value === "object") {
      objectCount += 1;
      const values = Object.values(current.value);
      fieldCount += values.length;
      values.forEach((item) => queue.push({ value: item, depth: current.depth + 1 }));
    } else {
      leafCount += 1;
    }
  }

  return {
    max_depth: maxDepth,
    max_depth_bucket: bucketDepth(maxDepth),
    object_count: objectCount,
    array_count: arrayCount,
    field_count: fieldCount,
    field_count_bucket: bucketCount(fieldCount),
    leaf_count: leafCount,
    complexity_truncated: cursor < queue.length,
  };
}
