/**
 * Tiny static server for the built Pixi replay frontend.
 * Usage: npm run frontend:build && npm run frontend:serve
 * Open http://127.0.0.1:5177/
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "dist");
const port = Number(process.env.PORT ?? 5177);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".map": "application/json; charset=utf-8",
};

const server = createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0] || "/";
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = join(root, rel);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AI-town replay UI: http://127.0.0.1:${port}/`);
  console.log(`Serving ${root}`);
});
