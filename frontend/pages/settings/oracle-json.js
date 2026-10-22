const ALLOWED_FIELDS = new Set(["name", "address", "username", "password"]);

export function buildOracleJsonPlan(text, connections, usernames) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    // JSON parser errors can include fragments of an entered password.
    throw new Error("Invalid JSON. Check commas, quotes, and brackets.");
  }
  const rows = Array.isArray(document) ? document : [document];
  const names = new Set();
  const entries = rows.map((row, index) => {
    const fail = (message) => {
      throw new Error(`Connection ${index + 1}: ${message}`);
    };
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("use an object with name, address, and username.");
    if (Object.keys(row).some((key) => !ALLOWED_FIELDS.has(key))) fail("use only name, address, username, and password.");
    if (typeof row.name !== "string" || !row.name.trim()) fail("enter a connection name.");
    const name = row.name.trim();
    if (names.has(name)) fail("duplicate name. Give each connection a unique name.");
    names.add(name);
    if (typeof row.address !== "string" || !row.address.trim()) fail("enter a database address.");
    const address = row.address.trim();
    const existing = connections.find((connection) => connection.name === name);
    if (row.username !== undefined && (typeof row.username !== "string" || !row.username.trim())) fail("enter a username.");
    const username = row.username?.trim() ?? usernames.get(name);
    if (!username) fail("enter a username.");
    if (Object.hasOwn(row, "password") && (typeof row.password !== "string" || !row.password.length)) {
      fail("enter a non-empty password, or omit password to keep the saved one.");
    }
    if (!existing && !row.password) fail("a new connection needs a password.");
    const credentialsChanged = row.password !== undefined || (existing && username !== usernames.get(name));
    const change = !existing ? "added" : address !== existing.connect_string || credentialsChanged ? "updated" : "unchanged";
    return { name, address, username, password: row.password, credentialsChanged, change };
  });
  const summary = { added: 0, updated: 0, unchanged: connections.filter((connection) => !names.has(connection.name)).length };
  for (const entry of entries) summary[entry.change] += 1;
  return { entries, summary, snapshot: JSON.stringify(connections) };
}

export async function applyOracleJsonPlan(plan, { getConnections, setConnections, setCredentials }) {
  if (JSON.stringify(getConnections()) !== plan.snapshot) {
    throw new Error("Saved connections changed. Generate a new preview before applying.");
  }
  let applied = 0;
  let connections = getConnections().map((connection) => ({ ...connection }));
  for (const entry of plan.entries) {
    if (entry.change === "unchanged") continue;
    try {
      if (entry.change === "added" || entry.credentialsChanged) {
        // The existing native command treats an empty password as retain-saved-password.
        await setCredentials(entry.name, entry.username, entry.password ?? "");
      }
      const profile = { name: entry.name, connect_string: entry.address };
      const index = connections.findIndex((connection) => connection.name === entry.name);
      if (index < 0) connections.push(profile);
      else connections[index] = profile;
      setConnections(connections.map((connection) => ({ ...connection })));
      if (JSON.stringify(getConnections()) !== JSON.stringify(connections)) throw new Error("Storage failed");
      applied += 1;
    } catch {
      throw new Error(
        `${applied} connection${applied === 1 ? "" : "s"} applied. Could not finish saving. ` +
          "Some credentials may already be saved. Review connections and preview again before retrying.",
      );
    }
  }
  return applied;
}
