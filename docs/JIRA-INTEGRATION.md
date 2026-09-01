# Jira 9.17.3 REST Integration Notes

This document records the Jira integration implemented in AD Tools. It summarizes the
[Jira Data Center 9.17.0 platform REST API reference](https://docs.atlassian.com/software/jira/docs/api/REST/9.17.0/),
fetched on 2026-07-27 for the target Jira 9.17.3 instance. Atlassian publishes this reference for the 9.17 feature release; verify
behavior against 9.17.3 when implementing. The upstream reference remains the source of truth for request fields, response schemas,
and status codes.

## Target and Authentication

The target is **Jira Data Center 9.17.3** and the platform API version is **2**, so requests use `/rest/api/2`. Confirm the connected
instance with `GET /rest/api/2/serverInfo`; its response should report `9.17.3`.

| Authentication              | Recommendation                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Personal access token (PAT) | Recommended for this initial internal integration; send it as `Authorization: Bearer <token>` |
| OAuth 2.0                   | Recommended when AD Tools needs delegated, per-user access without storing user PATs          |
| OAuth 1.0a                  | Supported but deprecated                                                                      |
| Basic HTTP                  | Supported, but Atlassian recommends it only for simple scripts or bots                        |
| Cookie session              | Supported for browser sessions, but not recommended as the integration credential             |

PATs inherit the permissions of the Jira user who created them. A PAT identifies its owner, so no username is sent alongside the
Bearer token. Set an expiry date and revoke or rotate the token when access is no longer needed.

## REST Conventions in 9.17

- Use JSON request and response bodies with standard `GET`, `POST`, `PUT`, and `DELETE` methods.
- Prefer the explicit `/rest/api/2` path over `/rest/api/latest` so an upgrade cannot silently change the integration contract.
- Use `fields` to request only needed issue fields and reduce response size.
- Use `expand` for optional nested data, for example `expand=names,renderedFields`.
- Paged endpoints commonly accept `startAt` and `maxResults`. Treat `total` as optional and mutable, and stop when a returned page is
  empty or shorter than the requested page size.
- An `X-AUSERNAME` response header can identify the authenticated user or report `anonymous`.
- Multipart uploads require `X-Atlassian-Token: no-check`. Despite its name, this is an XSRF header, not an authentication token.
- Jira permissions still apply to the authenticated user. A successful login does not imply permission to read or change every issue.

## Useful Platform Endpoints

| Purpose                  | Method and path                                                              | Notes                                                         |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Detect server/version    | `GET /rest/api/2/serverInfo`                                                 | Returns the base URL, version, build number, and server title |
| Verify credentials       | `GET /rest/api/2/myself`                                                     | Cannot be accessed anonymously                                |
| List visible projects    | `GET /rest/api/2/project`                                                    | Results are filtered by the caller's visibility               |
| Search issues            | `POST /rest/api/2/search`                                                    | Preferred for non-trivial JQL and explicit field lists        |
| Search issues            | `GET /rest/api/2/search`                                                     | Accepts JQL and pagination as query parameters                |
| Read an issue            | `GET /rest/api/2/issue/{issueIdOrKey}`                                       | Use `fields` to avoid fetching every field                    |
| List create issue types  | `GET /rest/api/2/issue/createmeta/{projectIdOrKey}/issuetypes`               | Results require create permission in the project              |
| Discover create fields   | `GET /rest/api/2/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}` | Fields depend on issue type, screen, and permissions          |
| Create an issue          | `POST /rest/api/2/issue`                                                     | Only fields available through create metadata may be accepted |
| Discover editable fields | `GET /rest/api/2/issue/{issueIdOrKey}/editmeta`                              | Fields depend on the issue's edit screen                      |
| Edit an issue            | `PUT /rest/api/2/issue/{issueIdOrKey}`                                       | Supports setting values and update operations                 |
| Add a comment            | `POST /rest/api/2/issue/{issueIdOrKey}/comment`                              | A basic body is `{ "body": "..." }`                           |
| Discover transitions     | `GET /rest/api/2/issue/{issueIdOrKey}/transitions`                           | Add `expand=transitions.fields` for transition screen fields  |
| Transition an issue      | `POST /rest/api/2/issue/{issueIdOrKey}/transitions`                          | Transition IDs and required fields are workflow-specific      |
| Add attachments          | `POST /rest/api/2/issue/{issueIdOrKey}/attachments`                          | Send multipart form data plus `X-Atlassian-Token: no-check`   |

Jira Software features such as boards, backlogs, and sprints use a separate Jira Software REST API and are not covered by the
platform 9.17 reference. Jira Service Management customer requests likewise use a separate API.

## PAT Smoke Test for Jira 9.17.3

Create the PAT from the Jira user's profile, place it in an environment variable, and verify it against an authenticated endpoint:

```bash
export JIRA_BASE_URL="https://jira.example.com"
read -r -s JIRA_PAT
export JIRA_PAT

curl --fail-with-body \
  --header "Accept: application/json" \
  --header "Authorization: Bearer ${JIRA_PAT}" \
  "${JIRA_BASE_URL}/rest/api/2/myself"
```

Then test a bounded search:

```bash
curl --fail-with-body \
  --request POST \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer ${JIRA_PAT}" \
  --data '{"jql":"project = DEMO ORDER BY updated DESC","startAt":0,"maxResults":25,"fields":["summary","status","assignee","updated"]}' \
  "${JIRA_BASE_URL}/rest/api/2/search"
```

Unset the token after manual testing. Never commit a real base URL, username, password, API token, PAT, cookie, or captured response
containing private Jira data.

## Implemented AD Tools Design

Keep Jira access behind a small service boundary:

```text
Jira tool UI -> Jira service -> trusted backend or Tauri command -> Jira REST API
```

The browser UI never receives or persists a Jira PAT. The implementation:

1. Uses a Jira connection profile containing the validated HTTPS base URL and PAT mode.
2. Stores desktop secrets in macOS Keychain, following the existing Confluence PAT pattern. For the web app, proxy requests through a
   Cloudflare Worker and keep service credentials in Worker secrets; per-user credentials need a separate encrypted storage design.
3. Uses the Tauri desktop path for the internal Jira instance, with an explicit untrusted-certificate fallback for Jira only.
4. Restricts outbound destinations to configured HTTPS Jira hosts to prevent server-side request forgery. It does not accept arbitrary proxy
   URLs from the frontend.
5. Uses one client that owns base URL normalization, authentication headers, timeouts, pagination, error mapping, and response limits.
6. Discovers the live create contract before exposing the create form, then creates subtasks through the Jira bulk endpoint only after
   explicit user confirmation.
7. Give the Jira account least privilege, use a dedicated integration identity where policy permits, set token expiry, and document
   rotation and revocation.
8. Avoid automatic retries for non-idempotent writes. Jira may complete a write even when a proxy returns a timeout.
9. Redact `Authorization`, cookies, query values, issue descriptions, comments, and attachment metadata from logs and analytics.

The web app still does not call Jira directly. A web deployment needs an approved gateway before this tool can be enabled there.

## Error Handling Baseline

- `400`: invalid JQL, field validation failure, malformed JSON, or an inaccessible project being presented as an invalid JQL value.
- `401`: missing, expired, unsupported, or incorrectly formatted credentials.
- `403`: authenticated, but the user lacks the required Jira permission.
- `404`: the resource is absent or hidden from the caller.
- `429`: apply bounded backoff if returned by the deployment or an intermediary.
- `5xx` and network timeouts: retry safe reads with capped exponential backoff; verify write outcomes before retrying.

Preserve Jira's `errorMessages` array and field-level `errors` map in the service error model, while showing a concise message in the UI.

## Upstream References

- [Jira Data Center 9.17.0 platform REST API](https://docs.atlassian.com/software/jira/docs/api/REST/9.17.0/)
- [Jira Software 9.17.x release notes](https://confluence.atlassian.com/jirasoftware/jira-software-9-17-x-release-notes-1402418633.html)
- [Issues resolved in Jira Software 9.17.3](https://confluence.atlassian.com/jirasoftware/issues-resolved-in-9-17-3-1443037590.html)
- [Jira Data Center personal access tokens](https://developer.atlassian.com/server/jira/platform/personal-access-token/)
- [Using personal access tokens and supported versions](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)
- [Atlassian troubleshooting: Basic versus Bearer authorization](https://support.atlassian.com/jira/kb/webhooks-or-web-requests-fail-with-http-status-code-400-401-or-403-in-jira/)
