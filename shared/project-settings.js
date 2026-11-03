/** Ownership is shared by Settings, tools, and publication handling. */
export function isProjectSetting(key) {
  return (
    [
      "config.environments",
      "config.baseUrls",
      "config.oracle.connections",
      "config.jira.projectKey",
      "config.jira.projectKeys",
      "config.lockeyPath",
      "config.lockeyDomains",
      "masterLockeyBase",
      "secure.redis.password",
    ].includes(key) ||
    [
      "config.redis.",
      "config.mergeSql.",
      "config.velocityValidator.",
      "tool:kafka:",
      "tool:redis-cache:",
      "config.oracle.environment.",
    ].some((prefix) => key.startsWith(prefix))
  );
}
