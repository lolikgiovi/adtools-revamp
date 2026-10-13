import { describe, it, expect, vi } from "vitest";
import { AttachmentProcessorService } from "../services/AttachmentProcessorService.js";
import { QueryGenerationService } from "../services/QueryGenerationService.js";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: { trackEvent: vi.fn() },
}));

describe("Quick Query attachments with typed spreadsheet cells", () => {
  const schema = [
    ["TEMPLATE_ID", "NUMBER", "No", "", "", "Yes"],
    ["IS_ACTIVE", "NUMBER", "No"],
    ["FLAG", "VARCHAR2(10)", "Yes"],
    ["OPTIONAL_VALUE", "VARCHAR2(10)", "Yes"],
    ["TEMPLATE_MESSAGE_ID", "CLOB", "No"],
  ];
  const headers = schema.map((field) => field[0]);

  it.each(["insert", "update", "merge"])("preserves typed cells and embeds attached HTML for %s", async (queryType) => {
    const file = new File(["<p>Customer's message</p>"], "message.html", { type: "text/html" });
    const attachments = await new AttachmentProcessorService().processAttachments([file], "CONTENT.MESSAGE_TEMPLATE");
    const input = [headers, [42, 1, true, null, "MESSAGE.HTML"], [0, 0, false, "", "message.html"]];
    const originalInput = structuredClone(input);
    const service = new QueryGenerationService();

    const sql = service.generateQuery("CONTENT.MESSAGE_TEMPLATE", queryType, schema, input, attachments);
    const expected = service.generateQuery(
      "CONTENT.MESSAGE_TEMPLATE",
      queryType,
      schema,
      [headers, [42, 1, true, null, "<p>Customer's message</p>"], [0, 0, false, "", "<p>Customer's message</p>"]],
      [],
    );

    expect(sql).toBe(expected);
    expect(sql).toContain("to_clob('<p>Customer''s message</p>')");
    expect(sql).toContain("'true'");
    expect(sql).toContain("'false'");
    expect(input).toEqual(originalInput);
  });

  it.each(["insert", "update", "merge"])("ignores an unrelated attachment for %s", async (queryType) => {
    const attachments = await new AttachmentProcessorService().processAttachments(
      [new File(["unrelated"], "unused.txt", { type: "text/plain" })],
      "CONTENT.MESSAGE_TEMPLATE",
    );
    const input = [headers, [-2.5, 1, true, undefined, "ordinary content"]];
    const service = new QueryGenerationService();

    expect(service.generateQuery("CONTENT.MESSAGE_TEMPLATE", queryType, schema, input, attachments)).toBe(
      service.generateQuery("CONTENT.MESSAGE_TEMPLATE", queryType, schema, input, []),
    );
  });
});
