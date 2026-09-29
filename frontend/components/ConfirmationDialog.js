let nextDialogId = 0;

/** Show a theme-aware confirmation dialog and resolve whether the action was accepted. */
export function confirmAction({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
} = {}) {
  if (typeof document.createElement("dialog").showModal !== "function") {
    return Promise.resolve(window.confirm(`${title || "Confirm action"}\n\n${description || "Continue?"}`));
  }

  const dialogId = ++nextDialogId;
  const titleId = `app-confirm-title-${dialogId}`;
  const descriptionId = `app-confirm-description-${dialogId}`;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "app-confirm-dialog app-overlay-surface";
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", descriptionId);

  const content = document.createElement("div");
  content.className = "app-confirm-dialog-content";

  const header = document.createElement("div");
  header.className = "app-confirm-dialog-header";

  const icon = document.createElement("span");
  icon.className = "app-confirm-dialog-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = destructive ? "!" : "?";

  const heading = document.createElement("div");
  heading.className = "app-confirm-dialog-heading";

  const kicker = document.createElement("p");
  kicker.className = "app-confirm-dialog-kicker";
  kicker.textContent = "Confirm action";

  const titleElement = document.createElement("h2");
  titleElement.className = "app-confirm-dialog-title";
  titleElement.id = titleId;
  titleElement.textContent = title || "Confirm action";
  heading.append(kicker, titleElement);
  header.append(icon, heading);

  const descriptionElement = document.createElement("p");
  descriptionElement.className = "app-confirm-dialog-description";
  descriptionElement.id = descriptionId;
  descriptionElement.textContent = description || "Continue with this action?";

  const actions = document.createElement("footer");
  actions.className = "app-confirm-dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.className = "btn btn-secondary btn-sm";
  cancelButton.type = "button";
  cancelButton.textContent = cancelLabel;

  const confirmButton = document.createElement("button");
  confirmButton.className = `btn ${destructive ? "btn-danger" : "btn-primary"} btn-sm`;
  confirmButton.type = "button";
  confirmButton.textContent = confirmLabel;

  actions.append(cancelButton, confirmButton);
  content.append(header, descriptionElement, actions);
  dialog.appendChild(content);
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(accepted);
    };

    cancelButton.addEventListener("click", () => finish(false));
    confirmButton.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });
    dialog.addEventListener("close", () => finish(false), { once: true });

    dialog.showModal();
    cancelButton.focus({ preventScroll: true });
  });
}
