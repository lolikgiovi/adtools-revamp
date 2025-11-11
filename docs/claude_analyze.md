# Claude Code Prompt: Multi-Platform Repository Analysis & Performance Report

## Context
You are analyzing a complex multi-platform repository with three integrated components:
1. **Frontend (app/)**: Vanilla JavaScript application
2. **Backend (src/)**: Cloudflare Workers
3. **Desktop Backend (src-tauri/)**: Tauri application

## Primary Objective
Generate a comprehensive performance and structure analysis report that can be fed directly into an AI IDE for actionable improvements. The analysis should be non-invasive and not affect the application's current functionality.

## Analysis Requirements

### Phase 1: Repository Structure Analysis
Please analyze the repository structure and provide insights on:

1. **Architecture Assessment**
   - Map the complete directory structure of all three components
   - Identify architectural patterns used (MVC, microservices, etc.)
   - Evaluate separation of concerns between FE, BE, and Desktop
   - Analyze inter-component communication patterns
   - Identify potential circular dependencies

2. **Code Organization**
   - Assess module structure and organization
   - Evaluate naming conventions consistency
   - Check for code duplication across components
   - Analyze shared code/utilities placement
   - Review configuration management approach

3. **Integration Points Analysis**
   - Map all API endpoints and their usage
   - Document data flow between components
   - Identify integration bottlenecks
   - Review error handling at integration boundaries
   - Assess authentication/authorization flow

### Phase 2: Performance Measurement

Perform non-invasive performance analysis using static code analysis and lightweight profiling:

1. **Frontend (Vanilla JS) Performance**
   - Bundle size analysis
   - JavaScript execution complexity (cyclomatic complexity)
   - DOM manipulation patterns efficiency
   - Network request optimization opportunities
   - Memory leak potential identification
   - Asset loading strategy review
   - Browser compatibility considerations

2. **Cloudflare Workers Backend Performance**
   - Request/response size analysis
   - Worker script size and optimization potential
   - KV storage usage patterns
   - Durable Objects utilization (if applicable)
   - Cache strategy effectiveness
   - Edge computing optimization opportunities
   - Cold start impact assessment

3. **Tauri Desktop Backend Performance**
   - Binary size analysis
   - Memory usage patterns
   - IPC communication efficiency
   - Native API usage optimization
   - Resource management (file handles, network connections)
   - Cross-platform compatibility impact
   - Update mechanism efficiency

### Phase 3: Code Quality & Efficiency Metrics

1. **Static Analysis Metrics**
   - Cyclomatic complexity per function/module
   - Code coverage potential (identify untestable code)
   - Technical debt indicators
   - Dead code detection
   - Unused dependencies identification

2. **Security Assessment**
   - Identify potential security vulnerabilities
   - Review authentication implementation
   - Check for exposed sensitive data
   - Analyze CORS configurations
   - Review input validation practices

3. **Build & Development Efficiency**
   - Build time analysis
   - Development server startup time
   - Hot reload effectiveness
   - CI/CD pipeline optimization opportunities
   - Testing infrastructure assessment

## Report Generation Requirements

### Report Structure
Generate a markdown report with the following structure:

```markdown
# Repository Analysis Report
Generated: [timestamp]
Repository: [repo-name]

## Executive Summary
- Overall health score: X/100
- Critical issues count: X
- High priority improvements: X
- Medium priority improvements: X
- Low priority improvements: X

## Component Analysis

### Frontend (Vanilla JS)
[Detailed analysis with metrics]

### Backend (Cloudflare Workers)
[Detailed analysis with metrics]

### Desktop Backend (Tauri)
[Detailed analysis with metrics]

## Critical Issues (Immediate Action Required)
Priority: 🔴 CRITICAL
1. [Issue description]
   - Impact: [description]
   - Location: [file:line]
   - Suggested fix: [actionable solution]
   - Effort estimate: [hours/days]

## High Priority Improvements (Address within 1 week)
Priority: 🟠 HIGH
[Similar structure as above]

## Medium Priority Improvements (Address within 1 month)
Priority: 🟡 MEDIUM
[Similar structure as above]

## Low Priority Optimizations (Nice to have)
Priority: 🟢 LOW
[Similar structure as above]

## Performance Metrics Summary
[Table format with before/after potential]

## Implementation Roadmap
Week 1: [Critical fixes]
Week 2-3: [High priority items]
Month 2: [Medium priority items]
Ongoing: [Low priority and maintenance]

## AI IDE Integration Instructions
[Specific instructions for feeding this report to AI IDE]
```

### Actionable Output Requirements

Each identified issue must include:
1. **Clear problem statement** - What is wrong
2. **Impact assessment** - Why it matters (performance impact %, user experience impact)
3. **Exact location** - File path and line numbers
4. **Reproduction steps** (if applicable)
5. **Concrete solution** - Step-by-step fix with code examples
6. **Effort estimation** - Hours or days required
7. **Dependencies** - What needs to be changed together
8. **Testing requirements** - How to verify the fix

## Execution Instructions

1. **Initial Setup**
   ```bash
   # Navigate to repository root
   cd [repository-path]
   
   # Install analysis tools (non-invasively)
   npm install --save-dev lighthouse webpack-bundle-analyzer
   ```

2. **Run Analysis Commands**
   ```bash
   # Analyze frontend bundle
   npx webpack-bundle-analyzer app/dist/stats.json
   
   # Check Cloudflare Workers size
   wrangler publish --dry-run --outdir=dist
   
   # Analyze Tauri build
   cargo bloat --release
   ```

3. **Generate Performance Profiles**
   - Use Chrome DevTools Performance API programmatically
   - Generate flame graphs for critical paths
   - Create memory snapshots at key points

4. **Output Format**
   - Main report: `performance-report.md`
   - Metrics data: `metrics.json`
   - Visualization assets: `charts/` directory

## Non-Invasive Testing Guidelines

- **DO NOT** modify any source code during analysis
- **DO NOT** run load tests on production endpoints
- **USE** static analysis tools primarily
- **USE** build artifacts for size analysis
- **CREATE** temporary test builds in isolated directories
- **PRESERVE** all original configurations

## Success Criteria

The report will be considered complete when it:
1. Identifies all critical performance bottlenecks
2. Provides actionable fixes for each issue
3. Includes effort estimates accurate within 20%
4. Can be directly imported into AI IDEs (Cursor, Windsurf, etc.)
5. Follows a clear priority system from critical to nice-to-have
6. Includes before/after performance projections

## Additional Considerations

- Focus on cross-component optimization opportunities
- Identify shared code that could be extracted
- Suggest modern alternatives to legacy patterns
- Consider progressive enhancement strategies
- Recommend monitoring/observability improvements
- Suggest automated testing additions where gaps exist

---

Please execute this analysis and generate the comprehensive report. If you need access to specific files or have questions about the architecture, please ask before proceeding with assumptions.