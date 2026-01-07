from dotenv import load_dotenv
from bs4 import BeautifulSoup
import urllib.parse as up
import os
import re
import sys
import json
import requests
from requests.packages.urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)

_CAMEL_RE = re.compile(r"^[a-z]+(?:[A-Z][a-zA-Z0-9]*)+$")
_KEYWORDS = {"localization", "localization key", "lockey", "lockeys"}


def rest_get(base: str, endpoint: str, token: str, insecure: bool = False, **params):
    headers = {"Authorization": f"Bearer {token}"}
    last_resp = None
    for prefix in ("/wiki", ""):
        url = f"{base}{prefix}{endpoint}"
        try:
            resp = requests.get(url, headers=headers,
                                params=params, verify=not insecure, timeout=30)
        except requests.RequestException as e:
            last_resp = e
            continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 401:
            sys.exit("❌  Unauthorized. Check PAT or permissions.")
        last_resp = resp
    sys.exit(
        f"❌  API request failed: {getattr(last_resp, 'status_code', '')} {getattr(last_resp, 'text', str(last_resp))[:120]}")


def get_page_content(base: str, page_id: str, token: str, insecure: bool = False) -> (str, str):
    # Returns (title, html)
    data = rest_get(
        base, f"/rest/api/content/{page_id}", token, insecure, expand="body.view")
    return data.get("title", ""), data.get("body", {}).get("view", {}).get("value", "")


def resolve_id_by_display(base: str, path: str, token: str, insecure: bool = False) -> (str, str):
    m = re.match(r"/display/([^/]+)/(.+)", path)
    if not m:
        sys.exit("❌ URL invalid for display format.")
    space = m.group(1)
    title = up.unquote(m.group(2)).replace("+", " ")
    data = rest_get(base, "/rest/api/content", token, insecure,
                    spaceKey=space, title=title, expand="body.view")
    try:
        page = data["results"][0]
        return page.get("title", ""), page.get("body", {}).get("view", {}).get("value", "")
    except:
        sys.exit("❌ Page not found.")


def is_camel(text: str) -> bool:
    return bool(_CAMEL_RE.match(text))


def sanitize_filename(name: str) -> str:
    name = name.strip().replace(' ', '_')
    return re.sub(r'[^\w\-_.]', '', name)


def grab_lockeys(html: str):
    soup = BeautifulSoup(html, "html.parser")
    active, inactive = [], []
    for tbl in soup.select("table.confluenceTable"):
        headers = [th.get_text(strip=True).lower()
                   for th in tbl.select("th.confluenceTh")]
        try:
            col = next(i for i, h in enumerate(headers)
                       if any(k in h for k in _KEYWORDS))
        except StopIteration:
            continue
        for row in tbl.select("tr")[1:]:
            cells = row.select("td.confluenceTd")
            if col >= len(cells):
                continue
            for p in (cells[col].find_all("p") or [cells[col]]):
                txt = p.get_text(strip=True)
                if not txt or (txt.startswith("__") and txt.endswith("__")):
                    continue
                if not is_camel(txt):
                    continue
                if p.find("s"):
                    if txt not in inactive:
                        inactive.append(txt)
                else:
                    if txt not in active:
                        active.append(txt)
    return active, inactive


def main():
    load_dotenv()
    token = os.getenv("PAT")
    if not token:
        print("❌ PAT missing in .env.")
        sys.exit(1)

    url = input("Page URL: ").strip()
    insecure = input("Skip TLS? [y/N]: ").strip().lower() == 'y'
    parsed = up.urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    qs = {k.lower(): v for k, v in up.parse_qs(parsed.query).items()}
    pid = qs.get('pageid', [None])[0]
    if not pid:
        m = re.search(r"/(\d{3,})(?:/|$)", parsed.path)
        pid = m.group(1) if m else None

    if pid:
        title, html = get_page_content(base, pid, token, insecure)
    else:
        title, html = resolve_id_by_display(base, parsed.path, token, insecure)

    active, inactive = grab_lockeys(html)

    env_choice = input(
        "Environment (uat1, uat2, uat3, ak)? [uat1]: ").strip().lower() or 'uat1'
    env_url = os.getenv(env_choice.upper())
    if not env_url:
        print(f"❌ {env_choice.upper()} URL missing in .env.")
        sys.exit(1)
    try:
        resp = requests.get(env_url, verify=not insecure, timeout=30)
        resp.raise_for_status()
        env_json = resp.json()
    except Exception as e:
        sys.exit(f"❌ Failed to fetch env JSON: {e}")

    content_keys = env_json.get("content", {}).get("id", {})
    found_active = [k for k in active if k in content_keys]
    not_found_active = [k for k in active if k not in content_keys]

    result = {
        "active": {
            "environment": env_choice,
            "found": {"lockey": found_active, "count": len(found_active)},
            "notFound": {"lockey": not_found_active, "count": len(not_found_active)}
        },
        "replaced": {"lockey": inactive, "count": len(inactive)}
    }

    filename = f"{sanitize_filename(title) or 'output'}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"✅ Saved comparison to {filename}")


if __name__ == "__main__":
    main()
