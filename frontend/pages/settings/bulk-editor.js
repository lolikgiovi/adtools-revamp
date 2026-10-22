let nextBulkDialogId = 0;

export function mountBulkEditor({ root, button, label, hint, load, plan, apply, onOpen, onBusy, onSaved }) {
  const dialog = document.createElement("dialog");
  dialog.className = "settings-bulk-dialog app-overlay-surface";
  const titleId = `settings-bulk-title-${++nextBulkDialogId}`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-modal", "true");
  const header = document.createElement("header");
  header.className = "settings-bulk-header";
  const title = document.createElement("h2");
  title.id = titleId;
  title.textContent = `Bulk Edit ${label}`;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn btn-ghost app-overlay-close settings-bulk-close";
  closeButton.setAttribute("aria-label", "Close Bulk Edit");
  closeButton.innerHTML = `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18" /></svg>`;
  header.append(title, closeButton);
  const form = document.createElement("form");
  form.className = "settings-bulk-form";
  form.hidden = true;
  form.innerHTML = `
    <div class="settings-bulk-toolbar">
      <button type="button" class="btn btn-outline btn-sm settings-bulk-format">Format JSON</button></div>
    <div class="settings-bulk-input"></div>
    <p class="settings-bulk-hint"></p>
    <div class="settings-bulk-review" aria-live="polite" hidden></div>
    <p class="settings-bulk-status" role="status" aria-live="polite"></p>
    <div class="setting-actions">
      <button type="button" class="btn btn-secondary btn-sm settings-bulk-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary btn-sm settings-bulk-preview">Preview Changes</button>
      <button type="button" class="btn btn-primary btn-sm settings-bulk-apply" hidden>Apply Changes</button>
    </div>`;
  dialog.append(header, form);
  root.appendChild(dialog);
  form.querySelector(".settings-bulk-hint").textContent = hint;
  button.classList.add("settings-bulk-edit");
  const host = form.querySelector(".settings-bulk-input");
  const status = form.querySelector(".settings-bulk-status");
  const review = form.querySelector(".settings-bulk-review");
  const previewButton = form.querySelector(".settings-bulk-preview");
  const applyButton = form.querySelector(".settings-bulk-apply");
  const cancelButton = form.querySelector(".settings-bulk-cancel");
  const formatButton = form.querySelector(".settings-bulk-format");
  let editor = null;
  let prepared = null;
  let context = null;
  let generation = 0;
  let loading = false;
  let saving = false;
  const invalidate = () => {
    prepared = null;
    applyButton.hidden = true;
    previewButton.hidden = false;
    review.hidden = true;
    review.replaceChildren();
    status.textContent = "";
    host.removeAttribute("aria-invalid");
  };
  const close = () => {
    generation += 1;
    form.hidden = true;
    if (dialog.open) dialog.close();
    editor?.dispose();
    editor = null;
    context = null;
    invalidate();
  };
  button.addEventListener("click", async () => {
    if (loading || saving) return;
    if (onOpen?.() === false) return;
    close();
    const active = generation;
    loading = true;
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const [{ createSettingsJsonEditor }, loaded] = await Promise.all([import("./json-editor.js"), load()]);
      if (active !== generation || !root.isConnected) return;
      context = loaded.context;
      form.hidden = false;
      dialog.showModal();
      editor = createSettingsJsonEditor(host, { onChange: invalidate, label: `${label} JSON` });
      editor.setValue(JSON.stringify(loaded.value, null, 2));
      editor.focus();
    } catch {
      if (active === generation) {
        form.hidden = false;
        if (!dialog.open) dialog.showModal();
        status.textContent = "Could not open Bulk Edit. Close it and try again.";
      }
    } finally {
      loading = false;
      button.disabled = false;
      button.textContent = "Bulk Edit";
    }
  });
  cancelButton.addEventListener("click", () => {
    close();
    button.focus();
  });
  closeButton.addEventListener("click", () => {
    if (!saving) cancelButton.click();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!saving) cancelButton.click();
  });
  formatButton.addEventListener("click", async () => {
    if (!editor || saving) return;
    try {
      await editor.format();
    } catch {
      status.textContent = "Could not format JSON. Fix syntax errors and try again.";
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editor || saving) return;
    invalidate();
    try {
      prepared = plan(editor.getValue(), context);
      const summary = document.createElement("p");
      summary.textContent = Object.entries(prepared.summary)
        .map(([key, count]) => `${count} ${key}`)
        .join(" · ");
      review.appendChild(summary);
      for (const entry of prepared.entries) {
        const row = document.createElement("div");
        row.className = "settings-bulk-review-row";
        const name = document.createElement("strong");
        name.textContent = entry.name;
        const change = document.createElement("span");
        change.textContent = `${entry.change}${entry.password !== undefined ? " · password provided" : ""}`;
        row.append(name, change);
        review.appendChild(row);
      }
      review.hidden = false;
      const changed = prepared.summary.added + prepared.summary.updated + (prepared.summary.removed || 0);
      applyButton.hidden = !changed;
      previewButton.hidden = !!changed;
    } catch (error) {
      prepared = null;
      status.textContent = error.message;
      host.setAttribute("aria-invalid", "true");
      editor.focus();
    }
  });
  applyButton.addEventListener("click", async () => {
    if (!prepared || saving) return;
    saving = true;
    button.disabled = cancelButton.disabled = closeButton.disabled = applyButton.disabled = formatButton.disabled = true;
    editor.updateOptions({ readOnly: true });
    onBusy?.(true);
    applyButton.textContent = "Applying…";
    try {
      await apply(prepared);
      close();
      onSaved?.();
      button.focus();
    } catch (error) {
      invalidate();
      status.textContent = error.message;
    } finally {
      saving = false;
      button.disabled = cancelButton.disabled = closeButton.disabled = applyButton.disabled = formatButton.disabled = false;
      editor?.updateOptions({ readOnly: false });
      onBusy?.(false);
      applyButton.textContent = "Apply Changes";
      if (form.hidden) button.focus();
    }
  });
  return {
    close,
    dispose: close,
    get busy() {
      return saving || loading;
    },
  };
}
