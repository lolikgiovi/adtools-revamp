export class DiagramPreview {
  constructor(viewport, signal) {
    this.viewport = viewport;
    this.image = viewport.querySelector("img");
    this.size = { width: 600, height: 500 };
    this.reset();
    viewport.addEventListener("dblclick", () => this.reset(), { signal });
    viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        if (event.ctrlKey || event.metaKey) this.zoom(Math.exp(-event.deltaY * unit * 0.01));
        else {
          this.x -= event.deltaX * unit;
          this.y -= event.deltaY * unit;
          this.layout();
        }
      },
      { passive: false, signal },
    );
    viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        viewport.setPointerCapture(event.pointerId);
        this.drag = { x: event.clientX, y: event.clientY, panX: this.x, panY: this.y };
      },
      { signal },
    );
    viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!this.drag) return;
        this.x = this.drag.panX + event.clientX - this.drag.x;
        this.y = this.drag.panY + event.clientY - this.drag.y;
        this.layout();
      },
      { signal },
    );
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      viewport.addEventListener(
        event,
        () => {
          this.drag = null;
        },
        { signal },
      );
    viewport.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "+" || event.key === "=") this.zoom(1.2);
        else if (event.key === "-") this.zoom(1 / 1.2);
        else if (event.key === "0") this.reset();
      },
      { signal },
    );
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(viewport);
  }

  show(svg, name) {
    const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    this.size = { width: parseFloat(root.getAttribute("width")) || 600, height: parseFloat(root.getAttribute("height")) || 500 };
    this.clear();
    // SVG is displayed as an image document, so it cannot execute scripts or alter the app DOM.
    this.url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    this.image.src = this.url;
    this.image.alt = `Rendered ${name}`;
    this.image.hidden = false;
    this.image.width = this.size.width;
    this.image.height = this.size.height;
    this.viewport.querySelector("span").hidden = true;
    this.layout();
  }

  clear() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.image.removeAttribute("src");
    this.image.hidden = true;
  }

  reset() {
    this.scale = null;
    this.x = this.y = 0;
    this.layout();
  }

  currentScale() {
    return (
      this.scale ??
      Math.max(0.05, Math.min(1, (this.viewport.clientWidth - 40) / this.size.width, (this.viewport.clientHeight - 40) / this.size.height))
    );
  }

  zoom(factor) {
    this.scale = Math.max(0.05, Math.min(4, this.currentScale() * factor));
    this.layout();
  }

  layout() {
    this.image.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.currentScale()})`;
  }

  destroy() {
    this.observer.disconnect();
    this.clear();
  }
}
