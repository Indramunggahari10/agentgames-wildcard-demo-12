// Steal-the-VFY Match Reconstructor — tiny zero-dependency HTTP server.
//
// Serves the UI plus a JSON API. Nothing is persisted and no request body
// is logged: pasted match sequences are replayed in memory and discarded.
// Only method, path, status, and a coarse duration are written to stdout.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RULES } from "./src/rules.js";
import { EXAMPLES } from "./src/examples.js";
import {
  SERVICE_NAME,
  SERVICE_VERSION,
  ValidationError,
  reconstructMatch,
} from "./src/reconstructor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const BODY_LIMIT = 64 * 1024;

const HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function jsonReply(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function fileReply(res, status, mime, body) {
  res.writeHead(status, { ...HEADERS, "content-type": mime });
  res.end(body);
}

// Reads the request body up to BODY_LIMIT bytes. Anything larger is
// reported as oversized without being buffered in full.
function collectBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let oversized = false;
    const parts = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        oversized = true;
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () =>
      resolve({ oversized, text: Buffer.concat(parts).toString("utf8") }),
    );
    req.on("error", reject);
  });
}

async function handleCheck(req, res) {
  const { oversized, text } = await collectBody(req);
  if (oversized) {
    jsonReply(res, 413, { error: "Body exceeds the 64 KiB limit." });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    jsonReply(res, 400, { error: "Body is not valid JSON." });
    return;
  }
  try {
    jsonReply(res, 200, reconstructMatch(payload));
  } catch (err) {
    if (err instanceof ValidationError) {
      jsonReply(res, 400, { error: err.message });
      return;
    }
    throw err;
  }
}

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

export function buildServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
        jsonReply(res, 200, { service: SERVICE_NAME, version: SERVICE_VERSION, status: "ok" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/examples") {
        jsonReply(res, 200, { count: EXAMPLES.length, examples: EXAMPLES });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        jsonReply(res, 200, { count: RULES.length, rules: RULES });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/check") {
        await handleCheck(req, res);
        return;
      }
      const staticFile = STATIC_FILES[url.pathname];
      if (req.method === "GET" && staticFile) {
        const body = await readFile(path.join(PUBLIC, staticFile[0]), "utf8");
        fileReply(res, 200, staticFile[1], body);
        return;
      }
      jsonReply(res, 404, { error: "Not found." });
    } catch (err) {
      console.error("request failed:", err && err.message ? err.message : err);
      if (!res.headersSent) {
        jsonReply(res, 500, { error: "Internal error." });
      } else {
        res.destroy();
      }
    } finally {
      console.log(
        `${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - startedAt}ms`,
      );
    }
  });
}

// Default export: Vercel's Node.js runtime requires the server entrypoint's
// default export to be a function or a server. Exporting the created server
// lets Vercel route requests through it; running `node server.js` directly
// still listens on $PORT as before.
const server = buildServer();
export default server;

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`${SERVICE_NAME} ${SERVICE_VERSION} listening on ${port}`);
  });
}
