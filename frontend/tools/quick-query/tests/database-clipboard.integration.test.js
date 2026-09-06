// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hasMalformedQuotedField, recoverMalformedDatabaseClipboard } from "../services/DatabaseClipboardService.js";

describe("database clipboard Handsontable integration", () => {
  let Handsontable;
  let originalIntersectionObserver;
  let originalResizeObserver;
  let originalScrollIntoView;
  let table;

  beforeAll(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    originalIntersectionObserver = globalThis.IntersectionObserver;
    originalScrollIntoView = globalThis.HTMLElement.prototype.scrollIntoView;
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}

      unobserve() {}

      disconnect() {}
    };
    globalThis.IntersectionObserver = class IntersectionObserver {
      observe() {}

      unobserve() {}

      disconnect() {}
    };
    globalThis.HTMLElement.prototype.scrollIntoView = () => {};

    ({ default: Handsontable } = await import("handsontable"));
    const { registerAllModules } = await import("handsontable/registry");
    registerAllModules();
  });

  afterAll(() => {
    if (originalResizeObserver === undefined) {
      delete globalThis.ResizeObserver;
    } else {
      globalThis.ResizeObserver = originalResizeObserver;
    }
    if (originalIntersectionObserver === undefined) {
      delete globalThis.IntersectionObserver;
    } else {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
    if (originalScrollIntoView === undefined) {
      delete globalThis.HTMLElement.prototype.scrollIntoView;
    } else {
      globalThis.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  afterEach(() => {
    table?.destroy();
    table = null;
    document.body.replaceChildren();
  });

  it("preserves raw JSON quotes through a real paste event", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let pendingClipboardText = null;

    container.addEventListener(
      "paste",
      (event) => {
        const clipboardText = event.clipboardData?.getData("text/plain");
        pendingClipboardText = hasMalformedQuotedField(clipboardText) ? clipboardText : null;
      },
      true,
    );

    table = new Handsontable(container, {
      data: [[null, null]],
      columns: [{ type: "text" }, { type: "text" }],
      beforePaste: (pastedData) => {
        recoverMalformedDatabaseClipboard(pendingClipboardText, pastedData);
        pendingClipboardText = null;
      },
      licenseKey: "non-commercial-and-evaluation",
    });
    table.selectCell(0, 0);
    table.listen();

    const clipboardText = '1\t"{"name":"Ada","active":true}"';
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? clipboardText : ""),
      },
    });
    const pasteTarget = container.querySelector("[data-hot-input]") || container;
    pasteTarget.dispatchEvent(pasteEvent);

    expect(table.getDataAtRow(0).slice(0, 2)).toEqual(["1", '{"name":"Ada","active":true}']);
  });

  it("preserves multiline JSON and trailing columns from DBeaver TSV", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let pendingClipboardText = null;

    container.addEventListener(
      "paste",
      (event) => {
        const clipboardText = event.clipboardData?.getData("text/plain");
        pendingClipboardText = hasMalformedQuotedField(clipboardText) ? clipboardText : null;
      },
      true,
    );

    table = new Handsontable(container, {
      data: [[null, null, null, null, null]],
      columns: Array.from({ length: 5 }, () => ({ type: "text" })),
      beforePaste: (pastedData) => {
        recoverMalformedDatabaseClipboard(pendingClipboardText, pastedData);
        pendingClipboardText = null;
      },
      licenseKey: "non-commercial-and-evaluation",
    });
    table.selectCell(0, 0);
    table.listen();

    const json = '[\n  {\n    "partnerId": "3486020271629659",\n    "partnerName": "Antam"\n  }\n]';
    const clipboardText = `1002\tGold Merchant Data\t"${json}"\t0\t2026-08-20 13:54:50.000`;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? clipboardText : ""),
      },
    });
    const pasteTarget = container.querySelector("[data-hot-input]") || container;
    pasteTarget.dispatchEvent(pasteEvent);

    expect(table.getDataAtRow(0).slice(0, 5)).toEqual(["1002", "Gold Merchant Data", json, "0", "2026-08-20 13:54:50.000"]);
  });

  it("preserves unquoted HTML fields and surrounding columns from DBeaver TSV", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let pendingClipboardText = null;

    container.addEventListener(
      "paste",
      (event) => {
        const clipboardText = event.clipboardData?.getData("text/plain");
        pendingClipboardText = hasMalformedQuotedField(clipboardText) ? clipboardText : null;
      },
      true,
    );

    table = new Handsontable(container, {
      data: [[null, null, null, null, null, null]],
      columns: Array.from({ length: 6 }, () => ({ type: "text" })),
      beforePaste: (pastedData) => {
        recoverMalformedDatabaseClipboard(pendingClipboardText, pastedData);
        pendingClipboardText = null;
      },
      licenseKey: "non-commercial-and-evaluation",
    });
    table.selectCell(0, 0);
    table.listen();

    const englishHtml =
      '<!DOCTYPE html><html><body><a href="https://example.test/${baseUrl}" target="_blank">Let\'s Store Your Gold!</a></body></html>';
    const indonesianHtml = '<html><body><img src="${baseUrl}/logo.png" alt="logo"/><p>Halo ${fullName}</p></body></html>';
    const clipboardText = `4af62113\tR27\tSYSTEM\t${englishHtml}\t${indonesianHtml}\t1`;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? clipboardText : ""),
      },
    });
    const pasteTarget = container.querySelector("[data-hot-input]") || container;
    pasteTarget.dispatchEvent(pasteEvent);

    expect(table.getDataAtRow(0).slice(0, 6)).toEqual(["4af62113", "R27", "SYSTEM", englishHtml, indonesianHtml, "1"]);
  });

  it("preserves a multiline Velocity template and trailing columns from DBeaver TSV", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let pendingClipboardText = null;

    container.addEventListener(
      "paste",
      (event) => {
        const clipboardText = event.clipboardData?.getData("text/plain");
        pendingClipboardText = hasMalformedQuotedField(clipboardText) ? clipboardText : null;
      },
      true,
    );

    table = new Handsontable(container, {
      data: [[null, null, null, null]],
      columns: Array.from({ length: 4 }, () => ({ type: "text" })),
      beforePaste: (pastedData) => {
        recoverMalformedDatabaseClipboard(pendingClipboardText, pastedData);
        pendingClipboardText = null;
      },
      licenseKey: "non-commercial-and-evaluation",
    });
    table.selectCell(0, 0);
    table.listen();

    const template =
      '#set($totalPieces = 0)\n\n#foreach($asset in $assets)\n  #set($totalPieces = $totalPieces + $asset.quantity)\n#end\n\n{\n  "requestBodyTemplate": {\n    "eventCode": "gold-loan-success",\n    "branchName": "$!summary.branchName"\n  }\n}';
    const clipboardText = `record-id\t"${template}"\tPROD\tpublisher`;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? clipboardText : ""),
      },
    });
    const pasteTarget = container.querySelector("[data-hot-input]") || container;
    pasteTarget.dispatchEvent(pasteEvent);

    expect(table.getDataAtRow(0).slice(0, 4)).toEqual(["record-id", template, "PROD", "publisher"]);
  });
});
