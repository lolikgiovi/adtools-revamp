# AD Tools

This glossary defines project organization and how delivered user value is measured across AD Tools.

## Project organization

**Department**:
A person's organizational home. People can work on projects handled by other departments.

**Project**:
A work context, such as Livin or Livin Dili, that groups its environments, Quick Query schema catalog, Jira project key,
Redis and Kafka connections, and tool settings.
People can work on multiple projects independently of their department.

**Environment**:
A testing target within a project, with its Oracle database connections and CDN entry points.
Different projects can use the same environment name. Redis and Kafka connections belong directly to the project.

**Quick Query schema catalog**:
The table definitions belonging to one project. Identical schema and table names in different projects represent separate definitions.

**Jira project key**:
The Jira project identifier used by tools for the selected AD Tools project. It belongs to the project rather than its testing environments.

**App integration credentials**:
A person's credentials for Confluence, Jira, or Jenkins, reusable across AD Tools projects.
Each service retains its own credential; reuse across projects does not require identical tokens across services.

**Project tool settings**:
The Lockey path, Merge SQL squad names, and API validator endpoints belonging to one project.

## Analytics language

**Tool Open**:
A user reaches a usable tool surface. It measures adoption and visits, not value delivered.
_Avoid_: Use, activity, engagement

**Tool Use**:
A user-initiated core operation reaches the tool-specific success boundary and produces usable output or starts the requested external work.
_Avoid_: Click, attempt, mount, open

**Supporting Event**:
An interaction or diagnostic observation that explains behavior but does not independently represent delivered value, such as a tab change, validation error, or retry.
_Avoid_: Tool use, impact

**Impact**:
The combination of verified Tool Uses and the distinct real users who received that value. Tool Opens and Supporting Events are reported separately.
_Avoid_: Raw activity, total events

The per-tool action names and success boundaries live in `frontend/config/tool-usage-definitions.json` and are enforced against the registered tool list by a test.
