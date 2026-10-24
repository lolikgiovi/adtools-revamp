let nextDialogId = 0;

export function mountEditDialog({ root, form, onCancel, isBusy = () => false, wide = false, fallbackFocus }) {
  const dialog = document.createElement("dialog");
  dialog.className = `settings-edit-dialog app-overlay-surface${wide ? " settings-edit-dialog-wide" : ""}`;
  const header = document.createElement("header");
  header.className = "settings-bulk-header";
  const title = document.createElement("h2");
  title.id = `settings-edit-title-${++nextDialogId}`;
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.setAttribute("aria-modal", "true");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn btn-ghost app-overlay-close";
  closeButton.setAttribute("aria-label", "Close editor");
  closeButton.innerHTML =
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18" /></svg>';
  header.append(title, closeButton);
  dialog.append(header, form);
  root.appendChild(dialog);
  let trigger = null;
  let disposed = false;
  const cancel = () => {
    if (!isBusy()) onCancel();
  };
  closeButton.addEventListener("click", cancel);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  return {
    open(label) {
      trigger = document.activeElement;
      title.textContent = label;
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (!dialog.open) return;
      dialog.close();
      queueMicrotask(() => {
        if (disposed || document.querySelector("dialog[open]")) return;
        const replacement = fallbackFocus?.(trigger);
        (trigger?.isConnected ? trigger : replacement)?.focus();
      });
    },
    dispose() {
      disposed = true;
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
