# Technical Specification Document

## Database Configuration Comparison Feature

**Version:** 1.0  
**Date:** November 6, 2025  
**Author:** [Your Name]  
**Project:** Tauri Database Management Application

---

## 1. Overview

### 1.1 Purpose

This document specifies the technical requirements and design for implementing a configuration comparison feature in the Tauri application. The feature enables users to compare configuration tables stored in Oracle databases across different environments (different hosts).

### 1.2 Scope

- Compare configuration tables between two Oracle database instances
- Support comparison across different hosts (e.g., UAT1 vs UAT2)
- Display all 8 fields in the configuration table
- Provide multiple visualization options for the comparison results
- Export comparison results in multiple formats

### 1.3 Goals

- Enable quick identification of configuration discrepancies between environments
- Provide clear, actionable insights for configuration management
- Support operational and deployment workflows
- Maintain security and performance standards

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Vue)                     │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ Connection UI  │  │ Comparison UI  │  │  Export UI   │ │
│  └────────┬───────┘  └────────┬───────┘  └──────┬───────┘ │
│           │                   │                  │          │
└───────────┼───────────────────┼──────────────────┼──────────┘
            │                   │                  │
            │    Tauri IPC      │                  │
            ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Rust Backend (Tauri)                     │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ DB Connection  │  │   Comparator   │  │   Exporter   │ │
│  │    Manager     │  │     Engine     │  │    Module    │ │
│  └────────┬───────┘  └────────┬───────┘  └──────┬───────┘ │
└───────────┼───────────────────┼──────────────────┼──────────┘
            │                   │                  │
            ▼                   ▼                  ▼
    ┌──────────────┐    ┌──────────────┐   ┌──────────────┐
    │   Oracle     │    │   Oracle     │   │  File System │
    │  Database 1  │    │  Database 2  │   │   (Export)   │
    │    (UAT1)    │    │    (UAT2)    │   └──────────────┘
    └──────────────┘    └──────────────┘
