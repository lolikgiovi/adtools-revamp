import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useEventBus } from "../contexts/EventBusContext.jsx";
import toolsConfig from "../config/tools.json";
import { isTauri } from "../core/Runtime.js";
import { categorizeTool } from "../core/Categories.js";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

// Icon imports - we'll import these dynamically
const toolIcons = {
  uuid: () => import("../tools/uuid-generator/icon.js"),
  json: () => import("../tools/json-tools/icon.js"),
  base64: () => import("../tools/base64-tools/icon.js"),
  qr: () => import("../tools/qr-tools/icon.js"),
  database: () => import("../tools/quick-query/icon.js"),
  jenkins: () => import("../tools/jenkins-runner/icon.js"),
  html: () => import("../tools/html-editor/icon.js"),
  "splunk-template": () => import("../tools/splunk-template/icon.js"),
  "sql-in": () => import("../tools/sql-in-clause/icon.js"),
  "image-check": () => import("../tools/image-checker/icon.js"),
  settings: () => import("../pages/settings/icon.js"),
  about: () => import("../pages/about/icon.js"),
};

const SidebarItem = ({ id, name, icon, onClick, isActive, type = "tool" }) => {
  const [iconSvg, setIconSvg] = useState(null);

  useEffect(() => {
    const loadIcon = async () => {
      if (toolIcons[icon]) {
        try {
          const iconModule = await toolIcons[icon]();
          if (iconModule && typeof iconModule.getIconSvg === "function") {
            setIconSvg(iconModule.getIconSvg());
          }
        } catch (err) {
          console.warn(`Failed to load icon: ${icon}`, err);
        }
      }
    };
    loadIcon();
  }, [icon]);

  return (
    <div className={cn("sidebar-menu-item", type === "page" && "sidebar-footer-item")}>
      <button
        className={cn("sidebar-menu-button", isActive && "active")}
        onClick={onClick}
        type="button"
        data-active={isActive}
      >
        {iconSvg ? (
          <span
            className="sidebar-menu-icon"
            dangerouslySetInnerHTML={{ __html: iconSvg }}
          />
        ) : (
          <div className="sidebar-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v10" />
              <path d="M7 12h10" />
            </svg>
          </div>
        )}
        <span>{name}</span>
      </button>
    </div>
  );
};

const SidebarCategory = ({ category, tools, activeToolId, onToolClick }) => {
  if (tools.length === 0) return null;

  return (
    <div className="sidebar-group" data-category={category.id}>
      <div className="sidebar-group-label">{category.name}</div>
      <div className="sidebar-group-content">
        <div className="sidebar-menu" data-category={category.id}>
          {tools.map((tool) => (
            <SidebarItem
              key={tool.id}
              id={tool.id}
              name={tool.name}
              icon={tool.icon}
              onClick={() => onToolClick(tool.id)}
              isActive={activeToolId === tool.id}
              type="tool"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default function Sidebar({ isExpanded, isMobile, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const eventBus = useEventBus();
  const [categories, setCategories] = useState([]);
  const [toolsByCategory, setToolsByCategory] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [runtimeIsTauri, setRuntimeIsTauri] = useState(false);

  // Check runtime
  useEffect(() => {
    const checkRuntime = () => {
      setRuntimeIsTauri(isTauri());
    };
    checkRuntime();
    // Recheck after a short delay for late Tauri initialization
    const timer = setTimeout(checkRuntime, 200);
    return () => clearTimeout(timer);
  }, []);

  // Build categories from config
  useEffect(() => {
    const cats = toolsConfig.categories || [];
    const sortedCategories = cats
      .map((c) => ({
        id: c.id,
        name: c.name || c.id,
        order: c.order || 0,
      }))
      .sort((a, b) => a.order - b.order);
    setCategories(sortedCategories);
  }, []);

  // Build tools by category
  useEffect(() => {
    const tools = toolsConfig.tools || [];

    // Filter and sort tools
    const filteredTools = tools
      .filter((tool) => {
        const enabled = tool.enabled !== false;
        const showInSidebar = tool.showInSidebar !== false;
        const requiresTauriOk = tool.requiresTauri ? runtimeIsTauri : true;
        return enabled && showInSidebar && requiresTauriOk;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Group by category
    const grouped = filteredTools.reduce((acc, tool) => {
      const category = tool.category || "general";
      if (!acc[category]) acc[category] = [];
      acc[category].push(tool);
      return acc;
    }, {});

    setToolsByCategory(grouped);
  }, [runtimeIsTauri]);

  // Update active ID based on location
  useEffect(() => {
    const path = location.pathname;
    if (path === "/" || path === "/home") {
      setActiveId(null);
    } else {
      // Extract tool/page ID from path
      const id = path.substring(1).split("/")[0];
      setActiveId(id);
    }
  }, [location]);

  const handleToolClick = useCallback(
    (toolId) => {
      navigate(`/${toolId}`);
      if (eventBus) {
        eventBus.emit("tool:activate", { toolId });
      }
      // Close sidebar on mobile
      if (isMobile && onClose) {
        setTimeout(() => onClose(), 150);
      }
    },
    [navigate, eventBus, isMobile, onClose]
  );

  const handlePageClick = useCallback(
    (pageId) => {
      navigate(`/${pageId}`);
      if (eventBus) {
        eventBus.emit("page:navigate", { pageId });
      }
      // Close sidebar on mobile
      if (isMobile && onClose) {
        setTimeout(() => onClose(), 150);
      }
    },
    [navigate, eventBus, isMobile, onClose]
  );

  return (
    <>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div className="sidebar-header-content">
          <h2 className="sidebar-title">
            {typeof localStorage !== "undefined" && localStorage.getItem("user.username")
              ? `Hi, ${String(localStorage.getItem("user.username")).slice(0, 15)}`
              : "AD Tools"}
          </h2>
        </div>
      </div>

      {/* Sidebar Content */}
      <div className="sidebar-content">
        {categories.map((category) => (
          <SidebarCategory
            key={category.id}
            category={category}
            tools={toolsByCategory[category.id] || []}
            activeToolId={activeId}
            onToolClick={handleToolClick}
          />
        ))}
      </div>

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-menu" data-group="footer">
          <SidebarItem
            id="about"
            name="About"
            icon="about"
            onClick={() => handlePageClick("about")}
            isActive={activeId === "about"}
            type="page"
          />
          <SidebarItem
            id="settings"
            name="Settings"
            icon="settings"
            onClick={() => handlePageClick("settings")}
            isActive={activeId === "settings"}
            type="page"
          />
        </div>
      </div>
    </>
  );
}
