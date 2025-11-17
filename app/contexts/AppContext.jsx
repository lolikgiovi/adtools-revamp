import React, { createContext, useContext, useState, useRef, useCallback } from "react";
import toolsConfig from "../config/tools.json";

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [tools, setTools] = useState(new Map());
  const [currentTool, setCurrentTool] = useState(null);
  const iconRegistry = useRef(new Map());
  const toolsConfigMap = useRef(new Map());
  const categoriesConfigMap = useRef(new Map());

  // Build tools config map
  const buildToolsConfigMap = useCallback(() => {
    const list = toolsConfig && toolsConfig.tools ? toolsConfig.tools : [];
    toolsConfigMap.current.clear();
    list.forEach((cfg) => {
      if (cfg && cfg.id) toolsConfigMap.current.set(cfg.id, cfg);
    });
  }, []);

  // Build categories config map
  const buildCategoriesConfigMap = useCallback(() => {
    const cats = toolsConfig && Array.isArray(toolsConfig.categories) ? toolsConfig.categories : [];
    categoriesConfigMap.current.clear();
    if (cats.length > 0) {
      cats.forEach((c) => {
        if (c && c.id) {
          categoriesConfigMap.current.set(String(c.id), {
            id: String(c.id),
            name: String(c.name || c.id),
            order: Number(c.order) || 0
          });
        }
      });
    } else {
      categoriesConfigMap.current.set("config", { id: "config", name: "Config", order: 10 });
      categoriesConfigMap.current.set("general", { id: "general", name: "General", order: 20 });
    }
  }, []);

  // Register a tool
  const registerTool = useCallback((tool, eventBus) => {
    const cfg = toolsConfigMap.current.get(tool.id);
    if (cfg) {
      if (typeof cfg.name === "string") tool.name = cfg.name;
      if (typeof cfg.icon === "string") tool.icon = cfg.icon;
      if (typeof cfg.category === "string") tool.category = cfg.category;
      tool.__config = cfg;
    }

    setTools((prevTools) => {
      const newTools = new Map(prevTools);
      newTools.set(tool.id, tool);
      return newTools;
    });

    if (eventBus) {
      eventBus.emit("tool:registered", { tool });
    }

    console.log(`Tool registered: ${tool.name}`);
  }, []);

  const value = {
    tools,
    currentTool,
    setCurrentTool,
    registerTool,
    iconRegistry: iconRegistry.current,
    toolsConfigMap: toolsConfigMap.current,
    categoriesConfigMap: categoriesConfigMap.current,
    buildToolsConfigMap,
    buildCategoriesConfigMap,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};
