use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const MAX_PREVIEW_STRING_LENGTH: usize = 240;
const MAX_PREVIEW_ARRAY_ITEMS: usize = 8;
const MAX_ALLOWED_VALUES: usize = 500;
const EXCLUDED_SAMPLE_FIELDS: &[&str] = &["description", "comment", "attachment", "worklog"];

#[derive(Debug, Serialize)]
pub struct JiraDiscovery {
    pub server: ServerSummary,
    pub user: UserSummary,
    pub project_key: String,
    pub project_name: Option<String>,
    pub issue_types: Vec<IssueTypeDiscovery>,
    pub samples: Vec<SampleIssue>,
}

#[derive(Debug, Serialize)]
pub struct ServerSummary {
    pub base_url: String,
    pub version: String,
    pub deployment_type: Option<String>,
    pub server_title: String,
}

#[derive(Debug, Serialize)]
pub struct UserSummary {
    pub username: String,
    pub display_name: String,
    pub active: bool,
}

#[derive(Debug, Serialize)]
pub struct IssueTypeDiscovery {
    pub id: String,
    pub name: String,
    pub subtask: bool,
    pub fields: Vec<FieldMeta>,
}

#[derive(Debug, Serialize)]
pub struct FieldMeta {
    pub id: String,
    pub name: String,
    pub required: bool,
    pub schema_type: String,
    pub schema_items: Option<String>,
    pub custom_type: Option<String>,
    pub has_default_value: bool,
    pub default_value: Option<Value>,
    pub allowed_values: Vec<Value>,
    pub operations: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SampleIssue {
    pub key: String,
    pub summary: String,
    pub issue_type: String,
    pub parent_key: Option<String>,
    pub populated_fields: Vec<PopulatedField>,
}

#[derive(Debug, Serialize)]
pub struct PopulatedField {
    pub id: String,
    pub name: String,
    pub value: Value,
}

#[derive(Debug, Serialize, Clone)]
pub struct ParentCandidate {
    pub key: String,
    pub summary: String,
    pub issue_type: String,
    pub status: String,
    pub source_epic_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ParentResolution {
    pub inputs: Vec<ParentCandidate>,
    pub candidates: Vec<ParentCandidate>,
}

#[derive(Debug, Serialize)]
pub struct JiraUserOption {
    pub username: String,
    pub display_name: String,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubtaskInput {
    pub issue_type_id: String,
    pub stream: String,
    pub summary: String,
    pub labels: Vec<String>,
    pub description: String,
    pub confluence_page: String,
    pub priority_id: Option<String>,
    pub ad_story_point_id: String,
    pub dev_story_point_id: Option<String>,
    pub squad_id: String,
    pub release_id: String,
    pub start_date: String,
    pub deadline: String,
    pub developer: String,
    pub developer_lead: String,
    pub developer_sub_leads: Vec<String>,
    pub sa_ad_lead: String,
    pub sa_ad_sub_leads: Vec<String>,
    pub task_trigger_id: String,
}

#[derive(Debug, Serialize)]
pub struct CreatedIssue {
    pub id: String,
    pub key: String,
    pub self_url: String,
}

#[derive(Debug, Serialize)]
pub struct CreateBatchResult {
    pub issues: Vec<CreatedIssue>,
}

pub async fn discover(
    client: &Client,
    base_url: &str,
    project_key: &str,
    sample_issue_keys: &[String],
    desired_issue_type_names: &[String],
    pat: &str,
) -> Result<JiraDiscovery, String> {
    let base_url = normalize_base_url(base_url)?;
    let project_key = normalize_project_key(project_key)?;

    let server_json = get_json(client, &base_url, "/rest/api/2/serverInfo", pat).await?;
    let user_json = get_json(client, &base_url, "/rest/api/2/myself", pat).await?;
    let project_path = format!("/rest/api/2/project/{}", urlencoding::encode(&project_key));
    let project_json = get_json(client, &base_url, &project_path, pat).await.ok();
    let issue_types_path = format!(
        "/rest/api/2/issue/createmeta/{}/issuetypes",
        urlencoding::encode(&project_key)
    );
    let issue_type_values = get_paged_values(client, &base_url, &issue_types_path, pat).await?;

    let server = ServerSummary {
        base_url: string_at(&server_json, "baseUrl"),
        version: string_at(&server_json, "version"),
        deployment_type: optional_string_at(&server_json, "deploymentType"),
        server_title: string_at(&server_json, "serverTitle"),
    };
    let user = UserSummary {
        username: string_at(&user_json, "name"),
        display_name: string_at(&user_json, "displayName"),
        active: user_json
            .get("active")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };

    let desired_names: Vec<String> = desired_issue_type_names
        .iter()
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
        .collect();

    let mut issue_types = Vec::new();
    for issue_type in issue_type_values {
        let name = string_at(&issue_type, "name");
        if !desired_names.is_empty()
            && !desired_names
                .iter()
                .any(|desired| desired == &name.to_ascii_lowercase())
        {
            continue;
        }

        let id = string_at(&issue_type, "id");
        let fields_path = format!(
            "/rest/api/2/issue/createmeta/{}/issuetypes/{}",
            urlencoding::encode(&project_key),
            urlencoding::encode(&id)
        );
        let mut fields: Vec<FieldMeta> = get_paged_values(client, &base_url, &fields_path, pat)
            .await?
            .into_iter()
            .map(parse_field_meta)
            .collect();
        fields.sort_by(|left, right| {
            right
                .required
                .cmp(&left.required)
                .then_with(|| left.name.cmp(&right.name))
        });

        issue_types.push(IssueTypeDiscovery {
            id,
            name,
            subtask: issue_type
                .get("subtask")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            fields,
        });
    }
    issue_types.sort_by(|left, right| left.name.cmp(&right.name));

    let mut samples = Vec::new();
    for issue_key in sample_issue_keys {
        let issue_key = normalize_issue_key(issue_key)?;
        let issue_path = format!(
            "/rest/api/2/issue/{}?expand=names,schema&fields=*all",
            urlencoding::encode(&issue_key)
        );
        let issue_json = get_json(client, &base_url, &issue_path, pat).await?;
        samples.push(parse_sample_issue(issue_json));
    }

    Ok(JiraDiscovery {
        server,
        user,
        project_key,
        project_name: project_json.and_then(|project| project.get("name").and_then(Value::as_str).map(ToString::to_string)),
        issue_types,
        samples,
    })
}

pub async fn resolve_parent(
    client: &Client,
    base_url: &str,
    project_key: &str,
    issue_key: &str,
    pat: &str,
) -> Result<ParentResolution, String> {
    resolve_parents(client, base_url, project_key, &[issue_key.to_string()], pat).await
}

pub async fn resolve_parents(
    client: &Client,
    base_url: &str,
    project_key: &str,
    issue_keys: &[String],
    pat: &str,
) -> Result<ParentResolution, String> {
    let base_url = normalize_base_url(base_url)?;
    let project_key = normalize_project_key(project_key)?;
    if issue_keys.is_empty() {
        return Err("Enter at least one Epic, Story, Improvement, or Bug.".to_string());
    }

    let normalized_keys = issue_keys
        .iter()
        .map(|issue_key| normalize_issue_key(issue_key))
        .collect::<Result<Vec<_>, _>>()?;
    let mut inputs = Vec::new();
    for issue_key in normalized_keys {
        if !issue_key.starts_with(&format!("{}-", project_key)) {
            return Err(format!("{} is not in project {}.", issue_key, project_key));
        }
        let input_path = format!(
            "/rest/api/2/issue/{}?fields=summary,issuetype,status,customfield_10100",
            urlencoding::encode(&issue_key)
        );
        inputs.push(parse_parent_candidate(
            &get_json(client, &base_url, &input_path, pat).await?,
        ));
    }

    let mut candidates_by_key = HashMap::new();
    for input in &inputs {
        let input_type = input.issue_type.to_ascii_lowercase();
        if input_type == "epic" {
            let children = search_epic_children(client, &base_url, &input.key, pat).await?;
            for mut candidate in children {
                if candidate.source_epic_key.is_none() {
                    candidate.source_epic_key = Some(input.key.clone());
                }
                candidates_by_key.entry(candidate.key.clone()).or_insert(candidate);
            }
        } else if matches!(input_type.as_str(), "story" | "user story" | "improvement" | "bug") {
            candidates_by_key
                .entry(input.key.clone())
                .or_insert_with(|| input.clone());
        } else {
            return Err(format!(
                "{} is a {}. Enter an Epic, Story, User Story, Improvement, or Bug.",
                input.key, input.issue_type
            ));
        }
    }

    let mut candidates = candidates_by_key.into_values().collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(ParentResolution { inputs, candidates })
}

async fn search_epic_children(
    client: &Client,
    base_url: &str,
    epic_key: &str,
    pat: &str,
) -> Result<Vec<ParentCandidate>, String> {
    let jql = format!("\"Epic Link\" = {} ORDER BY key", epic_key);
    let mut start_at = 0_u64;
    let mut values = Vec::new();
    for _ in 0..20 {
        let search_path = format!(
            "/rest/api/2/search?jql={}&fields=summary,issuetype,status,customfield_10100&startAt={}&maxResults=50",
            urlencoding::encode(&jql),
            start_at
        );
        let search_json = get_json(client, base_url, &search_path, pat).await?;
        let issues = search_json
            .get("issues")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let page_length = issues.len() as u64;
        values.extend(issues.iter().map(parse_parent_candidate).filter(|candidate| {
            matches!(
                candidate.issue_type.to_ascii_lowercase().as_str(),
                "story" | "user story" | "improvement"
            )
        }));

        let total = search_json.get("total").and_then(Value::as_u64).unwrap_or(0);
        if page_length == 0 || page_length < 50 || (total > 0 && start_at + page_length >= total) {
            return Ok(values);
        }
        start_at += page_length;
    }
    Err(format!("Jira returned more than 20 pages for Epic {}.", epic_key))
}

pub async fn search_users(
    client: &Client,
    base_url: &str,
    project_key: &str,
    query: &str,
    pat: &str,
) -> Result<Vec<JiraUserOption>, String> {
    let search_term = lookup_term(query);
    if search_term.len() < 2 {
        return Ok(Vec::new());
    }
    let path = format!(
        "/rest/api/2/user/assignable/search?project={}&username={}&maxResults=50",
        urlencoding::encode(project_key),
        urlencoding::encode(&search_term)
    );
    let response = get_json(client, base_url, &path, pat).await?;
    let mut users = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| {
            let username = value
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| value.get("key").and_then(Value::as_str))
                .unwrap_or_default()
                .trim()
                .to_string();
            let display_name = value
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(&username)
                .trim()
                .to_string();
            let active = value.get("active").and_then(Value::as_bool).unwrap_or(true);
            let searchable = format!("{} {}", username, display_name).to_ascii_lowercase();
            (active && searchable.contains(&search_term.to_ascii_lowercase())).then_some(JiraUserOption {
                username,
                display_name,
                active,
            })
        })
        .collect::<Vec<_>>();
    users.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    users.dedup_by(|left, right| left.username == right.username);
    Ok(users)
}

pub async fn search_labels(
    client: &Client,
    base_url: &str,
    _project_key: &str,
    query: &str,
    pat: &str,
) -> Result<Vec<String>, String> {
    let search_term = lookup_term(query).to_ascii_lowercase();
    if search_term.is_empty() {
        return Ok(Vec::new());
    }
    let mut start_at = 0_u64;
    let mut labels = HashSet::new();
    for _ in 0..20 {
        let path = format!(
            "/rest/api/2/label?startAt={}&maxResults=50",
            start_at
        );
        let response = get_json(client, base_url, &path, pat).await?;
        let values = response
            .get("values")
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| response.as_array().cloned())
            .unwrap_or_default();
        let page_length = values.len() as u64;
        for value in values {
            if let Some(label) = value.as_str().map(str::trim).filter(|label| !label.is_empty()) {
                if label.to_ascii_lowercase().contains(&search_term) {
                    labels.insert(label.to_string());
                }
            }
        }
        let is_last = response.get("last").and_then(Value::as_bool).unwrap_or(page_length < 50);
        if is_last || page_length == 0 {
            break;
        }
        start_at += page_length;
    }
    let mut result = labels.into_iter().collect::<Vec<_>>();
    result.sort();
    result.truncate(50);
    Ok(result)
}

