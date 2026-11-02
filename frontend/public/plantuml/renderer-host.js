import { renderToString } from "./engine/plantuml.js";

globalThis.PLANTUML_STDLIB_BASE = new URL("./engine/", location.href).href;
let running = false;
let pending = null;

function resolvePath(path, from) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) throw new Error("Remote resources are disabled.");
  const parts = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("Include is outside the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function run() {
  if (running || !pending) return;
  const request = pending;
  pending = null;
  running = true;
  let loaderError = "";
  const files = new Map(request.files.map((file) => [file.path, file.content]));
  globalThis.PLANTUML_FILE_LOADER = (path, from, ok, err) => {
    try {
      const id = resolvePath(path, from ?? request.path);
      const content = files.get(id);
      if (content === undefined) throw new Error(`Cannot include "${path}" from ${from ?? request.path}`);
      ok(id, content);
    } catch (error) {
      loaderError = String(error.message ?? error);
      err(loaderError);
    }
  };
  const finish = (result) => {
    parent.postMessage({ id: request.id, ...result }, location.origin === "null" ? "*" : location.origin);
    running = false;
    run();
  };
  try {
    if (/^\s*!(?:include(?:url|_once|_many)?|includesub|theme)\b[^\n]*https?:\/\//im.test(request.source)) {
      throw new Error("Remote includes are disabled. Import the file into your workspace.");
    }
    renderToString(
      request.source.split(/\r\n|\r|\n/),
      (svg) => {
        const document = new DOMParser().parseFromString(svg, "image/svg+xml");
        const text = document.documentElement.textContent ?? "";
        if (loaderError) finish({ kind: "error", error: loaderError });
        else if (
          /(?:Syntax Error|Error line \d+|No valid diagram found|cannot include)/i.test(text) &&
          /(?:\[From [^\]]*\(line \d+\)|PlantUML version)/i.test(text)
        ) {
          // Engine error SVGs include build/version placeholders and a concatenated source dump.
          // Report the actionable location instead of presenting that internal diagnostic document.
          const location = /(?:From textarea\s*\(line\s+|Error line\s+)(\d+)/i.exec(text);
          const line = location ? Number(location[1]) : null;
          const error = /No valid diagram found/i.test(text)
            ? "No diagram found. Wrap the source in @startuml and @enduml."
            : line
              ? `Syntax error on line ${line}. Check this line and any unfinished blocks above it.`
              : "The diagram contains a syntax error. Check the source and any unfinished blocks.";
          finish({ kind: "error", error, line });
        } else finish({ kind: "result", svg });
      },
      () => finish({ kind: "error", error: "The renderer could not finish. Try again or restart the renderer." }),
    );
  } catch (error) {
    finish({
      kind: "error",
      error: /^(?:Remote|Include|Cannot include)/.test(error.message || "")
        ? error.message
        : "The renderer could not finish. Try again or restart the renderer.",
    });
  }
}

addEventListener("message", (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const data = event.data;
  if (
    !data ||
    data.kind !== "render" ||
    typeof data.id !== "number" ||
    typeof data.source !== "string" ||
    typeof data.path !== "string" ||
    !Array.isArray(data.files) ||
    !data.files.every((file) => typeof file?.path === "string" && typeof file?.content === "string")
  )
    return;
  pending = data;
  run();
});
parent.postMessage({ kind: "ready" }, location.origin === "null" ? "*" : location.origin);
