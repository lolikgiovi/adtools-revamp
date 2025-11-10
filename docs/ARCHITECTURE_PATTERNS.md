# AD Tools Application Architecture Summary

## Executive Overview

AD Tools is a desktop and web application built with **Tauri 2.x** and **vanilla JavaScript** (ES6+ modules). It's a modular tool ecosystem where each tool is independently encapsulated with its own UI, state, and business logic.

**Key Technologies:**
- **Frontend:** Vanilla JavaScript (ES6+ modules), HTML5, CSS3
- **Build System:** Vite (development and production builds)
- **Backend:** Rust with Tauri 2.x framework
- **Database Clients:** Reqwest for HTTP/REST, Keyring for credential storage
- **Testing:** Vitest with JSDOM
- **Package Manager:** npm
- **Desktop Framework:** Tauri 2.x (cross-platform desktop wrapper)

---

## Frontend Architecture

### Directory Structure
```
app/
├── App.js                          # Main application orchestrator
├── config/
│   └── tools.json                  # Tool metadata and configuration
├── core/                           # Shared utilities and services
│   ├── BaseTool.js                # Base class for all tools
│   ├── EventBus.js                # Pub/sub event system
│   ├── Router.js                  # Hash-based navigation
│   ├── Runtime.js                 # Platform detection (Tauri vs Web)
│   ├── ThemeManager.js            # Light/dark theme management
│   ├── UsageTracker.js            # Analytics and usage tracking
│   ├── AnalyticsSender.js         # Analytics data collection
│   ├── Updater.js                 # Application update manager
│   ├── MonacoOracle.js            # Monaco Editor configuration
│   ├── Categories.js              # Tool categorization logic
│   └── SessionTokenStore.js       # Session management
├── components/                     # Reusable UI components
│   ├── Sidebar.js                 # Navigation sidebar
│   ├── Breadcrumb.js              # Breadcrumb navigation
│   ├── GlobalSearch.js            # Application-wide search
│   └── OtpOverlay.js              # OTP modal component
├── pages/                          # Special pages (not tools)
│   ├── settings/                  # Settings page
│   │   ├── main.js
│   │   ├── service.js
│   │   ├── template.js
│   │   ├── icon.js
│   │   ├── styles.css
│   │   └── config.json
│   ├── about/                     # About page
│   └── register/                  # Registration page
└── tools/                          # Tool implementations
    ├── json-tools/
    ├── base64-tools/
    ├── uuid-generator/
    ├── qr-tools/
    ├── quick-query/
    ├── html-editor/
    ├── jenkins-runner/
    ├── splunk-template/
    ├── sql-in-clause/
    └── image-checker/
```

### Core Patterns

#### 1. **Tool Architecture**

Every tool follows this structure:

```
app/tools/<tool-name>/
├── main.js              # Tool class extending BaseTool
├── template.js          # HTML template as exported string
├── styles.css          # Scoped styles
├── service.js          # Optional: pure business logic
├── services/           # Optional: multiple service modules
├── icon.js             # SVG icon provider
└── constants.js        # Optional: tool-specific constants
```

**Tool Lifecycle:**
```javascript
class MyTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "my-tool",
      name: "My Tool",
      description: "Tool description",
      icon: "icon-name",
      category: "config" or "application",
      eventBus  // Shared event bus
    });
  }

  render() {
    return TEMPLATE_STRING;  // Return HTML
  }

  onMount() {
    // Called after mount: initialize DOM, bind events
    this.bindToolEvents();
  }

  onActivate() {
    // Called when tool becomes active
  }

  onDeactivate() {
    // Called when navigating away
  }

  onUnmount() {
    // Cleanup before unmounting
  }
}

export { MyTool };
```

#### 2. **Component Lifecycle**

**Application Flow:**
1. `App.js` initializes
2. Tools are registered in `registerTools()`
3. Routes are set up
4. User navigates to tool via hash URL
5. `Router` emits `route:changed` event
6. `App.showTool()` calls `tool.activate()` → `tool.mount(container)` → `tool.onMount()`
7. Tool renders HTML and binds event listeners
8. Tool listens to `tool:activate` event (inherited from BaseTool)

