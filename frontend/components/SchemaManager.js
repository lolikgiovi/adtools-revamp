import { getActiveProject, listProjects } from "../core/Projects.js";
import { IndexedDBStorageService } from "../tools/quick-query/services/IndexedDBStorageService.js";
import { confirmAction } from "./ConfirmationDialog.js";
import "./schema-manager.css";

let nextDialog = 0;
function button(label, className = "btn btn-secondary btn-sm") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}
function createDialog(root, title, className = "", canClose = () => true) {
  const trigger = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = `schema-manager-dialog app-overlay-surface ${className}`;
  const header = document.createElement("header");
  header.className = "schema-manager-header";
  const heading = document.createElement("h2");
  heading.id = `schema-manager-title-${++nextDialog}`;
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = button("", "btn btn-ghost app-overlay-close");
  close.setAttribute("aria-label", "Close schema manager");
  close.innerHTML =
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18" /></svg>';
  const finish = () => {
    if (!canClose()) return;
    dialog.close();
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  };
  close.addEventListener("click", finish);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  header.append(heading, close);
  dialog.append(header);
  root.append(dialog);
  return { dialog, finish };
}

export function openSchemaTransfer({ root = document.body, storage, fullName, move = false, onTransferred }) {
  let busy = false;
  const action = move ? "Move" : "Copy";
  const { dialog, finish } = createDialog(root, `${action} ${fullName}`, "schema-transfer-dialog", () => !busy);
  const form = document.createElement("form");
  form.className = "schema-transfer-form";
  const label = document.createElement("label");
  label.textContent = "Destination project";
  const select = document.createElement("select");
  select.className = "schema-manager-input";
  select.setAttribute("aria-label", "Destination project");
  for (const project of listProjects().filter((project) => project.id !== storage.projectId))
    select.add(new Option(project.name, project.id));
  label.append(select);
  const status = document.createElement("p");
  status.className = "schema-manager-status";
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "schema-manager-actions";
  const cancel = button("Cancel");
  cancel.addEventListener("click", finish);
  const submit = button(`${action} schema`, "btn btn-primary btn-sm");
  submit.type = "submit";
  if (!select.options.length) {
    select.disabled = submit.disabled = true;
    status.textContent = "Create another project first.";
  }
  actions.append(cancel, submit);
  form.append(label, status, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !select.value) return;
    busy = true;
    select.disabled = submit.disabled = cancel.disabled = true;
    submit.textContent = move ? "Moving…" : "Copying…";
    status.textContent = "";
    try {
      await storage.transferSchema(fullName, select.value, { move });
      busy = false;
      finish();
      await onTransferred?.({ fullName, destinationId: select.value, move });
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      select.disabled = submit.disabled = cancel.disabled = false;
      submit.textContent = `${action} schema`;
    }
  });
  dialog.append(form);
  dialog.showModal();
  select.focus();
  return {
    dispose: () => {
      dialog.close();
      dialog.remove();
    },
  };
}

