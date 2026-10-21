import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Socket } from "node:net";

const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json" };

// A bundled UI needs an HTTP origin: file:// breaks root-relative assets and
// authenticated media cookies. Keep API/media on this same loopback origin.
export async function startRendererServer(directory: string, backend: string) {
  const root = await realpath(directory);
  const target = new URL(backend.endsWith("/") ? backend : `${backend}/`);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid desktop backend protocol");
  const transport = target.protocol === "https:" ? https : http;
  const sockets = new Set<Socket>();
  let origin = "";
  function proxyOptions(request: IncomingMessage) {
    const headers = { ...request.headers, host: target.host };
    delete headers.origin;
    delete headers.referer;
    // The backend may be mounted under a path prefix.
    return { method: request.method, headers, path: `${target.pathname.replace(/\/$/, "")}${request.url}` };
  }
  function permitted(request: IncomingMessage) {
    return request.headers.host === new URL(origin).host && (!request.headers.origin || request.headers.origin === origin);
  }
  const server = http.createServer(async (request, response) => {
    if (!permitted(request)) { response.writeHead(403); response.end("Forbidden origin"); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url ?? "/", origin).pathname); }
    catch { response.writeHead(400); response.end("Invalid path"); return; }
    if (pathname.startsWith("/api/") || pathname.startsWith("/storage/") || pathname === "/health") {
      const upstream = transport.request(target, proxyOptions(request), remote => {
        const headers = { ...remote.headers };
        // Browser cookies belong to the loopback UI, rather than the remote host.
        if (headers["set-cookie"]) headers["set-cookie"] = headers["set-cookie"].map(cookie => cookie.replace(/;\s*Domain=[^;]+/gi, "").replace(/;\s*Secure\b/gi, ""));
        response.writeHead(remote.statusCode ?? 502, headers);
        remote.on("error", () => response.destroy());
        remote.pipe(response);
      });
      upstream.on("error", () => {
        if (response.headersSent) { response.destroy(); return; }
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Backend tidak dapat dihubungi" }));
      });
      upstream.setTimeout(65000, () => upstream.destroy(new Error("Backend timeout")));
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405); response.end(); return; }
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
    try {
      const resolved = await realpath(file);
      if (!resolved.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error("Not a file");
      response.writeHead(200, { "Content-Type": mime[path.extname(resolved)] ?? "application/octet-stream", "Content-Length": info.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      if (request.method === "HEAD") { response.end(); return; }
      const stream = createReadStream(resolved);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch { response.writeHead(404); response.end("File not found"); }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (request, socket, head) => {
    if (!permitted(request) || new URL(request.url ?? "/", origin).pathname !== "/ws") { socket.destroy(); return; }
    const upstream = transport.request(target, proxyOptions(request));
    upstream.on("upgrade", (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      socket.on("close", () => remote.destroy());
      remote.on("error", () => socket.destroy());
    });
    upstream.on("response", () => { socket.destroy(); upstream.destroy(); });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop UI server could not start");
  origin = `http://127.0.0.1:${address.port}`;
  return { url: origin, close: () => new Promise<void>((resolve, reject) => {
    for (const socket of sockets) socket.destroy();
    server.close(error => error ? reject(error) : resolve());
  }) };
}
