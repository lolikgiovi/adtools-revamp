# Jenkins Query Runner

This feature integrates with Jenkins to run read-only SQL queries through specially configured jobs, stream build logs live, and provide a secure workflow for credentials.

## Overview

- Frontend tool: `Jenkins Query Runner` available in the sidebar.
- Secure credentials: Username + API Token stored in macOS Keychain via Tauri.
- Dedicated Jenkins Base URL: configured in Settings and used by the runner.
- Strict job validation: only `TESTER-EXECUTE-QUERY` or `TESTER-EXECUTE-QUERY-NEW` are accepted.
- Dynamic environment choices: fetched from Jenkins job parameters.
- Live logs: streamed progressively and displayed in the tool.

## Settings

Open `Settings` → `Configuration Settings` and `Credential Management`.

- `Jenkins Base URL` (`config.jenkins.url`)

  - Required; must start with `http://` or `https://`.
  - Saved to local storage and used by the runner as read-only in the tool.

- `Jenkins Username` (`secure.jenkins.username`)

  - Saved to macOS Keychain and persisted for display in Settings.

- `Jenkins Token` (`secure.jenkins.token`)
  - Enter once to store securely in macOS Keychain.
  - Displayed as masked (••••••••) after saving; only replacement is allowed.
  - Guidance: generate a token in Jenkins: User → Configure → API Token.

## Using the Runner

1. Ensure `Jenkins Base URL`, `Jenkins Username`, and `Jenkins Token` are set in Settings.
2. Open `Jenkins Query Runner`.
3. Enter a job name:
   - Must be exactly `TESTER-EXECUTE-QUERY` or `TESTER-EXECUTE-QUERY-NEW` (case-sensitive).
4. Environment choices:
   - Automatically loaded from the Jenkins job `ENV` parameter.
   - Includes a loading spinner and retry on transient failures.
   - Your last selected ENV persists across sessions.
5. SQL text:
   - Must be read-only (e.g., `SELECT ...`).
   - The tool blocks `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE`.
6. Click `Run on Jenkins`:
   - Triggers the job and polls the queue for a build.
   - When the build starts, the tool streams logs live.
   - If available, an `Open Build` link is shown.

## Validation & Accessibility

- Required fields are marked with an asterisk.
- Submission is disabled until all validations pass.
- Clear error messages are shown inline; ENV fetch errors include retry attempts.
- Styles include focus states, adequate contrast, responsive behavior, and hover transitions.

## Security Notes

- Tokens never persist client-side; only a placeholder is saved for masked display.
- Jenkins Username and Token are read from macOS Keychain when invoking backend commands.
- HTTP requests use basic auth over HTTPS (recommended), with crumb issuer handling.

## Troubleshooting

- ENV choices not loading:
  - Verify Jenkins Base URL, Job Name, and credentials.
  - Check backend logs; crumb issuer might be required.
- Trigger fails with HTTP 401/403:
  - Regenerate the Jenkins API token and re-enter in Settings.
- No logs streaming:
  - Ensure build has started; the tool polls the queue and begins streaming once executable is assigned.

## Backend Commands (Tauri)

- `set_jenkins_username(username: String)`
- `set_jenkins_token(token: String)`
- `has_jenkins_token() -> bool`
- `jenkins_get_env_choices(base_url: String, job: String) -> Vec<String>`
- `jenkins_trigger_job(base_url: String, job: String, env: String, sql_text: String) -> String`
- `jenkins_poll_queue_for_build(_base_url: String, queue_url: String) -> (Option<u64>, Option<String>)`
- `jenkins_stream_logs(app, base_url: String, job: String, build_number: u64)`

## Testing Checklist

- Styling: verify across supported browsers; check focus, hover, and contrast.
- Responsive: test on narrow and wide viewports; controls stack under 900px.
- Security: confirm token storage in Keychain and masked display; test token replacement.
- Integration: verify env choices load, job triggers, queue poll, and log streaming with a real Jenkins instance.
- Edge cases: invalid URLs, wrong job names, short SQL, network errors during ENV fetch, polling timeouts.
