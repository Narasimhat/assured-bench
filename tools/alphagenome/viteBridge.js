import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Development-only, same-origin loopback adapter. No credentials are served to the browser. */
export function alphaGenomeBridge() {
  let running = false;
  return { name: "local-alphagenome-review", configureServer(server) {
    server.middlewares.use('/api/alphagenome', (req, res) => {
      const send = (status, data) => { if (!res.writableEnded) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); } };
      const host = req.headers.host || "";
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
      if (!local || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(403, { error: "The local reviewer accepts same-origin loopback requests only." });
      const root = server.config.root;
      const python = resolve(root, ".venv-alphagenome/bin/python");
      const configured = existsSync(python) && Boolean(process.env.ALPHAGENOME_API_KEY || existsSync(resolve(root, "local-reviews/alphagenome-api-key.local")));
      if (req.method === "GET" && req.url === "/status") return send(200, { available: configured, busy: running, mode: "local" });
      if (req.method !== "POST" || req.url !== "/compare") return send(404, { error: "Unknown local reviewer endpoint." });
      if (!configured) return send(503, { error: "Configure the local AlphaGenome Python environment and key first. Your key never belongs in the browser." });
      if (running) return send(409, { error: "Another review is running. Wait for it to finish." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return send(415, { error: "JSON request required." });
      let body = "", oversized = false;
      req.on("data", chunk => { body += chunk; if (Buffer.byteLength(body) > 2400000) { oversized = true; body = ""; send(413, { error: "Comparison request exceeds 2.4 MB." }); req.destroy(); } });
      req.on("end", () => {
        if (oversized) return;
        try { JSON.parse(body); } catch { return send(400, { error: "Invalid JSON request." }); }
        running = true;
        const child = spawn(python, [resolve(root, "tools/alphagenome/compare.py")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
        let output = "", finished = false;
        const timer = setTimeout(() => { child.kill(); }, 600000);
        const finish = (status, data) => { if (finished) return; finished = true; clearTimeout(timer); running = false; send(status, data); };
        child.stdout.on("data", chunk => { output += chunk; if (output.length > 6000000) child.kill(); });
        child.stderr.on("data", () => {}); // SDK diagnostics may contain credentials.
        child.stdin.on("error", () => {});
        child.on("error", () => finish(503, { error: "Local reviewer could not start." }));
        child.on("close", code => { let data; try { data = JSON.parse(output); } catch { data = { error: "Review did not complete; no results were accepted." }; } finish(code === 0 ? 200 : 502, data); });
        res.on("close", () => { if (!res.writableEnded) child.kill(); });
        child.stdin.end(body);
      });
    });
  } };
}
