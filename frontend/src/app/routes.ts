import toolsConfig from "../../config/tools.json";

type ToolConfig = { id: string; name: string; category: string; icon?: string; order: number; requiresTauri?: boolean };
type CategoryConfig = { id: string; name: string; order: number; requiresTauri?: boolean };

const registry = toolsConfig as { tools: ToolConfig[]; categories: CategoryConfig[] };

export const categories = [...registry.categories].sort((a, b) => a.order - b.order);
export const tools = [...registry.tools].sort((a, b) => a.order - b.order);
export const toolById = new Map(tools.map((tool) => [tool.id, tool]));

// React Router expects a slash inside the hash. Existing links use #<tool-id>.
export function normalizeLegacyHash(): void {
  const hash = window.location.hash;
  if (!hash || hash.startsWith("#/")) return;
  const path = hash.slice(1);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/${path}`);
}
