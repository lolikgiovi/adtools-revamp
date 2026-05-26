import minifierSource from "../vendor/htmlminifier.min.js?raw";
import {
  MINIFIER_INVALID_RESULT_MESSAGE,
  MINIFIER_OPTIONS,
  loadHtmlMinifier,
  normalizeMinifiedHtml,
  parseCdnPackageInfo,
} from "../minifierEngine.js";

describe("html minifier engine", () => {
  it("loads the vendored html-minifier package", () => {
    const minify = loadHtmlMinifier(minifierSource, {
      minify: () => "unsafe-global-fallback",
      htmlMinifier: { minify: () => "unsafe-global-fallback" },
    });

    expect(typeof minify).toBe("function");
    expect(minify("<div>  hello </div>", MINIFIER_OPTIONS)).toBe("<div>hello</div>");
  });

  it("does not fall back to global minify functions", () => {
    const minify = loadHtmlMinifier("self.minify = () => 'unsafe-global-fallback';", {
      minify: () => "unsafe-global-fallback",
      htmlMinifier: { minify: () => "unsafe-global-fallback" },
    });

    expect(minify).toBeNull();
  });

  it("rejects non-string minifier results instead of producing empty output", () => {
    expect(() => normalizeMinifiedHtml(undefined)).toThrow(MINIFIER_INVALID_RESULT_MESSAGE);
  });

  it("reports the vendored package identity", () => {
    expect(parseCdnPackageInfo(minifierSource)).toMatchObject({
      name: "html-minifier",
      version: "4.0.0",
      npmUrl: "https://www.npmjs.com/package/html-minifier/v/4.0.0",
    });
  });
});