#### 3. **Event Bus Pattern**

Central pub/sub mechanism for loose coupling:

```javascript
// Emitting events
this.eventBus.emit("notification:success", { message: "Copied!" });
this.eventBus.emit("tool:activate", { toolId: "json-tools" });

// Listening to events
this.eventBus.on("route:changed", (data) => {
  console.log("Route changed to:", data.path);
});
```

**Common Events:**
- `tool:registered` - Tool added to app
- `tool:activate` - User navigates to tool
- `tool:activated` / `tool:deactivated` - Tool lifecycle
- `route:change` / `route:changed` - Navigation events
- `notification:success` / `notification:error` - Toast messages
- `page:changed` - Settings/special pages

#### 4. **State Management**

**Pattern:** Component-level state + localStorage for persistence

```javascript
// Local state (tool instance)
this.state = {
  key1: value1,
  key2: value2
};

// Persistent storage
localStorage.setItem("config.jenkins.url", baseUrl);
const saved = localStorage.getItem("config.jenkins.url");

// Service-based state
class MyService {
  static loadFromStorage() {
    return JSON.parse(localStorage.getItem("my-data") || "{}");
  }
  
  static saveToStorage(data) {
    localStorage.setItem("my-data", JSON.stringify(data));
  }
}
```

#### 5. **Service Pattern (Business Logic Separation)**

**UI/Controller (main.js):**
- Handles DOM manipulation
- Manages lifecycle
- Binds event listeners
- Calls services with user input

**Service (service.js):**
- Pure functions (no DOM)
- Input → Output transformation
- Validation logic
- API calls (when needed)

```javascript
// service.js - Pure logic
export class MyService {
  static validate(input) {
    // Returns { isValid: boolean, errors: [] }
  }
  
  static process(data) {
    // Pure transformation
    return transformed;
  }
}

// main.js - UI Controller
class MyTool extends BaseTool {
  onMount() {
    this.bindToolEvents();
  }
  
  handleProcess() {
    const input = this.container.querySelector("input").value;
    try {
      const result = MyService.validate(input);
      if (!result.isValid) {
        this.showError(result.errors.join(", "));
        return;
      }
      const output = MyService.process(input);
      this.displayResult(output);
    } catch (e) {
      this.showError(e.message);
    }
  }
}
```

#### 6. **Form Input Handling**

**Pattern: Direct DOM binding with state updates**

```javascript
// Example from JenkinsRunner
attachInputListeners(envPrefix) {
  const fields = ["host", "port", "service", "username", "password"];
  const config = envPrefix === "env1" ? this.env1Config : this.env2Config;

  fields.forEach((field) => {
    const element = document.getElementById(`${envPrefix}-${field}`);
    element?.addEventListener("input", (e) => {
      const key = field === "service" ? "service_name" : field;
      const value = field === "port" ? parseInt(e.target.value) : e.target.value;
      config[key] = value;
    });
  });
}
```

**Validation Pattern:**
```javascript
validateForm() {
  const errors = [];
  
  if (!this.host) errors.push("Host is required");
  if (!this.port) errors.push("Port is required");
  if (!this.username) errors.push("Username is required");
  
  if (errors.length > 0) {
    this.showError(errors.join("<br>"));
    return false;
  }
  return true;
}
```

### Configuration Management

**tools.json defines:**
```json
{
  "categories": [
    { "id": "config", "name": "Config", "order": 10 },
    { "id": "general", "name": "General", "order": 20 }
  ],
  "tools": [
    {
      "id": "json-tools",
      "name": "JSON Tools",
      "category": "general",
      "icon": "json",
      "showInSidebar": true,
      "showOnHome": true,
      "enabled": true,
      "requiresTauri": false,  // If true, only visible in desktop app
      "order": 20
    }
  ]
}
```

**App.js reads this during init:**
```javascript
buildToolsConfigMap() {
  const list = toolsConfig.tools || [];
  this.toolsConfigMap.clear();
  list.forEach((cfg) => {
    if (cfg.id) this.toolsConfigMap.set(cfg.id, cfg);
  });
}
```

