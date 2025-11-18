import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEventBus } from "../contexts/EventBusContext.jsx";
import { isTauri } from "../core/Runtime.js";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar.jsx";
import NotificationContainer from "./Notification.jsx";

export default function Layout({ children }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [currentPage, setCurrentPage] = useState("Home");
  const eventBus = useEventBus();
  const location = useLocation();
  const navigate = useNavigate();

  // Handle responsive behavior
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarExpanded(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    // Update current page based on location
    const path = location.pathname;
    if (path === "/" || path === "/home") {
      setCurrentPage("Home");
    } else if (path === "/settings") {
      setCurrentPage("Settings");
    } else if (path === "/about") {
      setCurrentPage("About");
    } else {
      // Extract tool name from path
      const toolName = path.substring(1).split("/")[0];
      setCurrentPage(toolName.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
  }, [location]);

  const toggleSidebar = () => {
    setSidebarExpanded(!sidebarExpanded);
  };

  const closeSidebar = () => {
    setSidebarExpanded(false);
  };

  const handleReload = () => {
    try {
      window.location.reload();
    } catch (err) {
      try {
        window.location.href = window.location.href;
      } catch (_) {}
    }
  };

  const handleNavigateHome = () => {
    navigate("/home");
  };

  const runtime = isTauri() ? "tauri" : "web";

  return (
    <div className="sidebar-provider" data-sidebar="sidebar">
      {/* Sidebar */}
      <aside
        className={cn("sidebar", sidebarExpanded ? "expanded" : "collapsed")}
        id="sidebar"
        role="navigation"
        aria-label="Main navigation"
        data-state={sidebarExpanded ? "expanded" : "collapsed"}
        data-mobile={isMobile}
      >
        <Sidebar
          isExpanded={sidebarExpanded}
          isMobile={isMobile}
          onClose={closeSidebar}
        />
      </aside>

      {/* Main content */}
      <main className="main">
        {/* Header */}
        <header className="main-header" data-runtime={runtime}>
          <button className="sidebar-trigger" aria-label="Toggle sidebar" onClick={toggleSidebar}>
            <svg
              className="sidebar-trigger-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>

          {/* Breadcrumb */}
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <ol className="breadcrumb-list">
              <li className="breadcrumb-item">
                <button onClick={handleNavigateHome} className="breadcrumb-link" id="breadcrumb-home">
                  AD Tools
                </button>
              </li>
              {currentPage !== "Home" && (
                <>
                  <li className="breadcrumb-separator" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9,18 15,12 9,6" />
                    </svg>
                  </li>
                  <li className="breadcrumb-item breadcrumb-current" aria-current="page">
                    <span id="breadcrumb-current">{currentPage}</span>
                  </li>
                </>
              )}
            </ol>
          </nav>

          {/* Header actions */}
          <div className="header-actions">
            <button
              className="header-reload"
              type="button"
              aria-label="Reload window"
              title={runtime === "tauri" ? "Reload window" : "Reload"}
              onClick={handleReload}
            >
              <svg className="header-reload-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                <g id="SVGRepo_iconCarrier">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M13.7071 1.29289C14.0976 1.68342 14.0976 2.31658 13.7071 2.70711L12.4053 4.00896C17.1877 4.22089 21 8.16524 21 13C21 17.9706 16.9706 22 12 22C7.02944 22 3 17.9706 3 13C3 12.4477 3.44772 12 4 12C4.55228 12 5 12.4477 5 13C5 16.866 8.13401 20 12 20C15.866 20 19 16.866 19 13C19 9.2774 16.0942 6.23349 12.427 6.01281L13.7071 7.29289C14.0976 7.68342 14.0976 8.31658 13.7071 8.70711C13.3166 9.09763 12.6834 9.09763 12.2929 8.70711L9.29289 5.70711C9.10536 5.51957 9 5.26522 9 5C9 4.73478 9.10536 4.48043 9.29289 4.29289L12.2929 1.29289C12.6834 0.902369 13.3166 0.902369 13.7071 1.29289Z"
                    fill="#0F1729"
                  ></path>
                </g>
              </svg>
            </button>
          </div>
        </header>

        <div className="main-content">{children}</div>
      </main>

      {/* Sidebar overlay for mobile */}
      <div
        className="sidebar-overlay"
        data-state={isMobile && sidebarExpanded ? "open" : "closed"}
        onClick={closeSidebar}
      ></div>

      {/* Notification System */}
      <NotificationContainer />
    </div>
  );
}