fn lookup_term(value: &str) -> String {
    value
        .trim()
        .trim_matches('*')
        .replace('*', "")
        .trim()
        .to_string()
}

pub async fn create_subtasks(
    client: &Client,
    base_url: &str,
    project_key: &str,
    parent_key: &str,
    tickets: Vec<CreateSubtaskInput>,
    pat: &str,
) -> Result<CreateBatchResult, String> {
    let base_url = normalize_base_url(base_url)?;
    let project_key = normalize_project_key(project_key)?;
    let parent_key = normalize_issue_key(parent_key)?;
    if !parent_key.starts_with(&format!("{}-", project_key)) {
        return Err(format!("{} is not in project {}.", parent_key, project_key));
    }
    if tickets.is_empty() || tickets.len() > 4 {
        return Err("Create between 1 and 4 subtasks per request.".to_string());
    }
    let streams = tickets.iter().map(|ticket| ticket.stream.trim().to_ascii_lowercase()).collect::<HashSet<_>>();
    if streams.contains("be") && streams.len() > 1 {
        return Err("Choose either FE or BE mode, not both.".to_string());
    }
    if streams.contains("web") && streams.len() > 1 {
        return Err("Web is a standalone FE mode.".to_string());
    }

    let myself = get_json(client, &base_url, "/rest/api/2/myself", pat).await?;
    let current_username = string_at(&myself, "name");
    if current_username.trim().is_empty() {
        return Err("Jira did not return the authenticated username.".to_string());
    }

    let issue_updates = tickets
        .iter()
        .map(|ticket| build_issue_fields(&project_key, &parent_key, &current_username, ticket))
        .collect::<Result<Vec<_>, _>>()?;
    let body = json!({ "issueUpdates": issue_updates });
    let response = post_json(client, &base_url, "/rest/api/2/issue/bulk", pat, &body).await?;

    let issues = response
        .get("issues")
        .and_then(Value::as_array)
        .ok_or_else(|| "Jira bulk create returned an unexpected response.".to_string())?
        .iter()
        .map(|issue| CreatedIssue {
            id: string_at(issue, "id"),
            key: string_at(issue, "key"),
            self_url: string_at(issue, "self"),
        })
        .collect();
    Ok(CreateBatchResult { issues })
}

