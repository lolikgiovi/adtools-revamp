export function isToolVisibleToUser(toolId) {
  if (toolId !== "run-query" && toolId !== "run-batch") return true;
  try {
    return (
      String(localStorage.getItem("user.department") || "")
        .trim()
        .toUpperCase() === "RETAIL"
    );
  } catch (_) {
    return false;
  }
}
