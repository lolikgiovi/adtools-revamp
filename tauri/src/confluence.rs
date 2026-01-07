// Confluence API integration module
// Handles authentication and REST API calls to Confluence Data Center

use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Page information returned from Confluence search
#[derive(Debug, Serialize, Deserialize)]
pub struct PageInfo {
    pub id: String,
    pub title: String,
    pub space_key: Option<String>,
}

/// Page content returned from fetch
#[derive(Debug, Serialize, Deserialize)]
pub struct PageContent {
    pub id: String,
    pub title: String,
    pub html: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ContentResponse {
    id: String,
    title: String,
    body: Option<BodyWrapper>,
}

#[derive(Debug, Deserialize)]
struct BodyWrapper {
    storage: Option<StorageValue>,
}

#[derive(Debug, Deserialize)]
struct StorageValue {
    value: String,
}

/// Search results response
#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchResult>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    content: Option<SearchContent>,
}

#[derive(Debug, Deserialize)]
struct SearchContent {
    id: String,
    title: String,
    #[serde(rename = "_expandable")]
    expandable: Option<Expandable>,
}

#[derive(Debug, Deserialize)]
struct Expandable {
    space: Option<String>,
}

/// Fetch page content from Confluence
/// Returns the page ID, title, and HTML body storage content
pub async fn fetch_page_content(
    client: &Client,
    domain: &str,
    page_id: &str,
    _username: &str,
    pat: &str,
) -> Result<PageContent, String> {
    let url = format!(
        "{}/rest/api/content/{}?expand=body.storage",
        domain.trim_end_matches('/'),
        page_id
    );

    let response = client
        .get(&url)
        .bearer_auth(pat)
        .header("X-Atlassian-Token", "no-check")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Request timed out after 30 seconds".to_string()
            } else if e.is_connect() {
                format!("Connection error: Unable to connect to Confluence. Check the URL and network.")
            } else {
                format!("Network error: {}", e)
            }
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Authentication failed (401): Invalid or expired PAT. Please update your Confluence credentials in Settings.".to_string());
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err("Access denied (403): You don't have permission to view this page.".to_string());
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("Page not found (404): Check the page ID.".to_string());
    }
    if !status.is_success() {
        let reason = status.canonical_reason().unwrap_or("Unknown");
        return Err(format!("HTTP {}: {}", status.as_u16(), reason));
    }

    let content: ContentResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let body_html = content
        .body
        .and_then(|b| b.storage)
        .map(|s| s.value)
        .unwrap_or_default();

    Ok(PageContent {
        id: content.id,
        title: content.title,
        html: body_html,
    })
}

/// Content list response for spaceKey+title lookup
#[derive(Debug, Deserialize)]
struct ContentListResponse {
    results: Vec<ContentResponse>,
}

/// Fetch page by space key and title (direct lookup)
/// Uses /rest/api/content?spaceKey=X&title=Y like the Python proof of concept
pub async fn fetch_page_by_space_title(
    client: &Client,
    domain: &str,
    space_key: &str,
    title: &str,
    _username: &str,
    pat: &str,
) -> Result<PageContent, String> {
    // Try with and without /wiki prefix (like Python PoC)
    let mut last_status: Option<reqwest::StatusCode> = None;
    
    for prefix in ["/wiki", ""].iter() {
        let url = format!(
            "{}{}/rest/api/content?spaceKey={}&title={}&expand=body.storage",
            domain.trim_end_matches('/'),
            prefix,
            urlencoding::encode(space_key),
            urlencoding::encode(title)
        );

        let response = match client
            .get(&url)
            .bearer_auth(pat)
            .header("X-Atlassian-Token", "no-check")
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => continue, // Try next prefix
        };

        let status = response.status();
        last_status = Some(status);
        
        // Handle auth errors immediately - don't try other prefixes
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Authentication failed (401): Invalid or expired PAT. Please update your Confluence credentials in Settings.".to_string());
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err("Access denied (403): You don't have permission to access this page.".to_string());
        }

        if !status.is_success() {
            continue; // Try next prefix for other errors
        }

        let content_list: ContentListResponse = match response.json().await {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Some(page) = content_list.results.into_iter().next() {
            let body_html = page
                .body
                .and_then(|b| b.storage)
                .map(|s| s.value)
                .unwrap_or_default();

            return Ok(PageContent {
                id: page.id,
                title: page.title,
                html: body_html,
            });
        }
    }

    // Provide more specific error based on last status
    match last_status {
        Some(status) if status == reqwest::StatusCode::NOT_FOUND => {
            Err(format!("Page '{}' not found in space '{}' (404). This could also indicate an authentication issue - please verify your PAT is correct.", title, space_key))
        }
        Some(status) if status.is_success() => {
            // Got 200 OK but page not in results - genuine "not found"
            Err(format!("Page '{}' not found in space '{}'", title, space_key))
        }
        Some(status) => {
            Err(format!("Failed to fetch page '{}' in space '{}': HTTP {} {}", 
                title, space_key, status.as_u16(), status.canonical_reason().unwrap_or("Unknown")))
        }
        None => {
            Err(format!("Could not connect to Confluence to fetch page '{}' in space '{}'", title, space_key))
        }
    }
}

