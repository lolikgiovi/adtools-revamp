import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { withEncodingPreviewBridge, previewBridgeScript } from "../previewBridge.js";

// Failure modes: a release CSP blocks the injected script, dynamic values alter its hash,
// or a selected occurrence is not passed to the preview frame.
describe("HTML encoding preview bridge", () => {
  it("allows its fixed script under the desktop release CSP", () => {
    const config = JSON.parse(readFileSync("tauri/tauri.conf.json", "utf8"));
    const hash = createHash("sha256").update(previewBridgeScript).digest("base64");
    expect(config.app.security.csp).toContain(`'sha256-${hash}'`);
  });

  it("passes the selected occurrence without changing the script body", () => {
    const first = withEncodingPreviewBridge("<p>First</p>", { key: "one", target: true });
    const next = withEncodingPreviewBridge("<p>Next</p>", { key: "two", target: true });
    expect(first).toContain('data-encoding-target="adtools-encoding-target"');
    expect(first).toContain('data-preview-key="one"');
    expect(next).toContain('data-preview-key="two"');
    expect(first).toContain(previewBridgeScript);
    expect(next).toContain(previewBridgeScript);
  });
});
