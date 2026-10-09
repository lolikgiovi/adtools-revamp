// @vitest-environment jsdom
// Failure cases: desktop accidentally uses CORS fetch; native download fails;
// wrong URL/timeout; browser fallback regresses. Designed before implementation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageCheckerService } from "../service.js";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../core/Runtime.js";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("native image byte measurement", () => {
  it("counts downloaded bytes through the desktop HTTP client", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(123456);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await new ImageCheckerService({}).getImageSize("https://cdn.example/image.png", 3000)).toBe(123456);
    expect(invoke).toHaveBeenCalledWith("measure_image_size", { url: "https://cdn.example/image.png", timeoutMs: 3000 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps failed native downloads separate from image existence", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("HTTP 404"));
    expect(await new ImageCheckerService({}).getImageSize("https://cdn.example/missing.png")).toBeNull();
  });
  it("still measures fetched response bytes in the browser", async () => {
    isTauri.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["abc"]) }));
    expect(await new ImageCheckerService({}).getImageSize("https://cdn.example/image.png")).toBe(3);
    expect(invoke).not.toHaveBeenCalled();
  });
});
