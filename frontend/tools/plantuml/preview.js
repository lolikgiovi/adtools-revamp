export class DiagramPreview {
  constructor(viewport, signal, onScaleChange = () => {}) {
    this.onScaleChange = onScaleChange;
    this.viewport = viewport;
    this.image = viewport.querySelector("img");
    this.size = { width: 600, height: 500 };
    this.pointers = new Map();
    this.reset();
    viewport.addEventListener("dblclick", () => this.reset(), { signal });
    viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        if (event.ctrlKey || event.metaKey) this.zoom(Math.exp(-event.deltaY * unit * 0.01), event.clientX, event.clientY);
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
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      },
      { signal },
    );
    viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!this.pointers.has(event.pointerId)) return;
        const before = this.gesture();
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = this.gesture();
        // Move the pinch midpoint first; zoom preserves the diagram point beneath that midpoint.
        this.x += after.x - before.x;
        this.y += after.y - before.y;
        if (before.distance > 0 && after.distance > 0) this.zoom(after.distance / before.distance, after.x, after.y);
        else this.layout();
      },
      { signal },
    );
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      viewport.addEventListener(event, (event) => this.pointers.delete(event.pointerId), { signal });
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
    this.pointers?.clear();
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

  gesture() {
    const [first, second] = [...this.pointers.values()];
    if (!second) return { ...first, distance: 0 };
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  }

  zoom(factor, clientX, clientY) {
    const previous = this.currentScale();
    this.scale = Math.max(0.05, Math.min(4, previous * factor));
    const rect = this.viewport.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    const ratio = this.scale / previous;
    this.x = x - (x - this.x) * ratio;
    this.y = y - (y - this.y) * ratio;
    this.layout();
  }

  layout() {
    const scale = this.currentScale();
    // Allow 30% overscroll past each edge, keeping the diagram reachable at every scale.
    const limit = (image, viewport) => Math.max(0, (image * scale - viewport) / 2) + Math.min(image * scale, viewport) * 0.3;
    const maxX = limit(this.size.width, this.viewport.clientWidth);
    const maxY = limit(this.size.height, this.viewport.clientHeight);
    this.x = Math.max(-maxX, Math.min(maxX, this.x));
    this.y = Math.max(-maxY, Math.min(maxY, this.y));
    this.onScaleChange(scale, this.scale === null);
    this.image.style.transform = `translate(${this.x}px, ${this.y}px) scale(${scale})`;
  }

  destroy() {
    this.observer.disconnect();
    this.clear();
  }
}
