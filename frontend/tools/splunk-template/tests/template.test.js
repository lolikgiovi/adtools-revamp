import { SplunkVTLEditorTemplate } from "../template.js";

describe("Splunk template editor UI", () => {
  beforeEach(() => {
    document.body.innerHTML = SplunkVTLEditorTemplate;
  });

  it("exposes accessible tabs, the docked function inspector, and keyboard resizer semantics", () => {
    const textTab = document.getElementById("btnTextView");
    const tableTab = document.getElementById("btnTableView");
    const functions = document.getElementById("btnFunctions");
    const resizer = document.getElementById("vtlResizer");

    expect(textTab.getAttribute("aria-controls")).toBe("textEditorPanel");
    expect(textTab.tabIndex).toBe(0);
    expect(tableTab.getAttribute("aria-controls")).toBe("tableEditorPanel");
    expect(tableTab.tabIndex).toBe(-1);
    expect(functions.getAttribute("aria-controls")).toBe("functionLibraryPanel");
    expect(document.getElementById("functionLibraryPanel").open).toBe(false);
    expect(resizer.tabIndex).toBe(0);
    expect(resizer.getAttribute("aria-valuenow")).toBe("60");
  });

  it("provides actionable expressions for every documented function", () => {
    const insertButtons = [...document.querySelectorAll("[data-insert-expression]")];
    const copyButtons = [...document.querySelectorAll("[data-copy-expression]")];

    expect(insertButtons).toHaveLength(18);
    expect(copyButtons).toHaveLength(18);
    expect(insertButtons.map((button) => button.dataset.insertExpression)).toContain(
      '$format.formatDate($context.value, "dd/MM/yyyy", "id-ID")',
    );
    expect(insertButtons.map((button) => button.dataset.insertExpression)).toContain(
      "$date.convertDate($context.value, \"yyyy-MM-dd'T'HH:mm:ss\")",
    );
  });

  it("uses explicit button types and keeps advanced date documentation collapsed", () => {
    expect([...document.querySelectorAll("button")].every((button) => button.type === "button")).toBe(true);
    expect([...document.querySelectorAll(".vtl-function-details")].every((details) => !details.open)).toBe(true);
  });
});
