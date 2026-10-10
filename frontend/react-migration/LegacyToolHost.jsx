import React, { useEffect, useRef, useState } from "react";
import { EventBus } from "../core/EventBus.js";
import { buildToolDefinitions } from "../config/toolDefinitions.js";
import toolsConfig from "../config/tools.json";

const definitions = buildToolDefinitions(toolsConfig.tools);
const eventBus = new EventBus();

export function LegacyToolHost({ toolId }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let tool = null;
    const container = containerRef.current;
    const definition = definitions.get(toolId);

    if (!definition) {
      setError(`Unknown tool: ${toolId}`);
      return undefined;
    }

    definition
      .load()
      .then(({ ToolClass, createTool }) => {
        if (cancelled) return;
        tool = createTool ? createTool(eventBus) : new ToolClass(eventBus);
        tool.mount(container);
        tool.activate();
      })
      .catch((cause) => {
        if (!cancelled) setError(`Could not load ${definition.name}: ${cause.message}`);
      });

    return () => {
      cancelled = true;
      if (tool) {
        tool.deactivate();
        tool.unmount();
        tool.disposeHeavyResources?.("route-change");
      }
    };
  }, [toolId]);

  return error ? <p role="alert">{error}</p> : <div ref={containerRef} className="tool-root" data-tool-root={toolId} />;
}
