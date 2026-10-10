import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { normalizeLegacyHash } from "./routes";
import { initializeDevelopmentRegistration } from "@/platform/registration";
import { initializeTheme } from "@/platform/theme";
import "../index.css";

normalizeLegacyHash();
initializeTheme();
window.addEventListener("hashchange", () => {
  if (window.location.hash && !window.location.hash.startsWith("#/")) {
    window.location.replace(`#/${window.location.hash.slice(1)}`);
  }
});
initializeDevelopmentRegistration();

const root = document.getElementById("root");
if (!root) throw new Error("React root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