fn build_issue_fields(
    project_key: &str,
    parent_key: &str,
    current_username: &str,
    ticket: &CreateSubtaskInput,
) -> Result<Value, String> {
    validate_create_ticket(ticket)?;
    let user = |name: &str| json!({ "name": name.trim() });
    let users = |names: &[String]| {
        Value::Array(names.iter().map(|name| user(name)).collect::<Vec<Value>>())
    };

    let mut fields = Map::new();
    fields.insert("project".to_string(), json!({ "key": project_key }));
    fields.insert("parent".to_string(), json!({ "key": parent_key }));
    fields.insert(
        "issuetype".to_string(),
        json!({ "id": ticket.issue_type_id.trim() }),
    );
    fields.insert(
        "summary".to_string(),
        Value::String(ticket.summary.trim().to_string()),
    );
    fields.insert("labels".to_string(), json!(ticket.labels));
    if !ticket.description.trim().is_empty() {
        fields.insert(
            "description".to_string(),
            Value::String(ticket.description.trim().to_string()),
        );
    }
    if !ticket.confluence_page.trim().is_empty() {
        fields.insert(
            "customfield_20302".to_string(),
            Value::String(ticket.confluence_page.trim().to_string()),
        );
    }
    if let Some(priority_id) = ticket
        .priority_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fields.insert("priority".to_string(), json!({ "id": priority_id }));
    }
    fields.insert(
        "customfield_15313".to_string(),
        json!({ "id": ticket.ad_story_point_id.trim() }),
    );
    if let Some(dev_story_point_id) = ticket
        .dev_story_point_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fields.insert(
            "customfield_15309".to_string(),
            json!({ "id": dev_story_point_id }),
        );
    }
    fields.insert(
        "customfield_11925".to_string(),
        Value::String(ticket.deadline.trim().to_string()),
    );
    fields.insert(
        "customfield_13502".to_string(),
        Value::String(ticket.start_date.trim().to_string()),
    );
    fields.insert("customfield_12410".to_string(), user(&ticket.developer));
    fields.insert(
        "customfield_13505".to_string(),
        user(&ticket.developer_lead),
    );
    fields.insert(
        "customfield_15315".to_string(),
        user(
            ticket
                .developer_sub_leads
                .first()
                .ok_or_else(|| "Developer Sub-Lead is required.".to_string())?,
        ),
    );
    let mut code_reviewers = vec![ticket.developer_lead.clone()];
    code_reviewers.extend(ticket.developer_sub_leads.clone());
    fields.insert("customfield_14905".to_string(), users(&code_reviewers));

    fields.insert("customfield_14302".to_string(), user(current_username));
    fields.insert("customfield_14303".to_string(), user(&ticket.sa_ad_lead));
    fields.insert(
        "customfield_15314".to_string(),
        user(
            ticket
                .sa_ad_sub_leads
                .first()
                .ok_or_else(|| "SA/AD Sub-Lead is required.".to_string())?,
        ),
    );
    let mut design_reviewers = vec![ticket.sa_ad_lead.clone()];
    design_reviewers.extend(ticket.sa_ad_sub_leads.clone());
    fields.insert("customfield_15316".to_string(), users(&design_reviewers));
    fields.insert(
        "customfield_11802".to_string(),
        json!({ "id": ticket.release_id.trim() }),
    );
    fields.insert(
        "customfield_14903".to_string(),
        json!({ "id": ticket.squad_id.trim() }),
    );
    fields.insert(
        "customfield_14304".to_string(),
        json!({ "id": ticket.task_trigger_id.trim() }),
    );
    fields.insert("assignee".to_string(), user(current_username));

    Ok(json!({ "fields": fields }))
}

