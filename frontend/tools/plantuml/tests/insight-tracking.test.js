// PlantUML reports what kind of diagram people make and which work fails.
// Ways it could go wrong: a broken diagram reports a failure on every typing pause (overcount); a file that breaks again
// after being fixed reports nothing (undercount); diagram types are unbounded or read from user text; an export, import
// or format failure goes unreported; a failure carries diagram source or error text.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor.js", () => ({ monaco: {}, setCompletionWorkspace: () => {} }));
vi.mock("../renderer.js", () => ({ PlantUmlRenderer: class {} }));
vi.mock("../preview.js", () => ({ DiagramPreview: class {} }));

const { UsageTracker } = await import("../../../core/UsageTracker.js");
const { PlantUmlTool } = await import("../main.js");
const { diagramType } = await import("../diagram-type.js");

afterEach(() => vi.restoreAllMocks());

describe("PlantUML diagram type", () => {
  it.each([
    ["@startuml\nAlice -> Bob: hi\n@enduml", "sequence"],
    ["@startuml\nparticipant Api\n@enduml", "sequence"],
    ["@startuml\nclass Account {\n}\nAccount --> Ledger\n@enduml", "class"],
    ["@startuml\nstart\n:Validate;\nstop\n@enduml", "activity"],
    ["@startuml\n[*] --> Idle\nstate Idle\n@enduml", "state"],
    ["@startuml\ncomponent Gateway\n@enduml", "component"],
    ["@startuml\nactor Teller\nusecase (Open account)\n@enduml", "usecase"],
    ["@startmindmap\n* Root\n@endmindmap", "mindmap"],
    ["@startgantt\n[Build] lasts 5 days\n@endgantt", "gantt"],
    ["@startjson\n{}\n@endjson", "json"],
    ["@startuml\nnote: secret text\n@enduml", "other"],
    ["", "other"],
  ])("reads %j as %s", (source, type) => {
    expect(diagramType(source)).toBe(type);
  });
});

describe("PlantUML insight", () => {
  function tool() {
    const failures = [];
    vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error, meta) => failures.push({ action, error, meta }));
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    return { instance: Object.create(PlantUmlTool.prototype), failures };
  }
  const broken = (fileId) => ({ state: "error", fileId, source: "@startuml\nAlice -> \n@enduml", line: 2, error: "Syntax error: secret" });
  const ready = (fileId) => ({ state: "ready", fileId, source: "@startuml\nAlice -> Bob\n@enduml" });

  it("reports a broken diagram once until it renders again, then again if it breaks", () => {
    const { instance, failures } = tool();
    for (const result of [broken("a"), broken("a"), broken("a"), ready("a"), broken("a"), broken("b")]) instance.trackRenderOutcome(result);
    expect(failures).toEqual([
      { action: "render", error: "invalid_input", meta: { diagram_type: "sequence" } },
      { action: "render", error: "invalid_input", meta: { diagram_type: "sequence" } },
      { action: "render", error: "invalid_input", meta: { diagram_type: "sequence" } },
    ]);
    expect(JSON.stringify(failures)).not.toContain("secret");
  });

  it("adds the diagram type to view and edit uses", () => {
    const { instance } = tool();
    expect(instance.renderUseMeta({ source: "@startmindmap\n* a\n@endmindmap", milliseconds: 40 })).toEqual({
      input_size: 29,
      duration_ms: 40,
      diagram_type: "mindmap",
    });
  });

  it("reports failed exports, format and import, but not other actions", () => {
    const { instance, failures } = tool();
    const error = new Error("canvas secret");
    for (const action of ["svg", "png", "backup", "format", "zoom-in", "rename"]) instance.reportActionFailure(action, error);
    instance.reportImportFailure(error, 3);
    expect(failures.map(({ action, meta }) => [action, meta])).toEqual([
      ["export_svg", undefined],
      ["export_png", undefined],
      ["export_workspace", undefined],
      ["format", undefined],
      ["import", { file_count: 3 }],
    ]);
  });
});
