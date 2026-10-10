import React from "react";
import { createRoot } from "react-dom/client";
import { MigrationPreview } from "./MigrationPreview.jsx";
import "./preview.css";

createRoot(document.getElementById("react-preview-root")).render(<MigrationPreview />);
