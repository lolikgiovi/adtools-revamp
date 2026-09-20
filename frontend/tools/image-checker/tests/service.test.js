// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageCheckerService } from "../service.js";

function installImageMock({ failuresBeforeSuccess = 0 } = {}) {
  const instances = [];
  let loadAttempts = 0;

  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 320;
      this.naturalHeight = 180;
      this._src = "";
      instances.push(this);
    }

    set src(value) {
      this._src = value;
      if (!value) return;

      const attempt = ++loadAttempts;
      queueMicrotask(() => {
        if (this._src !== value) return;
        if (attempt <= failuresBeforeSuccess) this.onerror?.();
        else this.onload?.();
      });
    }

    get src() {
      return this._src;
    }

    decode() {
      return Promise.resolve();
    }
  }

  vi.stubGlobal("Image", MockImage);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ImageCheckerService image loading", () => {
  it("probes the CDN with an eager image load", async () => {
    vi.useFakeTimers();
    const instances = installImageMock();
    const service = new ImageCheckerService({});
    const resultPromise = service.checkImageOnce("https://cdn.example/image.png", 100);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({ exists: true, width: 320, height: 180 });
    expect(result).not.toHaveProperty("image");
    expect(instances[0].src).toContain("cb=");
  });

  it("retries a transient image load error before reporting it as missing", async () => {
    vi.useFakeTimers();
    const instances = installImageMock({ failuresBeforeSuccess: 1 });
    const service = new ImageCheckerService({});
    const resultPromise = service.checkImage("https://cdn.example", "/image.png", 100, 2);

    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({ exists: true });
    expect(instances).toHaveLength(2);
  });
});