```

### 2.2 Technology Stack

**Frontend:**

- Framework: Vanilla JavaScript (ES6+)
- UI Components: Custom CSS / Tailwind CSS
- State Management: Native JavaScript (no framework)
- DOM Manipulation: Native DOM APIs
- Data Visualization: Chart.js / D3.js (optional)

**Backend (Rust):**

- Oracle Client: `oracle` crate or `sibyl` crate
- Serialization: `serde`, `serde_json`
- Async Runtime: `tokio`
- Error Handling: `anyhow` or `thiserror`

**Tauri:**

- Version: 2.x
- IPC: Command-based invocation

---

## 3. Data Model

### 3.1 Configuration Table Schema

```sql
CREATE TABLE app_config (
    config_key      VARCHAR2(100)   PRIMARY KEY,
    value           VARCHAR2(4000)  NOT NULL,
    description     VARCHAR2(500),
    data_type       VARCHAR2(50),    -- e.g., STRING, NUMBER, BOOLEAN
    category        VARCHAR2(100),   -- e.g., DATABASE, API, FEATURES
    is_active       CHAR(1),         -- Y/N
    created_by      VARCHAR2(100),
    created_date    DATE,
    modified_by     VARCHAR2(100),
    modified_date   DATE
);
```

### 3.2 Rust Data Structures

```rust
use serde::{Deserialize, Serialize};
use chrono::NaiveDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigRecord {
    pub config_key: String,
    pub value: String,
    pub description: Option<String>,
    pub data_type: Option<String>,
    pub category: Option<String>,
    pub is_active: Option<String>,
    pub created_by: Option<String>,
    pub created_date: Option<NaiveDateTime>,
    pub modified_by: Option<String>,
    pub modified_date: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComparisonRequest {
    pub env1_name: String,
    pub env1_connection: ConnectionConfig,
    pub env2_name: String,
    pub env2_connection: ConnectionConfig,
    pub config_keys: Option<Vec<String>>, // Optional filter
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FieldDifference {
    pub field_name: String,
    pub env1_value: Option<String>,
    pub env2_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigComparison {
    pub config_key: String,
    pub status: ComparisonStatus,
    pub env1_data: Option<ConfigRecord>,
    pub env2_data: Option<ConfigRecord>,
    pub differences: Vec<FieldDifference>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum ComparisonStatus {
    Match,
    Differ,
    OnlyInEnv1,
    OnlyInEnv2,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub env1_name: String,
    pub env2_name: String,
    pub timestamp: String,
    pub summary: ComparisonSummary,
    pub comparisons: Vec<ConfigComparison>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComparisonSummary {
    pub total_configs: usize,
    pub matching: usize,
    pub differing: usize,
    pub only_in_env1: usize,
    pub only_in_env2: usize,
}
```

---

## 4. Backend Implementation

### 4.1 Database Connection Module

**File:** `src-tauri/src/db/connection.rs`

```rust
use oracle::{Connection, Error as OracleError};
use crate::models::ConnectionConfig;

pub struct DatabaseConnection {
    conn: Connection,
}

impl DatabaseConnection {
    pub fn new(config: &ConnectionConfig) -> Result<Self, OracleError> {
        let connect_string = format!(
            "{}:{}/{}",
            config.host,
            config.port,
            config.service_name
        );

        let conn = Connection::connect(
            &config.username,
            &config.password,
            &connect_string,
        )?;

        Ok(DatabaseConnection { conn })
    }

    pub fn fetch_configs(
        &self,
        config_keys: Option<&[String]>,
    ) -> Result<Vec<ConfigRecord>, OracleError> {
        let sql = if let Some(keys) = config_keys {
            let placeholders = keys.iter()
                .enumerate()
                .map(|(i, _)| format!(":key{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");

            format!(
                "SELECT config_key, value, description, data_type,
                        category, is_active, created_by, created_date,
                        modified_by, modified_date
                 FROM app_config
                 WHERE config_key IN ({})",
                placeholders
            )
        } else {
            "SELECT config_key, value, description, data_type,
                    category, is_active, created_by, created_date,
                    modified_by, modified_date
             FROM app_config".to_string()
        };

        let mut stmt = self.conn.prepare(&sql, &[])?;

        if let Some(keys) = config_keys {
            for (i, key) in keys.iter().enumerate() {
                stmt.bind(i + 1, key)?;
            }
        }

        let rows = stmt.query(&[])?;
        let mut configs = Vec::new();

        for row_result in rows {
            let row = row_result?;
            configs.push(ConfigRecord {
                config_key: row.get(0)?,
                value: row.get(1)?,
                description: row.get(2)?,
                data_type: row.get(3)?,
                category: row.get(4)?,
                is_active: row.get(5)?,
                created_by: row.get(6)?,
                created_date: row.get(7)?,
                modified_by: row.get(8)?,
                modified_date: row.get(9)?,
            });
        }

        Ok(configs)
    }

    pub fn test_connection(&self) -> Result<(), OracleError> {
        self.conn.query("SELECT 1 FROM dual", &[])?;
        Ok(())
    }
}
```

### 4.2 Comparison Engine

**File:** `src-tauri/src/comparison/engine.rs`

```rust
use std::collections::HashMap;
use crate::models::*;

pub struct ComparisonEngine;

impl ComparisonEngine {
    pub fn compare(
        env1_name: String,
        env1_configs: Vec<ConfigRecord>,
        env2_name: String,
        env2_configs: Vec<ConfigRecord>,
    ) -> ComparisonResult {
        // Build HashMaps for efficient lookup
        let env1_map: HashMap<String, ConfigRecord> = env1_configs
            .into_iter()
            .map(|c| (c.config_key.clone(), c))
            .collect();

        let env2_map: HashMap<String, ConfigRecord> = env2_configs
            .into_iter()
            .map(|c| (c.config_key.clone(), c))
            .collect();

        // Get all unique keys
        let all_keys: std::collections::HashSet<_> = env1_map
            .keys()
            .chain(env2_map.keys())
            .cloned()
            .collect();

        let mut comparisons = Vec::new();
        let mut summary = ComparisonSummary {
            total_configs: all_keys.len(),
            matching: 0,
            differing: 0,
            only_in_env1: 0,
            only_in_env2: 0,
        };

        for key in all_keys {
            let env1_record = env1_map.get(&key);
            let env2_record = env2_map.get(&key);

            let (status, differences) = match (env1_record, env2_record) {
                (Some(r1), Some(r2)) => {
                    let diffs = Self::find_differences(r1, r2);
                    if diffs.is_empty() {
                        summary.matching += 1;
                        (ComparisonStatus::Match, diffs)
                    } else {
                        summary.differing += 1;
                        (ComparisonStatus::Differ, diffs)
                    }
                }
                (Some(_), None) => {
                    summary.only_in_env1 += 1;
                    (ComparisonStatus::OnlyInEnv1, vec![])
                }
                (None, Some(_)) => {
                    summary.only_in_env2 += 1;
                    (ComparisonStatus::OnlyInEnv2, vec![])
                }
                (None, None) => unreachable!(),
            };

            comparisons.push(ConfigComparison {
                config_key: key,
                status,
                env1_data: env1_record.cloned(),
                env2_data: env2_record.cloned(),
                differences,
            });
        }

        // Sort by status (differences first) then by key
        comparisons.sort_by(|a, b| {
            match (&a.status, &b.status) {
                (ComparisonStatus::Match, ComparisonStatus::Match) => {
                    a.config_key.cmp(&b.config_key)
                }
                (ComparisonStatus::Match, _) => std::cmp::Ordering::Greater,
                (_, ComparisonStatus::Match) => std::cmp::Ordering::Less,
                _ => a.config_key.cmp(&b.config_key),
            }
        });

        ComparisonResult {
            env1_name,
            env2_name,
            timestamp: chrono::Local::now().to_rfc3339(),
            summary,
            comparisons,
        }
    }

    fn find_differences(
        r1: &ConfigRecord,
        r2: &ConfigRecord,
    ) -> Vec<FieldDifference> {
        let mut differences = Vec::new();

        // Compare value
        if r1.value != r2.value {
            differences.push(FieldDifference {
                field_name: "value".to_string(),
                env1_value: Some(r1.value.clone()),
                env2_value: Some(r2.value.clone()),
            });
        }

        // Compare description
        if r1.description != r2.description {
            differences.push(FieldDifference {
                field_name: "description".to_string(),
                env1_value: r1.description.clone(),
                env2_value: r2.description.clone(),
            });
        }

        // Compare data_type
        if r1.data_type != r2.data_type {
            differences.push(FieldDifference {
                field_name: "data_type".to_string(),
                env1_value: r1.data_type.clone(),
                env2_value: r2.data_type.clone(),
            });
        }

        // Compare category
        if r1.category != r2.category {
            differences.push(FieldDifference {
                field_name: "category".to_string(),
                env1_value: r1.category.clone(),
                env2_value: r2.category.clone(),
            });
        }

        // Compare is_active
        if r1.is_active != r2.is_active {
            differences.push(FieldDifference {
                field_name: "is_active".to_string(),
                env1_value: r1.is_active.clone(),
                env2_value: r2.is_active.clone(),
            });
        }

        // Compare modified_by
        if r1.modified_by != r2.modified_by {
            differences.push(FieldDifference {
                field_name: "modified_by".to_string(),
                env1_value: r1.modified_by.clone(),
                env2_value: r2.modified_by.clone(),
            });
        }

        // Compare modified_date
        if r1.modified_date != r2.modified_date {
            differences.push(FieldDifference {
                field_name: "modified_date".to_string(),
                env1_value: r1.modified_date.map(|d| d.to_string()),
                env2_value: r2.modified_date.map(|d| d.to_string()),
            });
        }

        differences
    }
}
```

### 4.3 Tauri Commands

**File:** `src-tauri/src/commands.rs`

```rust
use tauri::State;
use crate::db::connection::DatabaseConnection;
use crate::comparison::engine::ComparisonEngine;
use crate::models::*;

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
) -> Result<String, String> {
    let conn = DatabaseConnection::new(&config)
        .map_err(|e| format!("Connection failed: {}", e))?;

    conn.test_connection()
        .map_err(|e| format!("Connection test failed: {}", e))?;

    Ok("Connection successful".to_string())
}

#[tauri::command]
pub async fn compare_configs(
    request: ComparisonRequest,
) -> Result<ComparisonResult, String> {
    // Connect to first environment
    let conn1 = DatabaseConnection::new(&request.env1_connection)
        .map_err(|e| format!("Failed to connect to {}: {}", request.env1_name, e))?;

    // Connect to second environment
    let conn2 = DatabaseConnection::new(&request.env2_connection)
        .map_err(|e| format!("Failed to connect to {}: {}", request.env2_name, e))?;

    // Fetch configs from both environments
    let env1_configs = conn1
        .fetch_configs(request.config_keys.as_deref())
        .map_err(|e| format!("Failed to fetch configs from {}: {}", request.env1_name, e))?;

    let env2_configs = conn2
        .fetch_configs(request.config_keys.as_deref())
        .map_err(|e| format!("Failed to fetch configs from {}: {}", request.env2_name, e))?;

    // Perform comparison
    let result = ComparisonEngine::compare(
        request.env1_name,
        env1_configs,
        request.env2_name,
        env2_configs,
    );

    Ok(result)
}

#[tauri::command]
pub async fn export_comparison(
    result: ComparisonResult,
    format: String, // "json", "csv", "html"
    output_path: String,
) -> Result<String, String> {
    match format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&result)
                .map_err(|e| format!("JSON serialization failed: {}", e))?;
            std::fs::write(&output_path, json)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
        "csv" => {
            // Implement CSV export
            todo!("CSV export not yet implemented")
        }
        "html" => {
            // Implement HTML export
            todo!("HTML export not yet implemented")
        }
        _ => return Err(format!("Unsupported format: {}", format)),
    }

    Ok(output_path)
}
```

---

## 5. Frontend Implementation

### 5.1 File Structure

```
src/
├── js/
│   ├── main.js                        (Entry point, app initialization)
│   ├── components/
│   │   ├── connectionForm.js          (Connection form logic)
│   │   ├── comparisonView.js          (Main comparison view orchestrator)
│   │   ├── verticalCardView.js        (Option 1 renderer)
│   │   ├── masterDetailView.js        (Option 2 renderer)
│   │   ├── expandableRowView.js       (Option 5 renderer)
│   │   ├── summaryStats.js            (Summary statistics component)
│   │   └── exportButton.js            (Export functionality)
│   ├── utils/
│   │   ├── domHelpers.js              (DOM manipulation utilities)
│   │   ├── formatting.js              (Data formatting utilities)
│   │   └── tauri.js                   (Tauri API wrappers)
│   └── state/
│       └── appState.js                (Application state management)
├── css/
│   ├── main.css
│   ├── components.css
│   └── comparison.css
└── index.html
```

### 5.2 Vanilla JS Example - Connection Form

**HTML Structure (index.html):**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Config Comparison Tool</title>
    <link rel="stylesheet" href="css/main.css" />
  </head>
  <body>
    <div id="app">
      <header>
        <h1>Database Configuration Comparison</h1>
      </header>

      <main>
        <section id="connection-form">
          <h2>Database Connection Setup</h2>

          <!-- Environment 1 -->
          <div class="environment-config">
            <h3>Environment 1 (Reference)</h3>
            <div class="form-grid">
              <input type="text" id="env1-name" placeholder="Environment Name" value="UAT1" />
              <input type="text" id="env1-host" placeholder="Host" />
              <input type="number" id="env1-port" placeholder="Port" value="1521" />
              <input type="text" id="env1-service" placeholder="Service Name" />
              <input type="text" id="env1-username" placeholder="Username" />
              <input type="password" id="env1-password" placeholder="Password" />
            </div>
            <button id="test-env1" class="btn-secondary">Test Connection</button>
          </div>

          <!-- Environment 2 -->
          <div class="environment-config">
            <h3>Environment 2 (Comparison)</h3>
            <div class="form-grid">
              <input type="text" id="env2-name" placeholder="Environment Name" value="UAT2" />
              <input type="text" id="env2-host" placeholder="Host" />
              <input type="number" id="env2-port" placeholder="Port" value="1521" />
              <input type="text" id="env2-service" placeholder="Service Name" />
              <input type="text" id="env2-username" placeholder="Username" />
              <input type="password" id="env2-password" placeholder="Password" />
            </div>
            <button id="test-env2" class="btn-secondary">Test Connection</button>
          </div>

          <!-- Compare Button -->
          <div class="actions">
            <button id="compare-btn" class="btn-primary">Compare Configurations</button>
          </div>

          <div id="error-message" class="error-box hidden"></div>
        </section>

        <section id="comparison-results" class="hidden">
          <!-- Results will be rendered here -->
        </section>
      </main>
    </div>

    <script type="module" src="js/main.js"></script>
  </body>
</html>
```

**JavaScript Implementation (js/components/connectionForm.js):**

```javascript
// js/components/connectionForm.js
import { invoke } from "@tauri-apps/api/tauri";
import { showError, clearError } from "../utils/domHelpers.js";

export class ConnectionForm {
  constructor() {
    this.env1Config = this.getDefaultConfig();
    this.env2Config = this.getDefaultConfig();
    this.isLoading = false;

    this.initializeEventListeners();
  }

  getDefaultConfig() {
    return {
      host: "",
      port: 1521,
      service_name: "",
      username: "",
      password: "",
    };
  }

  initializeEventListeners() {
    // Test connection buttons
    document.getElementById("test-env1").addEventListener("click", () => {
      this.testConnection("env1");
    });

    document.getElementById("test-env2").addEventListener("click", () => {
      this.testConnection("env2");
    });

    // Compare button
    document.getElementById("compare-btn").addEventListener("click", () => {
      this.handleCompare();
    });

    // Input change listeners for live config updates
    this.attachInputListeners("env1");
    this.attachInputListeners("env2");
  }

  attachInputListeners(envPrefix) {
    const fields = ["host", "port", "service", "username", "password"];
    const config = envPrefix === "env1" ? this.env1Config : this.env2Config;

    fields.forEach((field) => {
      const element = document.getElementById(`${envPrefix}-${field}`);
      element.addEventListener("input", (e) => {
        const key = field === "service" ? "service_name" : field;
        const value = field === "port" ? parseInt(e.target.value) : e.target.value;
        config[key] = value;
      });
    });
  }

  getEnvName(envPrefix) {
    return document.getElementById(`${envPrefix}-name`).value;
  }

  async testConnection(envPrefix) {
    const config = envPrefix === "env1" ? this.env1Config : this.env2Config;
    const envName = this.getEnvName(envPrefix);
    const button = document.getElementById(`test-${envPrefix}`);

    try {
      button.disabled = true;
      button.textContent = "Testing...";
      clearError();

      const result = await invoke("test_connection", { config });

      alert(`✓ ${envName} connection successful!`);
    } catch (error) {
      showError(`✗ ${envName} connection failed: ${error}`);
    } finally {
      button.disabled = false;
      button.textContent = "Test Connection";
    }
  }

  async handleCompare() {
    if (this.isLoading) return;

    const compareBtn = document.getElementById("compare-btn");

    try {
      this.isLoading = true;
      compareBtn.disabled = true;
      compareBtn.textContent = "Comparing...";
      clearError();

      const env1Name = this.getEnvName("env1");
      const env2Name = this.getEnvName("env2");

      const request = {
        env1_name: env1Name,
        env1_connection: this.env1Config,
        env2_name: env2Name,
        env2_connection: this.env2Config,
        config_keys: null, // null = fetch all configs
      };

      const result = await invoke("compare_configs", { request });

      // Emit custom event with results
      const event = new CustomEvent("comparisonComplete", {
        detail: result,
      });
      document.dispatchEvent(event);
    } catch (error) {
      showError(`Comparison failed: ${error}`);
    } finally {
      this.isLoading = false;
      compareBtn.disabled = false;
      compareBtn.textContent = "Compare Configurations";
    }
  }
}
```

**Utilities (js/utils/domHelpers.js):**

```javascript
// js/utils/domHelpers.js

export function createElement(tag, className = "", content = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

export function showError(message) {
  const errorBox = document.getElementById("error-message");
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

export function clearError() {
  const errorBox = document.getElementById("error-message");
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

export function show(elementId) {
  document.getElementById(elementId).classList.remove("hidden");
}

export function hide(elementId) {
  document.getElementById(elementId).classList.add("hidden");
}

export function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
```

**Main Entry Point (js/main.js):**

```javascript
// js/main.js
import { ConnectionForm } from "./components/connectionForm.js";
import { ComparisonView } from "./components/comparisonView.js";

class App {
  constructor() {
    this.connectionForm = null;
    this.comparisonView = null;

    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    // Initialize connection form
    this.connectionForm = new ConnectionForm();

    // Initialize comparison view
    this.comparisonView = new ComparisonView();

    // Listen for comparison results
    document.addEventListener("comparisonComplete", (event) => {
      this.handleComparisonResults(event.detail);
    });
  }

  handleComparisonResults(result) {
    // Hide connection form, show results
    document.getElementById("connection-form").classList.add("hidden");
    document.getElementById("comparison-results").classList.remove("hidden");

    // Render comparison results
    this.comparisonView.render(result);
  }
}

// Initialize app
new App();
```

### 5.3 Expandable Row View (Option 5) - Vanilla JS

**JavaScript Implementation (js/components/expandableRowView.js):**

```javascript
// js/components/expandableRowView.js
import { createElement, clearChildren } from "../utils/domHelpers.js";

export class ExpandableRowView {
  constructor(container) {
    this.container = container;
    this.expandedRows = new Set();
  }

  render(comparisons, env1Name, env2Name) {
    clearChildren(this.container);

    const table = this.createTable(comparisons, env1Name, env2Name);
    this.container.appendChild(table);
  }

  createTable(comparisons, env1Name, env2Name) {
    const wrapper = createElement("div", "table-wrapper");
    const table = createElement("table", "comparison-table");

    // Create header
    const thead = createElement("thead");
    const headerRow = createElement("tr");

    const headers = ["", "Config Key", `${env1Name} Value`, `${env2Name} Value`, "Category", "Status"];
    headers.forEach((text) => {
      const th = createElement("th", "", text);
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body
    const tbody = createElement("tbody");

    comparisons.forEach((comparison) => {
      // Main row
      const mainRow = this.createMainRow(comparison, env1Name, env2Name);
      tbody.appendChild(mainRow);

      // Detail row (initially hidden)
      const detailRow = this.createDetailRow(comparison, env1Name, env2Name);
      tbody.appendChild(detailRow);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);

    return wrapper;
  }

  createMainRow(comparison, env1Name, env2Name) {
    const row = createElement("tr", "main-row");
    row.dataset.configKey = comparison.config_key;

    // Expand/collapse icon
    const iconCell = createElement("td", "icon-cell");
    const icon = createElement("span", "expand-icon", "▶");
    iconCell.appendChild(icon);
    row.appendChild(iconCell);

    // Config key
    const keyCell = createElement("td", "config-key", comparison.config_key);
    row.appendChild(keyCell);

    // Values
    const env1Value = comparison.env1_data?.value || "-";
    const env2Value = comparison.env2_data?.value || "-";

    const env1Cell = createElement("td", "", env1Value);
    const env2Cell = createElement("td", "", env2Value);
    row.appendChild(env1Cell);
    row.appendChild(env2Cell);

    // Category
    const category = comparison.env1_data?.category || comparison.env2_data?.category || "-";
    const categoryCell = createElement("td", "", category);
    row.appendChild(categoryCell);

    // Status
    const statusCell = createElement("td");
    const statusBadge = this.createStatusBadge(comparison.status);
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    // Add click handler for expand/collapse
    row.addEventListener("click", () => {
      this.toggleRow(comparison.config_key, icon);
    });

    return row;
  }

  createDetailRow(comparison, env1Name, env2Name) {
    const row = createElement("tr", "detail-row hidden");
    row.dataset.configKey = comparison.config_key;

    const cell = createElement("td");
    cell.colSpan = 6;

    const detailContainer = createElement("div", "detail-container");

    // Create two-column layout
    const grid = createElement("div", "detail-grid");

    // Environment 1 details
    const env1Details = this.createEnvDetails(env1Name, comparison.env1_data);
    grid.appendChild(env1Details);

    // Environment 2 details
    const env2Details = this.createEnvDetails(env2Name, comparison.env2_data);
    grid.appendChild(env2Details);

    detailContainer.appendChild(grid);

    // Add differences section if applicable
    if (comparison.differences && comparison.differences.length > 0) {
      const diffSection = this.createDifferencesSection(comparison.differences);
      detailContainer.appendChild(diffSection);
    }

    cell.appendChild(detailContainer);
    row.appendChild(cell);

    return row;
  }

  createEnvDetails(envName, data) {
    const container = createElement("div", "env-details");

    const title = createElement("h4", "env-title", envName);
    container.appendChild(title);

    if (!data) {
      const noData = createElement("p", "no-data", "No data available");
      container.appendChild(noData);
      return container;
    }

    const dl = createElement("dl", "detail-list");

    const fields = [
      { label: "Description", value: data.description },
      { label: "Data Type", value: data.data_type },
      { label: "Is Active", value: data.is_active },
      { label: "Modified By", value: data.modified_by },
      { label: "Modified Date", value: data.modified_date },
    ];

    fields.forEach((field) => {
      const dt = createElement("dt", "detail-label", field.label + ":");
      const dd = createElement("dd", "detail-value", field.value || "-");
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    container.appendChild(dl);

    return container;
  }

  createDifferencesSection(differences) {
    const section = createElement("div", "differences-section");

    const title = createElement("h5", "diff-title", "Differences:");
    section.appendChild(title);

    const ul = createElement("ul", "diff-list");

    differences.forEach((diff) => {
      const li = createElement("li");

      const fieldName = createElement("strong", "", diff.field_name);
      const separator = document.createTextNode(": ");
      const env1Val = createElement("span", "env1-value", diff.env1_value || "NULL");
      const arrow = document.createTextNode(" → ");
      const env2Val = createElement("span", "env2-value", diff.env2_value || "NULL");

      li.appendChild(fieldName);
      li.appendChild(separator);
      li.appendChild(env1Val);
      li.appendChild(arrow);
      li.appendChild(env2Val);

      ul.appendChild(li);
    });

    section.appendChild(ul);

    return section;
  }

  createStatusBadge(status) {
    const badge = createElement("span", "status-badge");

    switch (status) {
      case "Match":
        badge.classList.add("status-match");
        badge.textContent = "Match";
        break;
      case "Differ":
        badge.classList.add("status-differ");
        badge.textContent = "Differ";
        break;
      case "OnlyInEnv1":
        badge.classList.add("status-only-env1");
        badge.textContent = "Only in Env1";
        break;
      case "OnlyInEnv2":
        badge.classList.add("status-only-env2");
        badge.textContent = "Only in Env2";
        break;
    }

    return badge;
  }

  toggleRow(configKey, icon) {
    const detailRow = document.querySelector(`.detail-row[data-config-key="${configKey}"]`);

    if (this.expandedRows.has(configKey)) {
      // Collapse
      this.expandedRows.delete(configKey);
      detailRow.classList.add("hidden");
      icon.textContent = "▶";
      icon.style.transform = "rotate(0deg)";
    } else {
      // Expand
      this.expandedRows.add(configKey);
      detailRow.classList.remove("hidden");
      icon.textContent = "▼";
      icon.style.transform = "rotate(90deg)";
    }
  }
}
```

**Comparison View Orchestrator (js/components/comparisonView.js):**

```javascript
// js/components/comparisonView.js
import { ExpandableRowView } from "./expandableRowView.js";
import { VerticalCardView } from "./verticalCardView.js";
import { MasterDetailView } from "./masterDetailView.js";
import { SummaryStats } from "./summaryStats.js";
import { createElement, clearChildren } from "../utils/domHelpers.js";

export class ComparisonView {
  constructor() {
    this.container = document.getElementById("comparison-results");
    this.currentView = "expandable"; // default view
    this.currentResult = null;
  }

  render(result) {
    this.currentResult = result;
    clearChildren(this.container);

    // Create header with controls
    const header = this.createHeader(result);
    this.container.appendChild(header);

    // Create summary stats
    const summaryStats = new SummaryStats();
    const summaryElement = summaryStats.render(result.summary, result.env1_name, result.env2_name);
    this.container.appendChild(summaryElement);

    // Create view selector
    const viewSelector = this.createViewSelector();
    this.container.appendChild(viewSelector);

    // Create results container
    const resultsContainer = createElement("div", "results-container");
    resultsContainer.id = "results-container";
    this.container.appendChild(resultsContainer);

    // Render the selected view
    this.renderCurrentView(resultsContainer, result);
  }

  createHeader(result) {
    const header = createElement("div", "comparison-header");

    const title = createElement("h2", "", `Comparison: ${result.env1_name} vs ${result.env2_name}`);

    const timestamp = createElement("p", "timestamp", `Generated: ${new Date(result.timestamp).toLocaleString()}`);

    const backButton = createElement("button", "btn-secondary", "New Comparison");
    backButton.addEventListener("click", () => {
      document.getElementById("comparison-results").classList.add("hidden");
      document.getElementById("connection-form").classList.remove("hidden");
    });

    header.appendChild(title);
    header.appendChild(timestamp);
    header.appendChild(backButton);

    return header;
  }

  createViewSelector() {
    const container = createElement("div", "view-selector");

    const label = createElement("label", "", "View Mode: ");
    container.appendChild(label);

    const select = createElement("select", "view-select");
    select.id = "view-select";

    const options = [
      { value: "expandable", text: "Expandable Rows" },
      { value: "cards", text: "Vertical Cards" },
      { value: "master-detail", text: "Master-Detail" },
    ];

    options.forEach((opt) => {
      const option = createElement("option", "", opt.text);
      option.value = opt.value;
      if (opt.value === this.currentView) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", (e) => {
      this.currentView = e.target.value;
      const resultsContainer = document.getElementById("results-container");
      this.renderCurrentView(resultsContainer, this.currentResult);
    });

    container.appendChild(select);

    return container;
  }

  renderCurrentView(container, result) {
    clearChildren(container);

    let view;

    switch (this.currentView) {
      case "expandable":
        view = new ExpandableRowView(container);
        break;
      case "cards":
        view = new VerticalCardView(container);
        break;
      case "master-detail":
        view = new MasterDetailView(container);
        break;
    }

    view.render(result.comparisons, result.env1_name, result.env2_name);
  }
}
```

**Summary Stats Component (js/components/summaryStats.js):**

```javascript
// js/components/summaryStats.js
import { createElement } from "../utils/domHelpers.js";

export class SummaryStats {
  render(summary, env1Name, env2Name) {
    const container = createElement("div", "summary-stats");

    const title = createElement("h3", "summary-title", "Comparison Summary");
    container.appendChild(title);

    const grid = createElement("div", "stats-grid");

    const stats = [
      { label: "Total Configs", value: summary.total_configs, className: "stat-total" },
      { label: "Matching", value: summary.matching, className: "stat-match" },
      { label: "Differing", value: summary.differing, className: "stat-differ" },
      { label: `Only in ${env1Name}`, value: summary.only_in_env1, className: "stat-env1" },
      { label: `Only in ${env2Name}`, value: summary.only_in_env2, className: "stat-env2" },
    ];

    stats.forEach((stat) => {
      const statCard = createElement("div", `stat-card ${stat.className}`);

      const value = createElement("div", "stat-value", String(stat.value));
      const label = createElement("div", "stat-label", stat.label);

      statCard.appendChild(value);
      statCard.appendChild(label);

      grid.appendChild(statCard);
    });

    container.appendChild(grid);

    // Add sync status indicator
    const syncPercentage = summary.total_configs > 0 ? Math.round((summary.matching / summary.total_configs) * 100) : 0;

    const syncStatus = createElement("div", "sync-status");
    const statusText =
      syncPercentage === 100 ? "✓ Environments are fully synchronized" : `⚠️ Environments are ${syncPercentage}% synchronized`;

    syncStatus.textContent = statusText;
    syncStatus.classList.add(syncPercentage === 100 ? "status-synced" : "status-out-of-sync");

    container.appendChild(syncStatus);

    return container;
  }
}
```

---

## 6. CSS Styling

### 6.1 Main Styles (css/main.css)

```css
/* css/main.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f5f5;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2rem;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

header h1 {
  font-size: 2rem;
  font-weight: 600;
}

main {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 2rem auto;
  padding: 0 2rem;
}

/* Form Styles */
.environment-config {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.environment-config h3 {
  margin-bottom: 1rem;
  color: #667eea;
  font-size: 1.2rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

input {
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  transition: border-color 0.2s;
}

input:focus {
  outline: none;
  border-color: #667eea;
}

/* Button Styles */
button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #667eea;
  color: white;
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover {
  background: #e0e0e0;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  text-align: center;
  margin: 2rem 0;
}

/* Error Box */
.error-box {
  background: #fee;
  border: 1px solid #fcc;
  color: #c33;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
}

/* Utility */
.hidden {
  display: none !important;
}
```

### 6.2 Comparison Styles (css/comparison.css)

```css
/* css/comparison.css */

/* Header */
.comparison-header {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  margin-bottom: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.comparison-header h2 {
  color: #667eea;
  margin-bottom: 0.5rem;
}

.timestamp {
  color: #666;
  font-size: 0.9rem;
}

/* Summary Stats */
.summary-stats {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  margin-bottom: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.summary-title {
  margin-bottom: 1.5rem;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  padding: 1.5rem;
  border-radius: 8px;
  text-align: center;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.stat-label {
  font-size: 0.9rem;
  opacity: 0.8;
}

.stat-total {
  background: #e3f2fd;
  color: #1976d2;
}

.stat-match {
  background: #e8f5e9;
  color: #388e3c;
}

.stat-differ {
  background: #ffebee;
  color: #d32f2f;
}

.stat-env1 {
  background: #fff3e0;
  color: #f57c00;
}

.stat-env2 {
  background: #f3e5f5;
  color: #7b1fa2;
}

.sync-status {
  padding: 1rem;
  border-radius: 4px;
  text-align: center;
  font-weight: 600;
}

.status-synced {
  background: #e8f5e9;
  color: #388e3c;
}

.status-out-of-sync {
  background: #fff3e0;
  color: #f57c00;
}

/* View Selector */
.view-selector {
  background: white;
  padding: 1rem 2rem;
  border-radius: 8px;
  margin-bottom: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.view-selector label {
  margin-right: 1rem;
  font-weight: 600;
}

.view-select {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

/* Table Styles */
.table-wrapper {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
}

.comparison-table thead {
  background: #f8f9fa;
}

.comparison-table th {
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #555;
  border-bottom: 2px solid #dee2e6;
}

.comparison-table tbody tr {
  border-bottom: 1px solid #dee2e6;
}

.main-row {
  cursor: pointer;
  transition: background-color 0.2s;
}

.main-row:hover {
  background-color: #f8f9fa;
}

.comparison-table td {
  padding: 1rem;
}

.icon-cell {
  width: 40px;
  text-align: center;
}

.expand-icon {
  display: inline-block;
  transition: transform 0.2s;
  font-size: 0.8rem;
}

.config-key {
  font-weight: 600;
  color: #333;
}

/* Status Badges */
.status-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
}

.status-match {
  background: #e8f5e9;
  color: #388e3c;
}

.status-differ {
  background: #ffebee;
  color: #d32f2f;
}

.status-only-env1 {
  background: #fff3e0;
  color: #f57c00;
}

.status-only-env2 {
  background: #e1f5fe;
  color: #0277bd;
}

/* Detail Row */
.detail-row {
  background: #f8f9fa;
}

.detail-container {
  padding: 1.5rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  margin-bottom: 1.5rem;
}

.env-details {
  background: white;
  padding: 1rem;
  border-radius: 4px;
}

.env-title {
  font-size: 1.1rem;
  margin-bottom: 1rem;
  color: #667eea;
  font-weight: 600;
}

.detail-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  font-size: 0.9rem;
}

.detail-label {
  color: #666;
  font-weight: 500;
}

.detail-value {
  color: #333;
}

/* Differences Section */
.differences-section {
  background: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: 4px;
  padding: 1rem;
}

.diff-title {
  color: #c53030;
  margin-bottom: 0.5rem;
  font-size: 1rem;
}

.diff-list {
  list-style: none;
  padding-left: 1rem;
}

.diff-list li {
  margin-bottom: 0.5rem;
  color: #742a2a;
  font-size: 0.9rem;
}

.env1-value {
  color: #c53030;
  font-weight: 600;
}

.env2-value {
  color: #2c7a7b;
  font-weight: 600;
}

/* Responsive */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .comparison-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
}
```

---

## 7. Security Considerations

### 7.1 Database Credentials

- **Never store credentials in plaintext**
- Use Tauri's secure storage or system keychain
- Implement credential encryption at rest
- Support environment variables for CI/CD

### 7.2 Connection Security

- Support SSL/TLS connections to Oracle
- Validate certificates
- Implement connection timeout limits
- Rate limit connection attempts

### 7.3 Data Protection

- Mask sensitive configuration values in UI
- Implement role-based access if needed
- Audit logging for comparison activities
- Secure export file permissions

---

## 8. Performance Considerations

### 8.1 Database Queries

- Use prepared statements with parameter binding
- Implement query timeout (30 seconds default)
- Consider pagination for large config sets (>1000 records)
- Use connection pooling if multiple comparisons

### 8.2 Frontend Rendering

- Virtualize large lists (using Intersection Observer API)
- Lazy load expanded row details
- Debounce search/filter inputs
- Implement progressive loading

### 8.3 Memory Management

- Stream large result sets instead of loading all at once
- Clean up database connections properly
- Implement result caching with TTL

---

## 9. Error Handling

### 9.1 Connection Errors

```rust
pub enum ConnectionError {
    InvalidCredentials,
    HostUnreachable,
    ServiceNotFound,
    Timeout,
    NetworkError(String),
}
```

### 9.2 Query Errors

- Table not found
- Insufficient permissions
- Query timeout
- Invalid SQL syntax

### 9.3 UI Error Display

- Toast notifications for transient errors
- Modal dialogs for critical errors
- Inline validation for form inputs
- Detailed error logs in dev mode

---

## 10. Testing Strategy

### 10.1 Unit Tests (Rust)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_differences() {
        let r1 = ConfigRecord {
            config_key: "test_key".to_string(),
            value: "10".to_string(),
            // ...
        };

        let r2 = ConfigRecord {
            config_key: "test_key".to_string(),
            value: "20".to_string(),
            // ...
        };

        let diffs = ComparisonEngine::find_differences(&r1, &r2);
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].field_name, "value");
    }
}
```

### 10.2 Integration Tests

- Test actual Oracle database connections
- Test comparison with mock data
- Test export functionality

### 10.3 E2E Tests

- Use Tauri's testing framework
- Test complete user workflows
- Test error scenarios

---

## 11. Deployment & Distribution

### 11.1 Build Configuration

```toml
# Cargo.toml
[dependencies]
oracle = "0.6"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tauri = { version = "2.0", features = ["dialog", "fs"] }
tokio = { version = "1", features = ["full"] }
chrono = "0.4"
anyhow = "1.0"
```

### 11.2 Platform Support

- Windows: MSVC toolchain, Oracle Instant Client
- macOS: Apple Silicon + Intel support
- Linux: Ubuntu 20.04+ with Oracle client

### 11.3 Oracle Client Dependencies

- Include Oracle Instant Client in installer
- Document manual installation steps
- Provide pre-built bundles per platform

---

## 12. Future Enhancements

### 12.1 Phase 2 Features

- Save comparison profiles (connection configs)
- Schedule automated comparisons
- Email notifications for differences
- Compare more than 2 environments simultaneously
- Sync configurations between environments
- Configuration version history

### 12.2 Phase 3 Features

- Support for other databases (PostgreSQL, MySQL)
- AI-powered difference analysis
- Integration with CI/CD pipelines
- REST API for programmatic access
- Multi-tenancy support

---

## 13. Appendix

### 13.1 Database Setup Script

```sql
-- Create sample configuration table
CREATE TABLE app_config (
    config_key      VARCHAR2(100)   PRIMARY KEY,
    value           VARCHAR2(4000)  NOT NULL,
    description     VARCHAR2(500),
    data_type       VARCHAR2(50),
    category        VARCHAR2(100),
    is_active       CHAR(1) DEFAULT 'Y' CHECK (is_active IN ('Y', 'N')),
    created_by      VARCHAR2(100)   DEFAULT USER,
    created_date    DATE            DEFAULT SYSDATE,
    modified_by     VARCHAR2(100)   DEFAULT USER,
    modified_date   DATE            DEFAULT SYSDATE
);

