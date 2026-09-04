export function getUsageAccessState({ registered = false, hasIdentity = false } = {}) {
  const isRegistered = Boolean(registered);
  const identityAvailable = Boolean(hasIdentity);
  return {
    isRegistered,
    hasIdentity: identityAvailable,
    canViewDashboard: isRegistered,
    teamComparison: identityAvailable ? "available" : "unavailable",
  };
}

const IGNORED_TOOL_IDS = new Set(["velocity-template"]);
const TOOL_ALIASES = Object.freeze({
  "jenkins-runner": "run-query",
  master_lockey: "master-lockey",
  json_tools: "json-tools",
});

/**
 * Normalize usage overview payloads from either the local tracker or the API.
 *
 * The renderer receives both raw API-shaped rows and already-normalized local
 * rows, so this boundary intentionally accepts all supported row shapes.
 */
export function normalizeUsageScope(scope = {}, resolveToolName = (id) => id) {
  const toolRows = Array.isArray(scope.tools) ? scope.tools : [];
  const parsedRows = toolRows.map((row) => {
    const id = String(row?.toolId || row?.tool_id || row?.id || "unknown").trim();
    const count = Number(row?.count);
    return {
      id: id || "unknown",
      normalizedId: (id || "unknown").toLowerCase(),
      count: Number.isFinite(count) && count > 0 ? Math.round(count) : 0,
    };
  });
  const rawToolIds = new Set(parsedRows.map((row) => row.normalizedId));
  const ignoredToolIds = new Set();
  const suppressedAliasIds = new Set();
  let excludedToolTotal = 0;
  const countsByTool = new Map();

  parsedRows.forEach((row) => {
    if (IGNORED_TOOL_IDS.has(row.normalizedId)) {
      ignoredToolIds.add(row.normalizedId);
      excludedToolTotal += row.count;
      return;
    }

    const canonicalId = TOOL_ALIASES[row.normalizedId] || row.id;
    if (TOOL_ALIASES[row.normalizedId] && rawToolIds.has(canonicalId)) {
      suppressedAliasIds.add(row.normalizedId);
      excludedToolTotal += row.count;
      return;
    }

    countsByTool.set(canonicalId, (countsByTool.get(canonicalId) || 0) + row.count);
  });

  const tools = [...countsByTool]
    .map(([id, count]) => ({
      id,
      count,
      name: resolveToolName(id),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));

  const daily = Array.isArray(scope.daily)
    ? scope.daily
        .map((row) => ({ day: String(row?.day || ""), count: Number(row?.count) }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(row.count) && row.count > 0)
    : Object.entries(scope.daily || {})
        .map(([day, values]) => ({
          day,
          count: Object.values(values || {}).reduce((sum, value) => sum + (Number(value) || 0), 0),
        }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && row.count > 0);

  const toolTotal = tools.reduce((sum, row) => sum + row.count, 0);
  const total = Number(scope.totalActivities);
  const toolsUsed = Number(scope.toolsUsed);
  const activeUsers = Number(scope.activeUsers);

  return {
    totalActivities: Number.isFinite(total) && total >= 0 ? Math.max(0, Math.round(total) - excludedToolTotal) : toolTotal,
    toolsUsed:
      Number.isFinite(toolsUsed) && toolsUsed >= 0
        ? Math.max(0, Math.round(toolsUsed) - ignoredToolIds.size - suppressedAliasIds.size)
        : tools.length,
    activeUsers: Number.isFinite(activeUsers) && activeUsers > 0 ? Math.round(activeUsers) : 0,
    lastUpdated: scope.lastUpdated ? String(scope.lastUpdated) : null,
    tools,
    daily,
  };
}
