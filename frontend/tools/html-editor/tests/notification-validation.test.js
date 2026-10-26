import { vi } from "vitest";
import { HTMLTemplateToolTemplate } from "../template.js";
import { NotificationValidation } from "../notification-validation.js";

vi.mock("../../velocity-template/validator.js", () => ({ requestVelocityValidation: vi.fn() }));
import { requestVelocityValidation } from "../../velocity-template/validator.js";

// Failures: invalid JSON reaches the API; notification URL or isAddFunction is missing;
// repeated clicks duplicate requests; edits, settings changes, tab switches, or disposal
// let a stale response replace the preview; failed HTTP responses render as valid HTML;
// invalid context drafts disappear when switching documents; raw HTML executes in the response log.
describe("HTML notification validation", () => {
  let tool;
  let validation;
  let root;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("config.velocityValidator.notificationUrl", "http://localhost/notification");
    document.body.innerHTML = HTMLTemplateToolTemplate;
    root = document.querySelector(".html-template");
    tool = {
      container: root,
      activeDocumentId: "one",
      activeDocument: { id: "one", vtlValues: {} },
      vtlValues: {},
      editor: { getValue: () => "<h1>$format.currency($amount)</h1>" },
      scheduleDocumentSave: vi.fn(),
      renderPreview: vi.fn(),
    };
    validation = new NotificationValidation(tool);
    validation.bind();
    validation.syncContext();
    requestVelocityValidation.mockResolvedValue({ status: 200, body: "<h1>60,000</h1>" });
  });
  afterEach(() => validation.dispose());
  const inputContext = (text) => {
    const input = root.querySelector("#htmlVelocityContext");
    input.value = text;
    input.dispatchEvent(new Event("input"));
  };
  it("sends the notification JSON request with functions always enabled and renders the API result", async () => {
    inputContext('{"amount":60000}');
    await validation.validate();
    expect(requestVelocityValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost/notification",
        context: { amount: 60000 },
        template: "<h1>$format.currency($amount)</h1>",
        isAddFunction: true,
      }),
    );
    expect(root.querySelector("#htmlRenderer").srcdoc).toBe("<h1>60,000</h1>");
    expect(root.querySelector("#htmlValidationResponse").textContent).toBe("<h1>60,000</h1>");
    expect(root.querySelector("#htmlValidationResponse h1")).toBeNull();
  });
  it.each(["{", "[]", "null", '"text"'])("blocks invalid context %s and saves the draft", async (text) => {
    inputContext(text);
    await validation.validate();
    expect(requestVelocityValidation).not.toHaveBeenCalled();
    expect(tool.activeDocument.contextText).toBe(text);
    expect(root.querySelector("#htmlVelocityContextError").hidden).toBe(false);
  });
  it("does not request without a configured notification endpoint", async () => {
    localStorage.removeItem("config.velocityValidator.notificationUrl");
    await validation.validate();
    expect(requestVelocityValidation).not.toHaveBeenCalled();
    expect(root.querySelector("#htmlValidationStatus").textContent).toMatch(/Notification Template Endpoint/);
  });
  it.each(["edit", "tab", "settings", "dispose"])("rejects late responses after %s", async (change) => {
    let resolve;
    requestVelocityValidation.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = validation.validate();
    await validation.validate();
    expect(requestVelocityValidation).toHaveBeenCalledTimes(1);
    if (change === "edit") inputContext('{"changed":true}');
    if (change === "tab") tool.activeDocumentId = "two";
    if (change === "settings") localStorage.setItem("config.velocityValidator.notificationUrl", "http://localhost/other");
    if (change === "dispose") validation.dispose();
    resolve({ status: 200, body: "late output" });
    await pending;
    expect(root.querySelector("#htmlRenderer").srcdoc).not.toBe("late output");
    expect(root.querySelector("#btnValidateHtmlVelocity").disabled).toBe(false);
  });
  it("shows HTTP failure details without replacing the preview", async () => {
    requestVelocityValidation.mockResolvedValue({ status: 503, body: "Unavailable" });
    await validation.validate();
    expect(root.querySelector("#htmlValidationStatus").textContent).toMatch(/503/);
    expect(root.querySelector("#htmlValidationResponse").textContent).toBe("Unavailable");
    expect(root.querySelector("#htmlRenderer").srcdoc).not.toBe("Unavailable");
  });
  it("reflects the current environment when restoring valid saved context", () => {
    tool.activeDocument = { id: "two", contextText: '{"baseUrl":"old"}', vtlValues: { baseUrl: "current" } };
    tool.activeDocumentId = "two";
    tool.vtlValues = tool.activeDocument.vtlValues;
    validation.syncContext();
    expect(JSON.parse(root.querySelector("#htmlVelocityContext").value)).toEqual({ baseUrl: "current" });
  });
  it("restores each document's raw context draft", () => {
    inputContext('{"unfinished":');
    tool.activeDocument = { id: "two", vtlValues: { amount: 2 } };
    tool.activeDocumentId = "two";
    tool.vtlValues = tool.activeDocument.vtlValues;
    validation.syncContext();
    expect(JSON.parse(root.querySelector("#htmlVelocityContext").value)).toEqual({ amount: 2 });
    tool.activeDocument = { id: "one", contextText: '{"unfinished":', vtlValues: {} };
    tool.activeDocumentId = "one";
    tool.vtlValues = {};
    validation.syncContext();
    expect(root.querySelector("#htmlVelocityContext").value).toBe('{"unfinished":');
  });
});
