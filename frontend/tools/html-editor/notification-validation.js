import { requestVelocityValidation } from "../velocity-template/validator.js";

const ENDPOINT_KEY = "config.velocityValidator.notificationUrl";

export class NotificationValidation {
  constructor(tool) {
    this.tool = tool;
    this.root = tool.container;
    this.request = null;
    this.result = false;
  }

  element(id) {
    return this.root.querySelector(`#${id}`);
  }

  bind() {
    this.element("btnValidateHtmlVelocity").addEventListener("click", () => void this.validate());
    this.element("btnHtmlValidatorSettings").addEventListener("click", () => {
      localStorage.setItem("settings.focus", ENDPOINT_KEY);
      window.app?.router?.navigate("settings");
    });
    this.element("htmlVelocityContext").addEventListener("input", () => this.applyContext());
    this.element("btnFormatHtmlContext").addEventListener("click", () => {
      try {
        this.element("htmlVelocityContext").value = JSON.stringify(this.readContext(), null, 2);
        this.applyContext();
      } catch (error) {
        this.setContextError(error.message);
      }
    });
  }

  readContext() {
    const context = JSON.parse(this.element("htmlVelocityContext").value);
    if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("Velocity Context must be a JSON object.");
    return context;
  }

  setContextError(message = "") {
    const error = this.element("htmlVelocityContextError");
    error.textContent = message;
    error.hidden = !message;
    this.element("htmlVelocityContext").setAttribute("aria-invalid", String(Boolean(message)));
  }

  syncContext() {
    const document = this.tool.activeDocument;
    if (!document) return;
    const values = JSON.stringify(this.tool.vtlValues);
    if (this.documentId !== document.id) {
      this.invalidate();
      this.element("htmlVelocityContext").value = document.contextText ?? JSON.stringify(this.tool.vtlValues, null, 2);
      try {
        const saved = this.readContext();
        if (JSON.stringify(saved) !== values) {
          this.element("htmlVelocityContext").value = JSON.stringify(this.tool.vtlValues, null, 2);
          document.contextText = this.element("htmlVelocityContext").value;
        }
      } catch (_) {
        /* Preserve unfinished JSON drafts across document switches. */
      }
      this.documentId = document.id;
    } else if (this.values !== values) {
      this.element("htmlVelocityContext").value = JSON.stringify(this.tool.vtlValues, null, 2);
      document.contextText = this.element("htmlVelocityContext").value;
    }
    this.values = values;
    try {
      this.readContext();
      this.setContextError();
    } catch (error) {
      this.setContextError(error.message);
    }
  }

  applyContext() {
    this.invalidate();
    const document = this.tool.activeDocument;
    if (!document) return;
    document.contextText = this.element("htmlVelocityContext").value;
    this.tool.scheduleDocumentSave();
    try {
      this.tool.vtlValues = this.readContext();
      document.vtlValues = this.tool.vtlValues;
      this.values = JSON.stringify(this.tool.vtlValues);
      this.setContextError();
      this.tool.renderPreview(this.tool.editor.getValue(), true);
    } catch (error) {
      this.setContextError(error.message);
    }
  }

  snapshot() {
    return {
      documentId: this.tool.activeDocumentId,
      template: this.tool.editor.getValue(),
      contextText: this.element("htmlVelocityContext").value,
      url: (localStorage.getItem(ENDPOINT_KEY) || "").trim(),
    };
  }

  status(message = "") {
    const status = this.element("htmlValidationStatus");
    status.textContent = message;
    status.hidden = !message;
  }

  resetButton() {
    const button = this.element("btnValidateHtmlVelocity");
    button.disabled = false;
    button.textContent = "Validate Velocity";
    button.removeAttribute("aria-busy");
  }

  invalidate() {
    const hadResult = this.result || Boolean(this.request);
    this.request?.controller.abort();
    this.request = null;
    this.result = false;
    this.resetButton();
    this.element("htmlValidationOutput").hidden = true;
    if (hadResult) this.status("Inputs changed. Validate Velocity again.");
  }

  async validate() {
    if (this.request) return;
    const snapshot = this.snapshot();
    let context;
    try {
      if (!snapshot.url) throw new Error("Set the Notification Template Endpoint in Settings → Velocity API Validator first.");
      if (!snapshot.template.trim()) throw new Error("Enter an HTML template before validating.");
      try {
        context = this.readContext();
        this.setContextError();
      } catch (error) {
        this.setContextError(error.message);
        throw new Error("Fix Velocity Context before validating.", { cause: error });
      }
    } catch (error) {
      this.status(error.message);
      return;
    }
    clearTimeout(this.tool._previewTimer);
    const request = { controller: new AbortController() };
    this.request = request;
    this.result = false;
    this.element("htmlValidationOutput").hidden = true;
    const button = this.element("btnValidateHtmlVelocity");
    button.disabled = true;
    button.textContent = "Validating…";
    button.setAttribute("aria-busy", "true");
    this.status("Calling notification template API…");
    try {
      const response = await requestVelocityValidation({
        url: snapshot.url,
        template: snapshot.template,
        context,
        isAddFunction: true,
        signal: request.controller.signal,
      });
      if (this.request !== request) return;
      if (JSON.stringify(snapshot) !== JSON.stringify(this.snapshot())) {
        this.status("Inputs or endpoint changed. Validate Velocity again.");
        return;
      }
      this.result = true;
      this.element("htmlValidationResponse").textContent = response.body;
      this.element("htmlValidationOutput").hidden = false;
      const success = response.status >= 200 && response.status < 300;
      this.status(`Notification API · HTTP ${response.status}${success ? "" : " · request failed"}`);
      if (success) {
        let html = response.body;
        try {
          const parsed = JSON.parse(html);
          if (typeof parsed === "string") html = parsed;
        } catch (_) {
          /* HTML responses do not need JSON decoding. */
        }
        const iframe = this.element("htmlRenderer");
        iframe.srcdoc = html;
        iframe.hidden = !html.trim();
      }
    } catch (error) {
      if (this.request === request) this.status(error.message);
    } finally {
      if (this.request === request) {
        this.request = null;
        this.resetButton();
      }
    }
  }

  dispose() {
    this.invalidate();
  }
}