-- Create audit trigger
CREATE OR REPLACE TRIGGER app_config_audit
BEFORE UPDATE ON app_config
FOR EACH ROW
BEGIN
    :NEW.modified_by := USER;
    :NEW.modified_date := SYSDATE;
END;
/

-- Insert sample data
INSERT INTO app_config (config_key, value, description, data_type, category) VALUES
('db_pool_size', '20', 'Database connection pool size', 'NUMBER', 'DATABASE');

INSERT INTO app_config (config_key, value, description, data_type, category) VALUES
('api_timeout_sec', '30', 'API request timeout in seconds', 'NUMBER', 'API');

INSERT INTO app_config (config_key, value, description, data_type, category) VALUES
('enable_feature_x', 'TRUE', 'Enable feature X', 'BOOLEAN', 'FEATURES');

COMMIT;
```

### 13.2 Sample Output JSON

```json
{
  "env1_name": "UAT1",
  "env2_name": "UAT2",
  "timestamp": "2025-11-06T14:30:00+07:00",
  "summary": {
    "total_configs": 3,
    "matching": 1,
    "differing": 2,
    "only_in_env1": 0,
    "only_in_env2": 0
  },
  "comparisons": [
    {
      "config_key": "db_pool_size",
      "status": "Differ",
      "env1_data": {
        "config_key": "db_pool_size",
        "value": "10",
        "description": "Database pool size",
        "data_type": "NUMBER",
        "category": "DATABASE",
        "is_active": "Y",
        "created_by": "admin",
        "created_date": "2024-01-15T00:00:00",
        "modified_by": "admin",
        "modified_date": "2024-03-20T10:30:00"
      },
      "env2_data": {
        "config_key": "db_pool_size",
        "value": "20",
        "description": "Database pool size",
        "data_type": "NUMBER",
        "category": "DATABASE",
        "is_active": "Y",
        "created_by": "admin",
        "created_date": "2024-01-15T00:00:00",
        "modified_by": "john_doe",
        "modified_date": "2024-08-10T14:20:00"
      },
      "differences": [
        {
          "field_name": "value",
          "env1_value": "10",
          "env2_value": "20"
        },
        {
          "field_name": "modified_by",
          "env1_value": "admin",
          "env2_value": "john_doe"
        },
        {
          "field_name": "modified_date",
          "env1_value": "2024-03-20T10:30:00",
          "env2_value": "2024-08-10T14:20:00"
        }
      ]
    }
  ]
}
```

---

## 14. Glossary

| Term              | Definition                                           |
| ----------------- | ---------------------------------------------------- |
| UAT               | User Acceptance Testing environment                  |
| Config Key        | Unique identifier for a configuration setting        |
| Comparison Status | State indicating whether configs match or differ     |
| Environment       | A distinct database instance (dev, test, prod, etc.) |
| Tauri Command     | Rust function exposed to frontend via IPC            |
| Vanilla JS        | Plain JavaScript without frameworks (ES6+)           |

---

## 15. References

- [Tauri Documentation](https://tauri.app/v2/guides/)
- [Oracle Rust Driver](https://github.com/kubo/rust-oracle)
- [Serde JSON](https://docs.rs/serde_json/)
- [MDN Web Docs - Vanilla JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

---

**Document Control**

| Version | Date       | Author      | Changes                             |
| ------- | ---------- | ----------- | ----------------------------------- |
| 1.0     | 2025-11-06 | [Your Name] | Initial draft - Vanilla JS frontend |

**Approval**

| Role            | Name | Date | Signature |
| --------------- | ---- | ---- | --------- |
| Tech Lead       |      |      |           |
| Product Owner   |      |      |           |
| Security Review |      |      |           |
