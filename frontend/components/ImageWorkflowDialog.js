import "./image-workflow-dialog.css";

/** Native modal supplies focus containment, Escape handling and background inertness. */
export function imageWorkflowDialog({ title, description, fields = [], actions, signal }) {
  if (signal?.aborted) return Promise.resolve(null);
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "image-workflow-dialog app-overlay-surface";
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.id = `image-workflow-${crypto.randomUUID()}`;
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  form.append(heading);
  if (description) {
    const text = document.createElement("p");
    text.textContent = description;
    form.append(text);
  }
  for (const field of fields) {
    if (field.type === "radio-list") {
      const list = document.createElement("fieldset");
      list.className = "image-workflow-options";
      const legend = document.createElement("legend");
      legend.className = "sr-only";
      legend.textContent = field.label;
      list.append(legend);
      for (const option of field.options) {
        const row = document.createElement("label");
        row.className = `image-workflow-option${option.separate ? " image-workflow-option-new" : ""}`;
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = field.name;
        radio.value = option.value;
        radio.required = true;
        radio.checked = option.value === (field.value ?? field.options[0]?.value);
        const name = document.createElement("span");
        name.className = "image-workflow-option-title";
        name.textContent = option.label;
        row.append(radio, name);
        if (option.detail) {
          const detail = document.createElement("span");
          detail.className = "image-workflow-option-detail";
          detail.textContent = option.detail;
          row.append(detail);
        }
        list.append(row);
      }
      form.append(list);
      continue;
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement(field.options ? "select" : "input");
    input.name = field.name;
    input.required = true;
    if (field.options) {
      for (const option of field.options) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        input.append(node);
      }
    } else {
      input.type = "text";
      input.maxLength = 180;
    }
    input.value = field.value ?? field.options?.[0]?.value ?? "";
    input.setAttribute("data-searchable-dropdown-ignore", "");
    label.append(input);
    form.append(label);
  }
  const footer = document.createElement("footer");
  for (const action of [...actions, { value: "cancel", label: "Cancel" }]) {
    const button = document.createElement("button");
    button.type = action.value === "cancel" ? "button" : "submit";
    button.value = action.value;
    button.textContent = action.label;
    button.className = `btn ${action.primary ? "btn-primary" : "btn-secondary"} btn-sm`;
    if (action.value === "cancel") button.addEventListener("click", () => finish(null));
    footer.append(button);
  }
  form.append(footer);
  dialog.append(form);
  document.body.append(dialog);
  let finish;
  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => finish(null);
    finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(result);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      if (values.filename !== undefined && !values.filename.trim()) return;
      finish({ action: event.submitter?.value || actions[0].value, ...values });
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));
    signal?.addEventListener("abort", onAbort, { once: true });
    dialog.showModal();
    form.querySelector('input[type="radio"]:checked')?.focus({ preventScroll: true });
  });
}