fn validate_create_ticket(ticket: &CreateSubtaskInput) -> Result<(), String> {
    let stream = ticket.stream.trim().to_ascii_lowercase();
    let required_prefixes = match stream.as_str() {
        "ios" => "[iOS]",
        "android" => "[Android]",
        "web" => "[Web]",
        "be" => "[API]|[Table]|[Service]|[Consumer]|[Batch]",
        _ => return Err("Ticket stream must be ios, android, web, or be.".to_string()),
    };
    let has_required_prefix = required_prefixes
        .split('|')
        .any(|prefix| ticket.summary.trim().starts_with(prefix));
    if !has_required_prefix {
        return Err(format!(
            "{} summary must start with one of {}.",
            stream,
            required_prefixes.replace('|', ", ")
        ));
    }
    let prefix_length = required_prefixes
        .split('|')
        .find(|prefix| ticket.summary.trim().starts_with(prefix))
        .map(str::len)
        .unwrap_or(0);
    if ticket.summary.trim().chars().count() < prefix_length + 2 {
        return Err("Ticket summary is too short.".to_string());
    }

    if ticket.labels.iter().all(|label| label.trim().is_empty()) {
        return Err("At least one label is required.".to_string());
    }

    for (label, value) in [
        ("Issue Type", ticket.issue_type_id.as_str()),
        ("AD Story Point", ticket.ad_story_point_id.as_str()),
        ("Squad", ticket.squad_id.as_str()),
        ("Release Number", ticket.release_id.as_str()),
        ("Developer", ticket.developer.as_str()),
        ("Developer Lead", ticket.developer_lead.as_str()),
        ("SA/AD Lead", ticket.sa_ad_lead.as_str()),
        ("Task Trigger By", ticket.task_trigger_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{} is required.", label));
        }
    }
    if ticket.developer_sub_leads.is_empty() || ticket.sa_ad_sub_leads.is_empty() {
        return Err("Developer Sub-Lead and SA/AD Sub-Lead are required.".to_string());
    }
    if !is_iso_date(&ticket.start_date) || !is_iso_date(&ticket.deadline) {
        return Err("Start Development On and Deadline must use YYYY-MM-DD.".to_string());
    }
    Ok(())
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.trim().as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

fn parse_parent_candidate(value: &Value) -> ParentCandidate {
    let fields = value.get("fields").and_then(Value::as_object);
    ParentCandidate {
        key: string_at(value, "key"),
        summary: fields
            .and_then(|fields| fields.get("summary"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        issue_type: fields
            .and_then(|fields| fields.get("issuetype"))
            .and_then(Value::as_object)
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        status: fields
            .and_then(|fields| fields.get("status"))
            .and_then(Value::as_object)
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        source_epic_key: fields
            .and_then(|fields| fields.get("customfield_10100"))
            .and_then(|value| match value {
                Value::String(key) => Some(key.to_string()),
                Value::Object(object) => object
                    .get("key")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                _ => None,
            }),
    }
}

fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let parsed = Url::parse(trimmed).map_err(|_| "Jira base URL is invalid.".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Jira base URL must use HTTPS.".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("Jira base URL must include a host.".to_string());
    }
    if parsed.scheme() == "http" && !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("Jira base URL must use HTTPS.".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Jira base URL cannot contain a query string or fragment.".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_project_key(project_key: &str) -> Result<String, String> {
    let key = project_key.trim().to_ascii_uppercase();
    if key.is_empty()
        || !key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err("Jira project key is invalid.".to_string());
    }
    Ok(key)
}

fn normalize_issue_key(issue_key: &str) -> Result<String, String> {
    let key = issue_key.trim().to_ascii_uppercase();
    let mut parts = key.split('-');
    let project = parts.next().unwrap_or_default();
    let number = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || project.is_empty()
        || number.is_empty()
        || !project
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        || !number.chars().all(|ch| ch.is_ascii_digit())
    {
        return Err(format!("Invalid Jira issue key: {}", issue_key));
    }
    Ok(key)
}

async fn get_json(client: &Client, base_url: &str, path: &str, pat: &str) -> Result<Value, String> {
    let url = format!("{}{}", base_url, path);
    let response = client
        .get(&url)
        .bearer_auth(pat)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(map_network_error)?;

    let status = response.status();
    if status.is_success() {
        return response
            .json::<Value>()
            .await
            .map_err(|_| format!("Jira returned invalid JSON for {}.", endpoint_label(path)));
    }

    let body = response.text().await.unwrap_or_default();
    Err(map_http_error(status, path, &body))
}

async fn post_json(
    client: &Client,
    base_url: &str,
    path: &str,
    pat: &str,
    body: &Value,
) -> Result<Value, String> {
    let url = format!("{}{}", base_url, path);
    let response = client
        .post(&url)
        .bearer_auth(pat)
        .header("Accept", "application/json")
        .json(body)
        .send()
        .await
        .map_err(map_network_error)?;

    let status = response.status();
    if status.is_success() {
        return response
            .json::<Value>()
            .await
            .map_err(|_| format!("Jira returned invalid JSON for {}.", endpoint_label(path)));
    }
    let response_body = response.text().await.unwrap_or_default();
    Err(map_http_error(status, path, &response_body))
}

async fn get_paged_values(
    client: &Client,
    base_url: &str,
    path: &str,
    pat: &str,
) -> Result<Vec<Value>, String> {
    const PAGE_SIZE: u64 = 50;
    const MAX_PAGES: usize = 20;

    let mut start_at = 0_u64;
    let mut all_values = Vec::new();
    for _ in 0..MAX_PAGES {
        let separator = if path.contains('?') { '&' } else { '?' };
        let page_path = format!(
            "{}{}startAt={}&maxResults={}",
            path, separator, start_at, PAGE_SIZE
        );
        let page = get_json(client, base_url, &page_path, pat).await?;
        let values = page
            .get("values")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let page_length = values.len() as u64;
        all_values.extend(values);

        let is_last = page
            .get("last")
            .and_then(Value::as_bool)
            .unwrap_or(page_length < PAGE_SIZE);
        if is_last || page_length == 0 {
            return Ok(all_values);
        }

        let page_size = page
            .get("size")
            .and_then(Value::as_u64)
            .filter(|size| *size > 0)
            .unwrap_or(page_length);
        start_at += page_size;
    }

    Err(format!(
        "Jira returned more than {} pages for {}. Narrow the discovery scope.",
        MAX_PAGES,
        endpoint_label(path)
    ))
}

fn map_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "Jira request timed out after 30 seconds.".to_string();
    }
    let detail = error.to_string().to_ascii_lowercase();
    if detail.contains("certificate")
        || detail.contains("unknown ca")
        || detail.contains("self signed")
        || detail.contains("tls")
    {
        return "Jira TLS certificate is not trusted. Install the corporate CA in macOS Keychain, or temporarily enable “Allow untrusted Jira certificate” in Settings."
            .to_string();
    }
    if error.is_connect() {
        return "Unable to connect to Jira. Check the URL, VPN, and certificate trust.".to_string();
    }
    "Jira network request failed.".to_string()
}
fn map_http_error(status: StatusCode, path: &str, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED => {
            "Jira authentication failed (401). Replace the PAT in Settings.".to_string()
        }
        StatusCode::FORBIDDEN => format!("Jira denied access (403) to {}.", endpoint_label(path)),
        StatusCode::NOT_FOUND => format!(
            "Jira resource was not found (404) for {}.",
            endpoint_label(path)
        ),
        _ => {
            let detail = extract_error_detail(body);
            if detail.is_empty() {
                format!(
                    "Jira returned HTTP {} for {}.",
                    status.as_u16(),
                    endpoint_label(path)
                )
            } else {
                format!(
                    "Jira returned HTTP {} for {}: {}",
                    status.as_u16(),
                    endpoint_label(path),
                    detail
                )
            }
        }
    }
}

