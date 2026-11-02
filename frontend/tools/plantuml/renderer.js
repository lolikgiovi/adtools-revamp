import { nodePath } from "./workspace.js";

/** The engine requires DOM/font APIs. Keep it in a separate, network-restricted document. */
export class PlantUmlRenderer {
  constructor(host, onChange) {
    this.host = host;
    this.onChange = onChange;
    this.id = 0;
    this.ready = false;
    this.receive = (event) => {
      if (event.source !== this.frame?.contentWindow || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.kind === "ready") {
        clearTimeout(this.loadTimeout);
        this.ready = true;
        if (this.latest && !this.paused) this.render(...this.latest);
      } else if (data?.id === this.id && this.request) {
        if (data.kind === "result" && typeof data.svg === "string") {
          clearTimeout(this.renderTimeout);
          const request = this.request;
          this.request = null;
          this.onChange({ state: "ready", ...request, svg: data.svg, milliseconds: Math.round(performance.now() - request.start) });
        } else if (data.kind === "error" && typeof data.error === "string") {
          clearTimeout(this.renderTimeout);
          this.request = null;
          this.onChange({ state: "error", error: data.error });
        }
      }
    };
    window.addEventListener("message", this.receive);
    this.restart();
  }

  restart() {
    this.cancel();
    this.paused = false;
    clearTimeout(this.loadTimeout);
    this.ready = false;
    this.frame?.remove();
    this.frame = document.createElement("iframe");
    this.frame.title = "PlantUML rendering engine";
    this.frame.hidden = true;
    this.frame.src = new URL(`${import.meta.env.BASE_URL}plantuml/renderer-frame.html`, document.baseURI).href;
    this.host.append(this.frame);
    this.onChange({ state: "loading" });
    this.loadTimeout = setTimeout(
      () => this.onChange({ state: "error", error: "Renderer did not load. Restart the renderer to retry." }),
      30000,
    );
  }

  render(file, nodes) {
    this.cancel();
    this.paused = false;
    this.latest = [file, nodes];
    if (!file) return this.onChange({ state: "empty" });
    this.onChange({ state: this.ready ? "rendering" : "loading" });
    if (!this.ready) return;
    const id = this.id;
    this.timer = setTimeout(() => {
      this.request = { fileId: file.id, source: file.content, start: performance.now() };
      this.frame.contentWindow.postMessage(
        {
          kind: "render",
          id,
          source: file.content,
          path: nodePath(nodes, file.id),
          files: nodes.filter((node) => node.kind === "file").map((node) => ({ path: nodePath(nodes, node.id), content: node.content })),
        },
        location.origin === "null" ? "*" : location.origin,
      );
      this.renderTimeout = setTimeout(() => {
        this.cancel();
        this.onChange({ state: "error", error: "Rendering timed out. Simplify the diagram or restart the renderer." });
      }, 30000);
    }, 300);
  }

  cancel() {
    this.id++;
    this.request = null;
    clearTimeout(this.timer);
    clearTimeout(this.renderTimeout);
  }

  pause() {
    this.paused = true;
    this.cancel();
    clearTimeout(this.loadTimeout);
  }

  destroy() {
    this.pause();
    window.removeEventListener("message", this.receive);
    this.frame?.remove();
    this.latest = null;
  }
}