export function mountSchemaManager({ root, project = getActiveProject() }) {
  const storage = new IndexedDBStorageService({ projectId: project.id });
  let manager = null;
  let disposed = false;
  let busy = false;
  let transfer = null;
  const open = async () => {
    if (disposed) return;
    if (manager?.dialog.isConnected) {
      manager.dialog.showModal();
      return;
    }
    manager = createDialog(root, `${project.name} — Saved schemas`, "", () => !busy);
    const { dialog } = manager;
    const body = document.createElement("div");
    body.className = "schema-manager-body";
    const toolbar = document.createElement("div");
    toolbar.className = "schema-manager-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search schemas";
    search.setAttribute("aria-label", "Search schemas");
    search.className = "schema-manager-input";
    const importButton = button("Import");
    const exportButton = button("Export");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.hidden = true;
    const status = document.createElement("p");
    status.className = "schema-manager-status";
    status.setAttribute("role", "status");
    const list = document.createElement("div");
    list.className = "schema-manager-list";
    const setBusy = (value) => {
      busy = value;
      body.querySelectorAll("button, input").forEach((element) => {
        element.disabled = value;
      });
    };
    const render = async () => {
      const tables = await storage.getAllTables();
      if (disposed || !dialog.isConnected) return;
      const query = search.value.trim().toLowerCase();
      list.replaceChildren();
      for (const table of tables.filter((table) => table.fullName.toLowerCase().includes(query))) {
        const row = document.createElement("div");
        row.className = "schema-manager-row";
        row.dataset.table = table.fullName;
        const name = document.createElement("strong");
        name.textContent = table.fullName;
        const actions = document.createElement("div");
        actions.className = "schema-manager-row-actions";
        for (const move of [true, false]) {
          const control = button(move ? "Move…" : "Copy…");
          control.addEventListener("click", () => {
            transfer = openSchemaTransfer({
              root: dialog,
              storage,
              fullName: table.fullName,
              move,
              onTransferred: async ({ destinationId }) => {
                await render();
                const destination = listProjects().find((project) => project.id === destinationId);
                status.textContent = `${table.fullName} ${move ? "moved" : "copied"} to ${destination?.name || "the destination project"}.`;
              },
            });
          });
          actions.append(control);
        }
        const remove = button("Delete", "btn btn-outline btn-danger btn-sm");
        remove.addEventListener("click", async () => {
          if (
            !(await confirmAction({
              title: "Delete saved schema?",
              description: `Delete ${table.fullName} and its saved table data?`,
              confirmLabel: "Delete schema",
            }))
          )
            return;
          setBusy(true);
          try {
            if (!(await storage.deleteSchema(table.fullName))) throw new Error("Could not delete the schema. Try again.");
            await render();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            setBusy(false);
          }
        });
        actions.append(remove);
        row.append(name, actions);
        list.append(row);
      }
      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.className = "schema-manager-empty";
        empty.textContent = query ? "No matching schemas." : "No saved schemas in this project.";
        list.append(empty);
      }
    };
    search.addEventListener("input", () => {
      void render().catch((error) => {
        status.textContent = error.message;
      });
    });
    exportButton.addEventListener("click", async () => {
      setBusy(true);
      try {
        const payload = Object.create(null);
        for (const table of await storage.getAllTables()) {
          const schema = await storage.loadSchema(table.fullName);
          if (!schema) throw new Error(`Could not read ${table.fullName}.`);
          (payload[table.schemaName] ||= Object.create(null))[table.tableName] = schema;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "quick_query_saved_schemas.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        setBusy(false);
      }
    });
    importButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      setBusy(true);
      let imported = 0;
      try {
        const payload = JSON.parse(await file.text());
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Choose a Quick Query schema JSON export.");
        const tables = [];
        for (const [schemaName, group] of Object.entries(payload)) {
          for (const [tableName, schema] of Object.entries(group?.tables || group || {})) {
            const fullName = `${schemaName}.${tableName}`;
            storage.parseTableIdentifier(fullName);
            const rows = Array.isArray(schema) ? schema : storage._convertJsonSchemaToArray(schema);
            if (!rows.length || !rows.every((row) => Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string"))
              throw new Error(`Invalid schema for ${fullName}.`);
            tables.push({ fullName, rows });
          }
        }
        if (!tables.length) throw new Error("No schemas found in this file.");
        const existing = new Set((await storage.getAllTables()).map((table) => table.fullName));
        if (tables.some((table) => existing.has(table.fullName)))
          throw new Error("A table in this file already exists. Nothing was imported.");
        for (const table of tables) {
          if (!(await storage.saveSchema(table.fullName, table.rows))) throw new Error(`Could not save ${table.fullName}.`);
          imported++;
        }
        status.textContent = `Imported ${imported} schema${imported === 1 ? "" : "s"}.`;
      } catch (error) {
        status.textContent = `${imported ? `Imported ${imported} schemas. ` : ""}${error.message}`;
      } finally {
        fileInput.value = "";
        await render();
        setBusy(false);
      }
    });
    toolbar.append(search, importButton, exportButton, fileInput);
    body.append(toolbar, status, list);
    dialog.append(body);
    dialog.showModal();
    status.textContent = "Loading schemas…";
    try {
      await storage.init();
      if (disposed) {
        storage.db?.close();
        return;
      }
      await render();
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    }
    search.focus();
  };
  return {
    open,
    dispose() {
      disposed = true;
      transfer?.dispose();
      if (manager) {
        manager.dialog.close();
        manager.dialog.remove();
      }
      storage.db?.close();
    },
  };
}
