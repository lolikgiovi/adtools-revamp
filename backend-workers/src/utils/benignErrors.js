// Known non-bugs that older clients still report; frontend/core/ErrorMonitor.js drops the same set before sending.
// Monaco cancels superseded async work with "Canceled", browsers report ResizeObserver back-pressure as an error,
// and Monaco's hidden-area view model races itself after edits.
export function isBenignError({ error_name: name, message } = {}) {
  const text = String(message || "");
  return (
    (name === "Canceled" && text === "Canceled") ||
    /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(text) ||
    (/modelLineProjections/.test(text) && /isVisible/.test(text))
  );
}