### Template Pattern

**Templates are strings with `html` comment for syntax highlighting:**

```javascript
// template.js
export const MyToolTemplate = /* html */ `
  <div class="my-tool">
    <h2>My Tool</h2>
    <input type="text" id="my-input" placeholder="Enter something" />
    <button id="my-button">Process</button>
    <div id="output"></div>
  </div>
`;

// main.js
class MyTool extends BaseTool {
  render() {
    return MyToolTemplate;
  }
  
  onMount() {
    // DOM is now available
    const input = this.container.querySelector("#my-input");
    const button = this.container.querySelector("#my-button");
    button?.addEventListener("click", () => this.handleClick());
  }
}
```

### Tauri Command Invocation

**Pattern: Use isTauri() to detect environment, call invoke() for commands**

```javascript
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/Runtime.js";

export class JenkinsRunnerService {
  async hasToken() {
    if (!isTauri()) {
      return false;  // Mock data for web
    }
    try {
      return await invoke("has_jenkins_token");
    } catch (_) {
      return false;
    }
  }

  async triggerJob(baseUrl, job, env, sqlText) {
    if (!isTauri()) {
      throw new Error("Only available in desktop app");
    }
    return await invoke("jenkins_trigger_job", {
      baseUrl,
      job,
      env,
      sqlText
    });
  }
}
```

### Error Handling & Notifications

**BaseTool provides built-in methods:**

```javascript
class MyTool extends BaseTool {
  async doSomething() {
    try {
      const result = await someAsyncOperation();
      this.showSuccess("Operation completed!");
    } catch (error) {
      this.showError(`Operation failed: ${error.message}`);
    }
  }
  
  // Under the hood, emits via EventBus:
  // this.eventBus.emit("notification:success", { message, duration })
  // this.eventBus.emit("notification:error", { message, duration })
}
```

---

## Backend Architecture (Rust/Tauri)

### Directory Structure
```
src-tauri/
├── Cargo.toml              # Rust dependencies
├── src/
│   ├── main.rs            # App entry point
│   ├── lib.rs             # Tauri command handlers
│   └── jenkins.rs         # Jenkins-specific logic
├── tauri.conf.json        # Tauri configuration
└── scripts/               # Build scripts
```

### Tauri Commands Pattern

**In lib.rs, commands are Rust async functions annotated with #[tauri::command]:**

```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
  // Params are automatically deserialized from JSON
  // Return value is automatically serialized to JSON
  
  if param.is_empty() {
    return Err("Parameter is required".to_string());
  }
  
  Ok(format!("Processed: {}", param))
}
```

**Setup in lib.rs:**
```rust
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      my_command,
      another_command,
      // ... other commands
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application")
}
```

**Frontend calls:**
```javascript
import { invoke } from "@tauri-apps/api/core";

const result = await invoke("my_command", { param: "value" });
```

### Existing Tauri Commands

**Current implementation (Jenkins integration):**
- `set_jenkins_username(username: String) -> Result<(), String>`
- `set_jenkins_token(token: String) -> Result<(), String>`
- `has_jenkins_token() -> Result<bool, String>`
- `jenkins_get_env_choices(base_url, job) -> Result<Vec<String>, String>`
- `jenkins_trigger_job(...) -> Result<String, String>`
- `jenkins_poll_queue_for_build(queue_url) -> Result<(Option<u64>, Option<String>), String>`
- `jenkins_stream_logs(app, base_url, job, build_number) -> Result<(), String>`
- `open_url(url: String) -> Result<(), String>`
- `get_arch() -> String`

### Credential Storage

**Current pattern: System keyring via `keyring` crate**

```rust
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "ad-tools:jenkins";

pub async fn load_credentials() -> Result<Credentials, String> {
  let user_entry = Entry::new(KEYCHAIN_SERVICE, "__username__")?;
  let username = user_entry.get_password()?;
  let token_entry = Entry::new(KEYCHAIN_SERVICE, &username)?;
  let token = token_entry.get_password()?;
  Ok(Credentials { username, token })
}
```

### Error Handling Pattern

