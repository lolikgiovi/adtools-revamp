// @vitest-environment jsdom
// Failure cases: non-UUID input/injection; duplicate/case variants; Oracle IN limit and SQL size;
// rows keyed by IMAGE_LINK instead of IMAGE_ID; rows that match neither column;
// missing rows/null CONTENT; connection failure; CORS/HTTP failure; stalled size request;
// late Oracle response after cancel/new run; width threshold and unsafe context text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageCheckerService, ImageOracleService } from "../service.js";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";
import { CheckImageTool } from "../main.js";

const id = "b87cd014-da27-48cb-9a2f-77d1f70fd4da";
const columns = ["IMAGE_ID", "IMAGE_LINK", "CONTEXT", "SUB_CONTEXT", "CONTENT"];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image metadata", () => {
  it("queries only cleaned unique UUIDs and maps Oracle content", async () => {
    const query = vi.spyOn(OracleConnectionService, "queryViaSidecar").mockResolvedValue({
      columns,
      rows: [[id, `content/v1/image/${id}.png`, "Hero", "Mobile", "data:image/png;base64,YQ=="]],
    });
    const connection = { name: "UAT", connect_string: "uat" };
    const records = await ImageOracleService.fetch(connection, [id, `/content/v1/image/${id.toUpperCase()}.png`, "x' OR 1=1"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toEqual([
      "UAT",
      connection,
      `SELECT IMAGE_ID, IMAGE_LINK, CONTEXT, SUB_CONTEXT, CONTENT FROM CONTENT.IMAGE WHERE LOWER(IMAGE_ID) IN ('${id}') OR LOWER(IMAGE_LINK) LIKE '%${id}%'`,
      1000,
    ]);
    expect(records.get(id)).toMatchObject({ context: "Hero", subContext: "Mobile", base64Bytes: 26 });
  });

  it("maps a row whose UUID only appears in IMAGE_LINK", async () => {
    vi.spyOn(OracleConnectionService, "queryViaSidecar").mockResolvedValue({
      columns,
      rows: [["IMG0001932", `Content/V1/Image/${id.toUpperCase()}.PNG`, "Hero", "Mobile", "data:image/png;base64,YQ=="]],
    });
    const records = await ImageOracleService.fetch({ name: "UAT" }, [`/content/v1/image/${id}.png`]);
    expect(records.get(id)).toMatchObject({ context: "Hero", subContext: "Mobile", base64Bytes: 26 });
  });

  it("drops rows that match no requested UUID", async () => {
    vi.spyOn(OracleConnectionService, "queryViaSidecar").mockResolvedValue({
      columns,
      rows: [
        ["IMG0001932", "content/v1/image/0f6c2f1a-4f2d-4a8f-9b1e-0fd1a75b21c4.png", "Other", "", "data:image/png;base64,YQ=="],
        [null, null, "Empty", "", null],
      ],
    });
    const records = await ImageOracleService.fetch({ name: "UAT" }, [id]);
    expect(records.size).toBe(0);
  });

  it("skips non UUID identifiers and splits large lookups into bounded queries", async () => {
    const query = vi.spyOn(OracleConnectionService, "queryViaSidecar").mockResolvedValue({ columns: [], rows: [] });
    await ImageOracleService.fetch({ name: "UAT" }, ["banner.png"]);
    expect(query).not.toHaveBeenCalled();

    const ids = Array.from({ length: 1001 }, (_, i) => `b87cd014-da27-48cb-9a2f-${i.toString(16).padStart(12, "0")}`);
    await ImageOracleService.fetch({ name: "UAT" }, ids);
    expect(query.mock.calls.length).toBeGreaterThan(1);
    const queried = new Set();
    for (const [, , sql] of query.mock.calls) {
      expect(sql.length).toBeLessThan(32 * 1024);
      for (const match of sql.matchAll(/'(b87cd014-da27-48cb-9a2f-[\da-f]{12})'/g)) queried.add(match[1]);
    }
    expect([...queried].sort()).toEqual([...ids].sort());
  });
  it("measures CDN response bytes and reports unreadable responses as unavailable", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["12345"]) });
    vi.stubGlobal("fetch", fetch);
    const service = new ImageCheckerService({});
    expect(await service.getImageSize("https://cdn.example/image.png")).toBe(5);
    fetch.mockRejectedValue(new TypeError("CORS"));
    expect(await service.getImageSize("https://cdn.example/image.png")).toBeNull();
    fetch.mockResolvedValue({ ok: false });
    expect(await service.getImageSize("https://cdn.example/image.png")).toBeNull();
  });
  it("warns only above 1440 pixels", () => {
    const tool = Object.create(CheckImageTool.prototype);
    const warning = tool.createImageMetrics({ width: 1441, height: 800, sizeBytes: 2048 });
    expect(warning.textContent).toContain("2 KB");
    expect(warning.querySelector(".image-width-warning").title).toContain("1440 px");
    expect(tool.createImageMetrics({ width: 1440, height: 800 }).querySelector(".image-width-warning")).toBeNull();
  });
  it("renders Oracle context as two safe lines and ignores obsolete runs", async () => {
    const tool = new CheckImageTool();
    tool.root = document.createElement("div");
    tool.elements = { resultsContainer: tool.root, retryAllTimeoutsBtn: document.createElement("button") };
    const runId = tool.beginCheckRun();
    tool.renderProgressiveTable([id], [], runId);
    vi.spyOn(ImageOracleService, "fetch").mockResolvedValue(
      new Map([
        [
          id,
          {
            context: "<script>bad</script>",
            subContext: "Mobile",
            base64Bytes: 2048,
          },
        ],
      ]),
    );
    await tool.fetchOracleMetadata([id], { name: "UAT" }, runId);
    expect(tool.root.querySelector("[data-oracle-context]").textContent).toBe("<script>bad</script>Mobile");
    expect(tool.root.querySelector("script")).toBeNull();
    expect(tool.root.querySelector("[data-oracle-size]").textContent).toBe("2 KB");
    tool.checkRunId++;
    await tool.fetchOracleMetadata([id], { name: "UAT" }, runId);
    expect(ImageOracleService.fetch).toHaveBeenCalledTimes(1);
  });
});
