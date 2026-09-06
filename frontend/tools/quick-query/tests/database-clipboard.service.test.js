import { describe, expect, it } from "vitest";
import { hasMalformedQuotedField, recoverMalformedDatabaseClipboard } from "../services/DatabaseClipboardService.js";

describe("DatabaseClipboardService", () => {
  it("quickly rejects ordinary TSV without reparsing it", () => {
    expect(hasMalformedQuotedField("1\tAda\tJakarta\n2\tGrace\tBandung")).toBe(false);
  });

  it("recovers raw JSON object and array quotes from multiple CRLF rows", () => {
    const clipboard = 'row-1\t"{"name":"Ada","locale":"日本語"}"\r\nrow-2\t"[1,2,3]"\r\n';
    const pastedData = [
      ["row-1", "{name:Ada,locale:日本語}"],
      ["row-2", "[1,2,3]"],
    ];

    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(true);
    expect(pastedData).toEqual([
      ["row-1", '{"name":"Ada","locale":"日本語"}'],
      ["row-2", "[1,2,3]"],
    ]);
  });

  it("recovers pretty-printed multiline JSON while preserving trailing columns", () => {
    const json = '[\n  {\n    "partnerId": "3486020271629659",\n    "partnerName": "Antam"\n  }\n]';
    const clipboard = `1002\tGold Merchant Data\t"${json}"\t0\t2026-08-20 13:54:50.000`;
    const pastedData = [["1002", "Gold Merchant Data", json.replaceAll('"', ""), "0", "2026-08-20 13:54:50.000"]];

    expect(hasMalformedQuotedField(clipboard)).toBe(true);
    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(true);
    expect(pastedData).toEqual([["1002", "Gold Merchant Data", json, "0", "2026-08-20 13:54:50.000"]]);
  });

  it("preserves empty strings and escaped quotes in raw database JSON", () => {
    const json = '{\n  "empty": "",\n  "message": "He said \\"hello\\""\n}';
    const clipboard = `1\t"${json}"\tSYSTEM`;
    const pastedData = [["1", json.replaceAll('"', ""), "SYSTEM"]];

    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(true);
    expect(pastedData).toEqual([["1", json, "SYSTEM"]]);
  });

  it("recovers a multiline Velocity template before trailing columns", () => {
    const template =
      '#set($totalPieces = 0)\n\n{\n  "requestBodyTemplate": {\n    "eventCode": "gold-loan-success",\n    "branchName": "$!summary.branchName"\n  }\n}';
    const clipboard = `record-id\t"${template}"\tPROD\tpublisher`;
    const pastedData = [["record-id", template.replaceAll('"', ""), "PROD", "publisher"]];

    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(true);
    expect(pastedData).toEqual([["record-id", template, "PROD", "publisher"]]);
  });

  it("recovers quote characters around a JSON string scalar", () => {
    const pastedData = [["Ada"]];

    expect(recoverMalformedDatabaseClipboard('""Ada""', pastedData)).toBe(true);
    expect(pastedData).toEqual([['"Ada"']]);
  });

  it("recovers raw quotes in a non-JSON HTML field", () => {
    const clipboard = '1\t"<div class="card" data-id="7">Ada</div>"';
    const pastedData = [["1", "<div class=card data-id=7>Ada</div>"]];

    expect(hasMalformedQuotedField(clipboard)).toBe(true);
    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(true);
    expect(pastedData).toEqual([["1", '<div class="card" data-id="7">Ada</div>']]);
  });

  it("leaves standards-compliant and ordinary quoted TSV unchanged", () => {
    const clipboard = '"ordinary value"\t"{""name"":""Ada""}"';
    const pastedData = [["ordinary value", '{"name":"Ada"}']];

    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(false);
    expect(pastedData).toEqual([["ordinary value", '{"name":"Ada"}']]);
  });

  it("leaves standards-compliant escaped HTML quotes unchanged", () => {
    const clipboard = '1\t"<div class=""card"">Ada</div>"';
    const pastedData = [["1", '<div class="card">Ada</div>']];

    expect(hasMalformedQuotedField(clipboard)).toBe(false);
    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(false);
    expect(pastedData).toEqual([["1", '<div class="card">Ada</div>']]);
  });

  it("leaves an ordinary quoted multiline field unchanged", () => {
    const clipboard = '1\t"line one\nline two"\tSYSTEM';
    const pastedData = [["1", "line one\nline two", "SYSTEM"]];

    expect(hasMalformedQuotedField(clipboard)).toBe(false);
    expect(recoverMalformedDatabaseClipboard(clipboard, pastedData)).toBe(false);
    expect(pastedData).toEqual([["1", "line one\nline two", "SYSTEM"]]);
  });

  it("leaves an unrelated HTML-table parse unchanged", () => {
    const pastedData = [["value from HTML"]];

    expect(recoverMalformedDatabaseClipboard('"ordinary clipboard value"', pastedData)).toBe(false);
    expect(pastedData).toEqual([["value from HTML"]]);
  });
});
