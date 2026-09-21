import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 100_000) throw new Error("Request is too large.");
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Request body must be valid JSON."); }
}

async function analyze(input) {
  const provider = (process.env.AI_PROVIDER || "").toLowerCase();
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) throw Object.assign(new Error("question is required"), { status: 400 });
  const evidence = input.evidence ? JSON.stringify(input.evidence) : "No evidence point selected.";
  const prompt = `You are an OSINT analysis assistant. Be explicit about uncertainty and do not invent facts.\nEvidence:\n${evidence}\nQuestion: ${question}`;
  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) throw Object.assign(new Error("AI_PROVIDER=xai requires XAI_API_KEY."), { status: 503 });
    const response = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { "authorization": `Bearer ${process.env.XAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.XAI_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.2 }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.message || `xAI request failed (${response.status}).`), { status: 502 });
    return data.choices?.[0]?.message?.content || (() => { throw Object.assign(new Error("xAI returned no analysis text."), { status: 502 }); })();
  }
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY."), { status: 503 });
    if (!process.env.ANTHROPIC_MODEL) throw Object.assign(new Error("ANTHROPIC_MODEL is required when using Anthropic."), { status: 503 });
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.message || `Anthropic request failed (${response.status}).`), { status: 502 });
    return data.content?.filter(x => x.type === "text").map(x => x.text).join("\n") || (() => { throw Object.assign(new Error("Anthropic returned no analysis text."), { status: 502 }); })();
  }
  throw Object.assign(new Error("AI is not configured. Set AI_PROVIDER to xai or anthropic; map and evidence features do not require a key."), { status: 503 });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "POST" && url.pathname === "/api/analyze") return json(res, 200, { text: await analyze(await body(req)) });
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (requested.includes("..") || requested.includes("/") || requested.includes("\\")) return json(res, 400, { error: "Invalid path." });
    const content = await readFile(path.join(root, requested));
    const type = requested.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "content-type": type }); res.end(content);
  } catch (error) {
    json(res, error.status || 404, { error: error.message || "Not found." });
  }
});
server.listen(port, () => console.log(`Intel Prime listening on http://localhost:${port}`));
