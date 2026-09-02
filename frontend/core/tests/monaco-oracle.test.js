// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({
  editor: class EditorWorker {},
  json: class JsonWorker {},
  css: class CssWorker {},
  html: class HtmlWorker {},
  typescript: class TypeScriptWorker {},
}));

import { configureMonacoWorkers } from "../MonacoWorkers.js";

describe("Monaco worker routing", () => {
  it("uses language workers for language-service requests", () => {
    configureMonacoWorkers(self, { editor: workers.editor });
    configureMonacoWorkers(self, { json: workers.json, html: workers.html });
    configureMonacoWorkers(self, { css: workers.css, typescript: workers.typescript });
    const getWorker = self.MonacoEnvironment.getWorker;

    expect(getWorker("workerMain.js", "json")).toBeInstanceOf(workers.json);
    expect(getWorker("workerMain.js", "html")).toBeInstanceOf(workers.html);
    expect(getWorker("workerMain.js", "css")).toBeInstanceOf(workers.css);
    expect(getWorker("workerMain.js", "typescript")).toBeInstanceOf(workers.typescript);
    expect(getWorker("workerMain.js", "javascript")).toBeInstanceOf(workers.typescript);
    expect(getWorker("workerMain.js", "oracle-dml")).toBeInstanceOf(workers.editor);
  });
});
