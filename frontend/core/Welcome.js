const SEEN_KEY = "welcome.seen.v1";

export function openWelcome({ force = false, onExplore } = {}) {
  let seenKey = SEEN_KEY;
  try {
    seenKey = `${SEEN_KEY}.${String(localStorage.getItem("user.email") || "").trim().toLowerCase()}`;
    if (!force && localStorage.getItem(seenKey) === "true") return false;
  } catch (_) {
    // The welcome can still be shown when browser storage is unavailable.
  }
  if (document.querySelector(".welcome-dialog")) return false;

  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "welcome-dialog";
  dialog.tabIndex = -1;
  dialog.setAttribute("aria-labelledby", "welcome-title");
  dialog.innerHTML = `
    <div class="welcome-content">
      <button class="welcome-close" type="button" aria-label="Close welcome">×</button>
      <h1 id="welcome-title">Welcome to AD Tools</h1>
      <p>Hi, I'm Fashalli Giovi Bilhaq, or Lolik, from the Retail Department.</p>
      <p>I built AD Tools for Retail's application development work, bringing everyday utilities together in one place. If you're from another team, you're welcome to use the tools that help you too.</p>
      <h2 class="welcome-examples-title">Popular tools</h2>
      <ul class="welcome-examples">
        <li><strong>Quick Query</strong><span>Generate SQL from spreadsheet data.</span></li>
        <li><strong>Run Query</strong><span>Run SQL through Jenkins on desktop.</span></li>
        <li><strong>HTML Template</strong><span>Edit and preview HTML templates.</span></li>
        <li><strong>Query IN</strong><span>Turn lists into SQL IN clauses.</span></li>
        <li><strong>UUID Generator</strong><span>Create unique identifiers.</span></li>
      </ul>
      <p class="welcome-hint">Find tools in the sidebar or search above. Some tools are available in the desktop app only.</p>
      <div class="welcome-actions"><button class="btn btn-primary" type="button" data-explore>Explore tools</button></div>
    </div>`;
  document.body.appendChild(dialog);
  const close = (explore = false) => {
    dialog.close();
    dialog.remove();
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    if (explore) onExplore?.();
  };
  dialog.querySelector(".welcome-close").addEventListener("click", () => close());
  dialog.querySelector("[data-explore]").addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.showModal();
  try { localStorage.setItem(seenKey, "true"); } catch (_) {
    // A future session may show the welcome again if storage is unavailable.
  }
  dialog.focus();
  return true;
}