**Rust Result types automatically convert to frontend errors:**

```rust
// Returns Err() → frontend receives error string
let conn = DatabaseConnection::new(&config)
  .map_err(|e| format!("Connection failed: {}", e))?;

// Returns Ok() → frontend receives success value
Ok(result)
```

---

## Existing Features & Patterns

### 1. Quick Query Tool

**Pattern: Complex multi-service architecture**

Services:
- `LocalStorageService` - Persistence
- `SchemaValidationService` - Input validation
- `QueryGenerationService` - Business logic
- `AttachmentProcessorService` - File handling
- `ValueProcessorService` - Data transformation
- `SchemaImportService` - Schema import/export

Features:
- Handsontable grid for data entry
- Monaco Editor for SQL preview
- File attachments with minification
- Query generation (MERGE/INSERT/UPDATE)
- Export functionality

### 2. Jenkins Runner Tool

**Pattern: Tauri backend integration**

Features:
- Store credentials in system keyring
- Call Jenkins API to fetch build parameters
- Trigger job execution with multipart form
- Stream build logs via event emitter
- Template management with local storage
- Tag-based filtering

### 3. Settings Page

**Pattern: Special page (not a tool)**

Features:
- Runtime detection (desktop vs web)
- Version display
- Architecture detection (Apple Silicon vs Intel)
- Manual update checks
- Configuration management
- OTP modal for defaults reset

### 4. HTML Editor Tool

**Pattern: Safe iframe preview with sandbox**

Features:
- Monaco Editor for HTML input
- Live preview in sandboxed iframe
- Minification via web worker
- Export to file

### 5. JSON Tools

**Pattern: Multi-tab interface**

Features:
- Validate JSON
- Prettify/minify
- String escape/unescape
- Extract keys
- Error positioning

---

## Coding Conventions

### JavaScript/ES6 Standards

1. **Module exports:**
   ```javascript
   export class MyClass { }
   export function myFunction() { }
   export const MY_CONSTANT = "value";
   ```

2. **Imports:**
   ```javascript
   import { MyClass, myFunction } from "./path.js";
   ```

3. **Class conventions:**
   - Class names: PascalCase (e.g., `JSONTools`)
   - Method names: camelCase (e.g., `bindToolEvents()`)
   - Private methods: use `#` prefix (e.g., `#inlineToast()`)
   - Constants: UPPER_SNAKE_CASE

4. **Event handling:**
   ```javascript
   element.addEventListener("click", (e) => {
     this.handleClick(e);
   });
   ```

5. **Async/await:**
   ```javascript
   async handleAsync() {
     try {
       const result = await somePromise();
       return result;
     } catch (error) {
       console.error("Error:", error);
     }
   }
   ```

### HTML Templates

1. Use `/* html */` comment for syntax highlighting
2. Backticks for multi-line strings
3. Semantic HTML where possible
4. Use `id` and `class` for element selection
5. Use `data-*` attributes for metadata

### CSS Conventions

1. Class naming: kebab-case (e.g., `.my-tool`, `.btn-primary`)
2. Namespace by tool: `.my-tool { } .my-tool .subsection { }`
3. Use CSS variables for theming
4. Mobile-first responsive design

### Rust/Tauri Standards

1. **Command naming:** snake_case (e.g., `jenkins_trigger_job`)
2. **Error handling:** Use `Result<T, String>` for commands
3. **Async:** Use `#[tauri::command]` with `async`
4. **Serialization:** Implement `serde::Serialize/Deserialize`
5. **Error messages:** Human-readable error strings for frontend

---

## Development Workflow

### Key npm Scripts

```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build           # Build for web
npm run build:tauri     # Build for Tauri desktop
npm run test            # Run Vitest tests
npm run preview         # Preview production build
```

### Tauri-specific Scripts

```bash
npm run release:build   # Build desktop release
npm run release:upload  # Upload to R2 storage
```

### Development Tips

1. **Hot Module Replacement:** Changes to files automatically reload
2. **Console access:** Open browser dev tools (F12)
3. **Tauri console:** Desktop version has Tauri console plugin for debugging
4. **Usage tracking:** Tools emit `UsageTracker.trackFeature()` calls
5. **Analytics:** Data is batched and sent periodically