/// Search for pages in Confluence
/// Uses CQL (Confluence Query Language) to search by title
pub async fn search_pages(
    client: &Client,
    domain: &str,
    query: &str,
    _username: &str,
    pat: &str,
) -> Result<Vec<PageInfo>, String> {
    // CQL search for pages containing the query in title
    let cql = format!("type=page AND title~\"{}\"", query);
    let url = format!(
        "{}/rest/api/content/search?cql={}&limit=20",
        domain.trim_end_matches('/'),
        urlencoding::encode(&cql)
    );

    let response = client
        .get(&url)
        .bearer_auth(pat)
        .header("X-Atlassian-Token", "no-check")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Authentication failed: Invalid username or PAT".to_string());
    }
    if !status.is_success() {
        let reason = status.canonical_reason().unwrap_or("Unknown");
        return Err(format!("HTTP {}: {}", status.as_u16(), reason));
    }

    let search_response: SearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse search results: {}", e))?;

    let pages: Vec<PageInfo> = search_response
        .results
        .into_iter()
        .filter_map(|r| r.content)
        .map(|c| {
            let space_key = c.expandable.and_then(|e| {
                e.space.and_then(|s| {
                    // Extract space key from path like "/rest/api/space/SPACEKEY"
                    s.split('/').last().map(|k| k.to_string())
                })
            });
            PageInfo {
                id: c.id,
                title: c.title,
                space_key,
            }
        })
        .collect();

    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    fn client() -> Client {
        Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn fetch_page_content_returns_body_html() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/content/12345")
                .query_param("expand", "body.storage");
            then.status(200).json_body(serde_json::json!({
                "id": "12345",
                "title": "Test Page",
                "body": {
                    "storage": {
                        "value": "<table><tr><td>Lockey</td></tr></table>"
                    }
                }
            }));
        });

        let result = fetch_page_content(
            &client(),
            &server.base_url(),
            "12345",
            "user",
            "pat123",
        )
        .await
        .unwrap();

        assert_eq!(result.id, "12345");
        assert_eq!(result.title, "Test Page");
        assert!(result.html.contains("<table>"));
    }

    #[tokio::test]
    async fn fetch_page_content_handles_401() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET).path_contains("/rest/api/content/");
            then.status(401);
        });

        let result = fetch_page_content(
            &client(),
            &server.base_url(),
            "12345",
            "user",
            "bad_pat",
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Authentication failed"));
    }

    #[tokio::test]
    async fn fetch_page_content_handles_404() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET).path_contains("/rest/api/content/");
            then.status(404);
        });

        let result = fetch_page_content(
            &client(),
            &server.base_url(),
            "99999",
            "user",
            "pat123",
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Page not found"));
    }

    #[tokio::test]
    async fn search_pages_returns_results() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET).path("/rest/api/content/search");
            then.status(200).json_body(serde_json::json!({
                "results": [
                    {
                        "content": {
                            "id": "111",
                            "title": "Page One",
                            "_expandable": {
                                "space": "/rest/api/space/PROJ"
                            }
                        }
                    },
                    {
                        "content": {
                            "id": "222",
                            "title": "Page Two",
                            "_expandable": {}
                        }
                    }
                ]
            }));
        });

        let result = search_pages(
            &client(),
            &server.base_url(),
            "test",
            "user",
            "pat123",
        )
        .await
        .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "111");
        assert_eq!(result[0].title, "Page One");
        assert_eq!(result[0].space_key, Some("PROJ".to_string()));
        assert_eq!(result[1].space_key, None);
    }

    #[tokio::test]
    async fn fetch_page_by_space_title_returns_content() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET)
                .path("/rest/api/content")
                .query_param("spaceKey", "EV")
                .query_param("title", "Test Page Title")
                .query_param("expand", "body.storage");
            then.status(200).json_body(serde_json::json!({
                "results": [{
                    "id": "12345",
                    "title": "Test Page Title",
                    "body": {
                        "storage": {
                            "value": "<table><tr><td>lockey</td></tr></table>"
                        }
                    }
                }]
            }));
        });

        let result = fetch_page_by_space_title(
            &client(),
            &server.base_url(),
            "EV",
            "Test Page Title",
            "user",
            "pat123",
        )
        .await
        .unwrap();

        assert_eq!(result.id, "12345");
        assert_eq!(result.title, "Test Page Title");
        assert!(result.html.contains("<table>"));
    }

    #[tokio::test]
    async fn fetch_page_by_space_title_handles_not_found() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET).path("/rest/api/content");
            then.status(200).json_body(serde_json::json!({
                "results": []
            }));
        });

        let result = fetch_page_by_space_title(
            &client(),
            &server.base_url(),
            "EV",
            "Non Existent Page",
            "user",
            "pat123",
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn fetch_page_by_space_title_handles_401() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(GET).path("/wiki/rest/api/content");
            then.status(401);
        });

        let result = fetch_page_by_space_title(
            &client(),
            &server.base_url(),
            "EV",
            "Test Page",
            "user",
            "bad_pat",
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("401"));
        assert!(err.contains("Authentication failed"));
    }
}
