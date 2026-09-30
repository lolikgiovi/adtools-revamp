import {
  analyzeHtmlEncoding, convertHtmlForToad, decodeHtmlBytes, listEncodingCharacters, prepareToadSafeHtmlBytes, prepareUtf8HtmlBytes,
  simulateWindows1252Import,
  markEncodingPreview,
} from "../encoding.js";

// Failure modes: source bytes decoded with the wrong charset, preexisting mojibake,
// replacement characters, conflicting HTML declarations, and export changing the draft.
describe("HTML editor encoding", () => {
  it("imports UTF-8 with a BOM and preserves Unicode punctuation", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<meta charset="utf-8"><p>“Hi” — it’s fine</p>')]);
    const result = decodeHtmlBytes(bytes);
    expect(result.encoding).toBe("utf-8");
    expect(result.html).toContain("“Hi” — it’s fine");
    expect(result.html).not.toMatch(/^\uFEFF/);
  });

  it("honors a declared Windows-1252 source instead of replacing smart quotes", () => {
    const prefix = new TextEncoder().encode('<meta charset="windows-1252"><p>');
    const suffix = new TextEncoder().encode("</p>");
    const result = decodeHtmlBytes(new Uint8Array([...prefix, 0x93, 0x94, ...suffix]));
    expect(result.encoding).toBe("windows-1252");
    expect(result.html).toContain("“”");
  });

  it("does not silently corrupt invalid undeclared UTF-8", () => {
    expect(() => decodeHtmlBytes(new Uint8Array([0x93, 0x94]))).toThrow(/UTF-8/);
  });

  it("distinguishes valid smart punctuation from likely mojibake", () => {
    expect(analyzeHtmlEncoding('<meta charset="utf-8"><p>“Hi” — it’s fine</p>').issues.map((issue) => issue.code)).toEqual(["non_ascii"]);
    expect(analyzeHtmlEncoding('<p>itâ€™s fine â€“ okay Â </p>').issues.map((issue) => issue.code)).toContain("mojibake");
    expect(analyzeHtmlEncoding("<p>stray Â here</p>").issues.map((issue) => issue.code)).toContain("mojibake");
    expect(analyzeHtmlEncoding("<p>lost � text</p>").issues.map((issue) => issue.code)).toContain("replacement");
  });

  it("flags invisible nonbreaking spaces before Windows import corrupts them", () => {
    const result = analyzeHtmlEncoding('<meta charset="utf-8"><li>Text. </li><li>More. </li>');
    expect(result.issues.map((issue) => issue.code)).toEqual(["non_ascii"]);
    expect(result.issues[0].message).toMatch(/2 non-ASCII characters.*U\+00A0/);
  });

  it("makes text and attributes ASCII-safe without changing HTML rendering semantics", () => {
    const html = '<html><head><meta charset="utf-8"></head><body><p title="It’s fine">“Hi” — yes</p></body></html>';
    const output = new TextDecoder().decode(prepareToadSafeHtmlBytes(html));
    expect(output).toContain('title="It&#8217;s fine"');
    expect(output).toContain('>&#8220;Hi&#8221;&#160;&#8212; yes</p>');
    expect([...output].every((char) => char.codePointAt(0) < 128)).toBe(true);
    expect(html).toContain("“Hi”");
  });

  it("refuses automatic replacement when non-ASCII is embedded in code or comments", () => {
    expect(() => prepareToadSafeHtmlBytes('<script>const word = "é";</script>')).toThrow(/script/i);
    expect(() => prepareToadSafeHtmlBytes("<style>/* é */</style>")).toThrow(/style/i);
    expect(() => prepareToadSafeHtmlBytes("<!-- é -->")).toThrow(/comment/i);
  });

  it("lists risky characters with line locations and illustrative Windows decoding", () => {
    const findings = listEncodingCharacters("<p>A </p>\n<p>B  and ’</p>");
    expect(findings).toEqual([
      expect.objectContaining({ character: " ", codePoint: "U+00A0", count: 2, firstLine: 1, simulated: "Â ", replacement: "&#160;" }),
      expect.objectContaining({ character: "’", codePoint: "U+2019", count: 1, firstLine: 2, simulated: "â€™", replacement: "&#8217;" }),
    ]);
    expect(findings[0].offsets).toHaveLength(2);
  });

  it("returns the exact edited HTML for diff review and undoable replacement", () => {
    expect(convertHtmlForToad("<p>“Hi” </p>")).toBe("<p>&#8220;Hi&#8221;&#160;</p>");
  });

  it("simulates UTF-8 bytes decoded as Windows-1252 for the rendered preview", () => {
    expect(simulateWindows1252Import("<p>It’s — fine</p>")).toBe("<p>Itâ€™sÂ â€” fine</p>");
    expect(simulateWindows1252Import(convertHtmlForToad("<p>It’s — fine</p>"))).toBe("<p>It&#8217;s&#160;&#8212; fine</p>");
  });

  it("marks visible rendered text without changing tags, attributes, scripts, or styles", () => {
    const html = '<style>p::after{content:"Â "}</style><p title="Â ">AÂ B</p><script>const x="Â ";</script>';
    const marked = markEncodingPreview(html, "Â ");
    expect(marked).toContain('title="Â "');
    expect(marked).toContain('<mark class="adtools-encoding-preview-mark">Â </mark>');
    expect(marked).toContain('const x="Â ";');
    expect(marked).toContain('content:"Â "');
    expect(markEncodingPreview("<p>A&#160;B</p>", "&#160;")).toContain('<mark class="adtools-encoding-preview-mark">&#160;</mark>');
  });

  it("flags a conflicting charset and exports matching UTF-8 bytes without editing input", () => {
    const html = '<!doctype html><html><head><meta charset="windows-1252"><title>Hi</title></head><body>It’s okay</body></html>';
    expect(analyzeHtmlEncoding(html).issues.map((issue) => issue.code)).toContain("charset");
    const bytes = prepareUtf8HtmlBytes(html);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8").decode(bytes)).toContain('<meta charset="utf-8">');
    expect(new TextDecoder("utf-8").decode(bytes)).toContain("It’s okay");
    expect(html).toContain("windows-1252");
  });

  it("adds a charset near the start of head and preserves fragments", () => {
    expect(new TextDecoder().decode(prepareUtf8HtmlBytes("<html><head><title>x</title></head><body>é</body></html>"))).toContain(
      '<head><meta charset="utf-8"><title>x</title>',
    );
    expect(new TextDecoder().decode(prepareUtf8HtmlBytes("<p>é</p>"))).toBe("<p>é</p>");
  });

  it("removes every conflicting declaration in a full document", () => {
    const html = '<html><head><meta charset="windows-1252"><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head></html>';
    const output = new TextDecoder().decode(prepareUtf8HtmlBytes(html));
    expect(output.match(/charset=/gi)).toHaveLength(1);
    expect(output).toContain('<meta charset="utf-8">');
  });
});