### Settings Storage

All app-wide settings use localStorage:

```javascript
// User session
localStorage.setItem("user.username", username);
localStorage.setItem("user.email", email);

// Tool-specific config
localStorage.setItem("config.jenkins.url", url);
localStorage.setItem("config.<tool-id>.<key>", value);

// Feature flags
localStorage.setItem("feature.<name>", "enabled");
```

---

## Design Principles & Best Practices

1. **Separation of Concerns**
   - UI code in `main.js` (DOM binding)
   - Business logic in `service.js` (pure functions)
   - Templates as string constants in `template.js`

2. **Loose Coupling**
   - Use EventBus for inter-component communication
   - Avoid direct references between tools
   - Services don't know about DOM

3. **DRY - Don't Repeat Yourself**
   - Shared utilities in `app/core/`
   - Common components in `app/components/`
   - Reusable services in tool subdirectories

4. **Defensive Programming**
   - Check element existence: `element?.addEventListener()`
   - Validate inputs before processing
   - Graceful error handling with user feedback

5. **Accessibility**
   - Use semantic HTML
   - ARIA labels for complex controls
   - Keyboard navigation support
   - Color contrast compliance

6. **Performance**
   - Lazy load heavy libraries (Monaco, Handsontable)
   - Debounce search inputs
   - Cache frequently accessed DOM elements
   - Use virtual scrolling for large lists

7. **Security**
   - Never store credentials in localStorage (use Tauri keyring)
   - Sanitize user input for HTML display
   - Validate data on both frontend and backend
   - Use Content Security Policy in Tauri

---

## Architecture for Compare-Config Feature

Based on the existing patterns, here's how to implement the compare-config feature:

### Frontend Structure

```
app/tools/compare-config/
├── main.js                    # Tool class
├── template.js               # HTML template
├── styles.css               # Styles
├── icon.js                  # Icon provider
└── services/
    ├── ConnectionService.js      # Connection form logic
    ├── ComparisonService.js      # Call Tauri backend
    └── ViewRendererService.js    # Handle different view modes
```

### Backend Structure

```
src-tauri/src/
├── lib.rs                   # Register new Tauri commands
├── models/
│   └── config.rs           # Data structures
├── db/
│   └── connection.rs       # Database connection logic
└── comparison/
    └── engine.rs           # Comparison algorithm
```

### Key Implementation Points

1. **Frontend Tool:**
   - Extends `BaseTool`
   - Uses EventBus for updates
   - Form inputs for connection details
   - Tabs for different view modes
   - Uses Tauri `invoke()` to call backend commands

2. **Backend Commands:**
   - `test_connection(config)` - Test DB connectivity
   - `compare_configs(request)` - Execute comparison
   - `export_comparison(result, format)` - Export results

3. **Data Flow:**
   - User inputs connection details (frontend form)
   - Clicks "Compare" button
   - Calls Tauri command with connection configs
   - Rust backend connects to databases
   - Fetches and compares configurations
   - Returns results as JSON
   - Frontend renders multiple view options

4. **View Options:**
   - Expandable row table
   - Vertical card layout
   - Master-detail view
   - Summary statistics

---

## Summary Table

| Aspect | Implementation |
|--------|-----------------|
| **Frontend Language** | Vanilla JavaScript (ES6+) |
| **Build Tool** | Vite |
| **Testing** | Vitest + JSDOM |
| **State Management** | Component state + localStorage |
| **Communication** | EventBus (pub/sub) |
| **Async Calls** | Tauri commands + standard fetch/HTTP |
| **Module System** | ES6 modules |
| **CSS** | Vanilla CSS with variables |
| **Backend Language** | Rust |
| **Desktop Framework** | Tauri 2.x |
| **Credential Storage** | System keyring (Tauri + keyring crate) |
| **Database** | Oracle (via oracle crate or reqwest for APIs) |
| **Error Handling** | Try/catch + Result types |
| **Logging** | console.log / Tauri plugin-log |

