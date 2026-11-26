const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const LIVE_RELOAD_SNIPPET = `
<script>
  (function () {
    if (typeof EventSource === "undefined") return;
    var es = new EventSource("/__live-reload");
    es.onmessage = function (event) {
      try {
        var payload = JSON.parse(event.data);
        if (payload.type === "css") {
          var links = document.querySelectorAll('link[rel="stylesheet"]');
          links.forEach(function (link) {
            var baseHref = link.getAttribute("href").split("?")[0];
            link.setAttribute("href", baseHref + "?v=" + Date.now());
          });
        } else if (payload.type === "reload") {
          window.location.reload();
        }
      } catch (err) {
        window.location.reload();
      }
    };
  })();
</script>
`;

function createDevServer(rootDir = ROOT_DIR) {
  const resolvedRoot = path.resolve(rootDir);
  const clients = new Set();
  let debounceTimer = null;
  let pendingReloadType = null;

  function broadcast(type) {
    const data = `data: ${JSON.stringify({ type })}\n\n`;
    for (const res of clients) {
      res.write(data);
    }
  }

  let watcher = null;
  try {
    watcher = fs.watch(resolvedRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const normalized = filename.replace(/\\/g, "/");
      if (normalized.startsWith(".git/") || normalized === ".git") return;

      const nextType = normalized === "styles.css" ? "css" : "reload";
      pendingReloadType = pendingReloadType === "reload" ? "reload" : nextType;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const typeToSend = pendingReloadType || "reload";
        pendingReloadType = null;
        broadcast(typeToSend);
      }, 80);
    });
  } catch (err) {
    console.warn("Advertencia: no se pudo iniciar el observador de archivos:", err.message);
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");

    if (reqUrl.pathname === "/__live-reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    const relativePath = reqUrl.pathname === "/" ? "index.html" : decodeURIComponent(reqUrl.pathname).replace(/^\/+/, "");
    const resolvedPath = path.resolve(resolvedRoot, relativePath);

    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acceso denegado");
      return;
    }

    fs.stat(resolvedPath, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Archivo no encontrado");
        return;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      fs.readFile(resolvedPath, (readErr, data) => {
        if (readErr) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Error leyendo el archivo");
          return;
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");

        if (ext === ".html") {
          const html = data.toString("utf8");
          const injected = html.includes("</body>")
            ? html.replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`)
            : `${html}${LIVE_RELOAD_SNIPPET}`;
          res.writeHead(200);
          res.end(injected);
          return;
        }

        res.writeHead(200);
        res.end(data);
      });
    });
  });

  server.on("close", () => {
    clearTimeout(debounceTimer);
    if (watcher) watcher.close();
    for (const res of clients) {
      res.end();
    }
    clients.clear();
  });

  return server;
}

if (require.main === module) {
  const server = createDevServer(ROOT_DIR);

  function listenOnPort(port) {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        listenOnPort(port + 1);
      } else {
        console.error("Error al iniciar el servidor:", err.message);
        process.exit(1);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      console.log(`Servidor con recarga automática activo en: http://127.0.0.1:${activePort}`);
      console.log("Cualquier cambio en styles.css se aplica al instante y en index.html/assets recarga la página.");
    });
  }

  listenOnPort(DEFAULT_PORT);
}

module.exports = { createDevServer };
