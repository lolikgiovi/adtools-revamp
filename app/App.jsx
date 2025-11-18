import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { EventBusProvider } from "./contexts/EventBusContext.jsx";
import { AppProvider } from "./contexts/AppContext.jsx";
import Layout from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import { RegisterPage } from "./pages/register/main.js";

// React Tool imports
import UUIDGenerator from "./tools/uuid-generator/UUIDGenerator.jsx";
import SQLInClause from "./tools/sql-in-clause/SQLInClause.jsx";
import JSONTools from "./tools/json-tools/JSONTools.jsx";
import HTMLEditor from "./tools/html-editor/HTMLEditor.jsx";
import SplunkTemplate from "./tools/splunk-template/SplunkTemplate.jsx";

// Legacy Tool imports (to be migrated)
import { QRTools } from "./tools/qr-tools/main.js";
import { Base64Tools } from "./tools/base64-tools/main.js";
import { QuickQuery } from "./tools/quick-query/main.js";
import { HTMLTemplateTool } from "./tools/html-editor/main.js";
import { SplunkVTLEditor } from "./tools/splunk-template/main.js";
import { SQLInClauseTool } from "./tools/sql-in-clause/main.js";
import { CheckImageTool } from "./tools/image-checker/main.js";
import { JenkinsRunner } from "./tools/jenkins-runner/main.js";
import { SettingsPage } from "./pages/settings/main.js";
import { AboutPage } from "./pages/about/main.js";

// Import core modules
import { UsageTracker } from "./core/UsageTracker.js";
import { ThemeManager } from "./core/ThemeManager.js";

function AppContent() {
  const [isRegistered, setIsRegistered] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Check registration status
    const registered = localStorage.getItem("user.registered") === "true";
    setIsRegistered(registered);

    // Redirect to register if not registered and not already there
    if (!registered && location.pathname !== "/register") {
      navigate("/register", { replace: true });
    }
  }, [navigate, location]);

  // Protected route wrapper
  const ProtectedRoute = ({ children }) => {
    if (!isRegistered && location.pathname !== "/register") {
      return <Navigate to="/register" replace />;
    }
    return children;
  };

  return (
    <Routes>
      <Route path="/register" element={<RegisterPageWrapper />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/uuid-generator" element={<UUIDGenerator />} />
                <Route path="/json-tools" element={<JSONTools />} />
                <Route path="/base64-tools" element={<ToolPageWrapper toolId="base64-tools" />} />
                <Route path="/qr-tools" element={<ToolPageWrapper toolId="qr-tools" />} />
                <Route path="/quick-query" element={<ToolPageWrapper toolId="quick-query" />} />
                <Route path="/html-editor" element={<HTMLEditor />} />
                <Route path="/html-template" element={<HTMLEditor />} />
                <Route path="/splunk-template" element={<SplunkTemplate />} />
                <Route path="/sql-in-clause" element={<SQLInClause />} />
                <Route path="/check-image" element={<ToolPageWrapper toolId="check-image" />} />
                <Route path="/jenkins-runner" element={<ToolPageWrapper toolId="jenkins-runner" />} />
                <Route path="/settings" element={<SettingsPageWrapper />} />
                <Route path="/about" element={<AboutPageWrapper />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

// Wrapper components for legacy tools (will be migrated later)
function ToolPageWrapper({ toolId }) {
  return <div className="tool-page" data-tool-id={toolId}>Tool: {toolId}</div>;
}

function RegisterPageWrapper() {
  return <div className="register-page">Register Page Placeholder</div>;
}

function SettingsPageWrapper() {
  return <div className="settings-page">Settings Page Placeholder</div>;
}

function AboutPageWrapper() {
  return <div className="about-page">About Page Placeholder</div>;
}

function App() {
  return (
    <EventBusProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </EventBusProvider>
  );
}

export default App;
