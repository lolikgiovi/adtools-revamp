// Local-only API fixture; echoes synthetic test inputs rather than executing Velocity.
// Run: node frontend/tools/velocity-template/tests/validator-fixture.cjs
const http = require("node:http");

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:1234");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
  let body = "";
  for await (const chunk of request) body += chunk;
  const contentType = request.headers["content-type"];
  let payload;
  try {
    if (contentType === "application/json") payload = JSON.parse(body);
    else if (contentType === "application/x-www-form-urlencoded") {
      const fields = new URLSearchParams(body);
      payload = { context: JSON.parse(fields.get("context")), template: fields.get("template") };
    } else throw new Error("Unexpected Content-Type");
    if (!payload.context || typeof payload.context !== "object" || typeof payload.template !== "string") {
      throw new Error("Expected context object and template string");
    }
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain" }); response.end(error.message); return;
  }
  console.log(`POST ${request.url} ${contentType}`);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/503") {
    response.writeHead(503); response.end(JSON.stringify({ error: "Fixture service unavailable" })); return;
  }
  if (request.url === "/422") {
    response.writeHead(422); response.end(JSON.stringify({ error: "Fixture template error", line: 1 })); return;
  }
  if (request.url === "/slow") await new Promise((resolve) => setTimeout(resolve, 3000));
  response.end(JSON.stringify({ fixture: true, contentType, received: payload }));
});
server.listen(4321, "127.0.0.1", () => console.log("Validator fixture: http://127.0.0.1:4321/velocity (also /503, /422, /slow)"));