fn endpoint_label(path: &str) -> &str {
    path.split('?').next().unwrap_or(path)
}

fn extract_error_detail(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return String::new();
    };
    if let Some(messages) = value.get("errorMessages").and_then(Value::as_array) {
        let joined = messages
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("; ");
        if !joined.is_empty() {
            return truncate_string(&joined);
        }
    }
    String::new()
}

fn parse_field_meta(value: Value) -> FieldMeta {
    let schema = value.get("schema").and_then(Value::as_object);
    FieldMeta {
        id: value
            .get("fieldId")
            .and_then(Value::as_str)
            .or_else(|| value.get("key").and_then(Value::as_str))
            .unwrap_or_default()
            .to_string(),
        name: string_at(&value, "name"),
        required: value
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        schema_type: schema
            .and_then(|schema| schema.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        schema_items: schema
            .and_then(|schema| schema.get("items"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        custom_type: schema
            .and_then(|schema| schema.get("custom"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        has_default_value: value
            .get("hasDefaultValue")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        default_value: value.get("defaultValue").map(sanitize_value),
        allowed_values: value
            .get("allowedValues")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .take(MAX_ALLOWED_VALUES)
                    .map(sanitize_value)
                    .collect()
            })
            .unwrap_or_default(),
        operations: value
            .get("operations")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn parse_sample_issue(value: Value) -> SampleIssue {
    let fields = value
        .get("fields")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let names = value
        .get("names")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let summary = fields
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let issue_type = fields
        .get("issuetype")
        .and_then(Value::as_object)
        .and_then(|issue_type| issue_type.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let parent_key = fields
        .get("parent")
        .and_then(Value::as_object)
        .and_then(|parent| parent.get("key"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let mut populated_fields = fields
        .into_iter()
        .filter(|(id, field_value)| {
            !EXCLUDED_SAMPLE_FIELDS.contains(&id.as_str())
                && !is_empty_value(field_value)
                && id != "summary"
                && id != "issuetype"
        })
        .map(|(id, field_value)| PopulatedField {
            name: names
                .get(&id)
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string(),
            id,
            value: sanitize_value(&field_value),
        })
        .collect::<Vec<_>>();
    populated_fields.sort_by(|left, right| left.name.cmp(&right.name));

    SampleIssue {
        key: string_at(&value, "key"),
        summary,
        issue_type,
        parent_key,
        populated_fields,
    }
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(value) => value.trim().is_empty(),
        Value::Array(value) => value.is_empty(),
        Value::Object(value) => value.is_empty(),
        _ => false,
    }
}

fn sanitize_value(value: &Value) -> Value {
    match value {
        Value::String(value) => Value::String(truncate_string(value)),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(MAX_PREVIEW_ARRAY_ITEMS)
                .map(sanitize_value)
                .collect(),
        ),
        Value::Object(object) => sanitize_object(object),
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
    }
}

fn sanitize_object(object: &Map<String, Value>) -> Value {
    const PREFERRED_KEYS: &[&str] = &["id", "key", "name", "value", "displayName"];
    let mut sanitized = Map::new();
    for key in PREFERRED_KEYS {
        if let Some(value) = object.get(*key) {
            sanitized.insert((*key).to_string(), sanitize_value(value));
        }
    }
    if sanitized.is_empty() {
        for (key, value) in object.iter().take(5) {
            if !matches!(key.as_str(), "self" | "avatarUrls" | "emailAddress") {
                sanitized.insert(key.clone(), sanitize_value(value));
            }
        }
    }
    Value::Object(sanitized)
}

fn truncate_string(value: &str) -> String {
    if value.chars().count() <= MAX_PREVIEW_STRING_LENGTH {
        return value.to_string();
    }
    let truncated: String = value.chars().take(MAX_PREVIEW_STRING_LENGTH).collect();
    format!("{}…", truncated)
}

fn string_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional_string_at(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    fn client() -> Client {
        Client::builder().build().unwrap()
    }

    #[tokio::test]
    async fn discovery_collects_metadata_and_sanitizes_samples() {
        let server = MockServer::start();
        let auth = "Bearer test-pat";

        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/serverInfo")
                .header("authorization", auth);
            then.status(200).json_body(serde_json::json!({
              "baseUrl": server.base_url(),
              "version": "9.17.3",
              "deploymentType": "Data Center",
              "serverTitle": "Jira Test"
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/myself")
                .header("authorization", auth);
            then.status(200).json_body(serde_json::json!({
              "name": "developer",
              "displayName": "Developer",
              "active": true
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/issue/createmeta/EVDEV/issuetypes")
                .query_param("startAt", "0")
                .query_param("maxResults", "50");
            then.status(200).json_body(serde_json::json!({
              "last": true,
              "size": 1,
              "values": [{"id": "10100", "name": "BE-Sub-Task", "subtask": true}]
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/issue/createmeta/EVDEV/issuetypes/10100")
                .query_param("startAt", "0")
                .query_param("maxResults", "50");
            then.status(200).json_body(serde_json::json!({
              "last": true,
              "size": 1,
              "values": [{
                "fieldId": "summary",
                "name": "Summary",
                "required": true,
                "schema": {"type": "string"},
                "operations": ["set"]
              }]
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/issue/EVDEV-1")
                .query_param("expand", "names,schema")
                .query_param("fields", "*all");
            then.status(200).json_body(serde_json::json!({
        "key": "EVDEV-1",
        "names": {"summary": "Summary", "description": "Description", "customfield_1": "Platform"},
        "fields": {
          "summary": "Build API",
          "description": "must not be returned",
          "issuetype": {"name": "BE-Sub-Task"},
          "customfield_1": {"id": "10", "value": "Backend"}
        }
      }));
        });

        let result = discover(
            &client(),
            &server.base_url(),
            "evdev",
            &["EVDEV-1".to_string()],
            &["BE-Sub-Task".to_string()],
            "test-pat",
        )
        .await
        .unwrap();

        assert_eq!(result.server.version, "9.17.3");
        assert_eq!(result.issue_types[0].fields[0].id, "summary");
        assert_eq!(result.samples[0].populated_fields.len(), 1);
        assert_eq!(result.samples[0].populated_fields[0].name, "Platform");
    }

    #[tokio::test]
    async fn resolves_a_story_as_a_direct_parent() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/issue/EVDEV-42")
                .query_param("fields", "summary,issuetype,status,customfield_10100");
            then.status(200).json_body(json!({
              "key": "EVDEV-42",
              "fields": {
                "summary": "A user story",
                "issuetype": {"name": "Story"},
                "status": {"name": "Open"}
              }
            }));
        });

        let result = resolve_parent(
            &client(),
            &server.base_url(),
            "EVDEV",
            "EVDEV-42",
            "test-pat",
        )
        .await
        .unwrap();
        assert_eq!(result.inputs[0].issue_type, "Story");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].key, "EVDEV-42");
    }

    #[tokio::test]
    async fn user_lookup_filters_inactive_users_and_supports_wildcards() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/user/assignable/search")
                .query_param("project", "EVDEV")
                .query_param("username", "alice")
                .query_param("maxResults", "50");
            then.status(200).json_body(json!([
              {"name": "alice", "displayName": "Alice AD", "active": true},
              {"name": "alice-old", "displayName": "Alice Old", "active": false},
              {"name": "bob", "displayName": "Bob", "active": true}
            ]));
        });

        let users = search_users(&client(), &server.base_url(), "EVDEV", "*alice*", "test-pat")
            .await
            .unwrap();
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].username, "alice");
    }

    #[tokio::test]
    async fn label_lookup_returns_matching_labels() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/label")
                .query_param("startAt", "0")
                .query_param("maxResults", "50");
            then.status(200).json_body(json!({
              "last": true,
              "values": ["feature_name", "beta_2", "other"]
            }));
        });

        let labels = search_labels(&client(), &server.base_url(), "EVDEV", "*feature*", "test-pat")
            .await
            .unwrap();
        assert_eq!(labels, vec!["feature_name"]);
    }

    #[tokio::test]
    async fn epic_lookup_merges_children_and_preserves_source_epic() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/issue/EVDEV-1")
                .query_param("fields", "summary,issuetype,status,customfield_10100");
            then.status(200).json_body(json!({
              "key": "EVDEV-1",
              "fields": {
                "summary": "Payments",
                "issuetype": {"name": "Epic"},
                "status": {"name": "Open"}
              }
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/2/search")
                .query_param("jql", "\"Epic Link\" = EVDEV-1 ORDER BY key")
                .query_param("fields", "summary,issuetype,status,customfield_10100")
                .query_param("startAt", "0")
                .query_param("maxResults", "50");
            then.status(200).json_body(json!({
              "total": 1,
              "issues": [{
                "key": "EVDEV-2",
                "fields": {
                  "summary": "Redeem flow",
                  "issuetype": {"name": "Story"},
                  "status": {"name": "Open"},
                  "customfield_10100": {"key": "EVDEV-1"}
                }
              }]
            }));
        });

        let result = resolve_parents(
            &client(),
            &server.base_url(),
            "EVDEV",
            &["EVDEV-1".to_string()],
            "test-pat",
        )
        .await
        .unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_epic_key.as_deref(), Some("EVDEV-1"));
    }

    #[test]
    fn rejects_non_https_remote_urls() {
        assert!(normalize_base_url("http://jira.example.com").is_err());
        assert!(normalize_base_url("https://jira.example.com/").is_ok());
    }

    #[test]
    fn builds_a_guarded_subtask_payload() {
        let ticket = CreateSubtaskInput {
            issue_type_id: "10901".to_string(),
            stream: "ios".to_string(),
            summary: "[iOS] Mobile Screen X".to_string(),
            labels: vec!["ad_dev_task".to_string(), "fe_ios".to_string()],
            description: "A short description".to_string(),
            confluence_page: "https://confluence.example/page".to_string(),
            priority_id: Some("4".to_string()),
            ad_story_point_id: "16787".to_string(),
            dev_story_point_id: None,
            squad_id: "20829".to_string(),
            release_id: "24303".to_string(),
            start_date: "2026-07-27".to_string(),
            deadline: "2026-07-30".to_string(),
            developer: "developer".to_string(),
            developer_lead: "dev-lead".to_string(),
            developer_sub_leads: vec!["dev-sub-lead".to_string()],
            sa_ad_lead: "ad-lead".to_string(),
            sa_ad_sub_leads: vec!["ad-sub-lead".to_string()],
            task_trigger_id: "15426".to_string(),
        };

        let payload = build_issue_fields("EVDEV", "EVDEV-350436", "current-user", &ticket).unwrap();
        let fields = payload.get("fields").unwrap();
        assert_eq!(fields["parent"]["key"], "EVDEV-350436");
        assert_eq!(fields["assignee"]["name"], "current-user");
        assert_eq!(fields["customfield_14302"]["name"], "current-user");
        assert_eq!(fields["customfield_14905"].as_array().unwrap().len(), 2);
        assert_eq!(fields["description"], "A short description");
        assert_eq!(fields["customfield_20302"], "https://confluence.example/page");
        assert!(fields.get("customfield_15309").is_none());

        let mut web_ticket = ticket;
        web_ticket.stream = "web".to_string();
        web_ticket.summary = "[Web] Dashboard Screen".to_string();
        web_ticket.labels = vec!["ad_dev_task".to_string(), "fe_web".to_string()];
        assert!(validate_create_ticket(&web_ticket).is_ok());
    }

    #[test]
    fn rejects_empty_labels() {
        let ticket = CreateSubtaskInput {
            issue_type_id: "10901".to_string(),
            stream: "android".to_string(),
            summary: "[Android] Mobile Screen X".to_string(),
            labels: vec![],
            description: String::new(),
            confluence_page: String::new(),
            priority_id: None,
            ad_story_point_id: "16787".to_string(),
            dev_story_point_id: None,
            squad_id: "20829".to_string(),
            release_id: "24303".to_string(),
            start_date: "2026-07-27".to_string(),
            deadline: "2026-07-30".to_string(),
            developer: "developer".to_string(),
            developer_lead: "dev-lead".to_string(),
            developer_sub_leads: vec!["dev-sub-lead".to_string()],
            sa_ad_lead: "ad-lead".to_string(),
            sa_ad_sub_leads: vec!["ad-sub-lead".to_string()],
            task_trigger_id: "15426".to_string(),
        };
        assert!(validate_create_ticket(&ticket)
            .unwrap_err()
            .contains("At least one label"));
    }
}
