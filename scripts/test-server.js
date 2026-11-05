const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.CXHW_TEST_PORT || 41735);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  });
}).listen(port, "127.0.0.1", () => console.log(`Mock homework: http://127.0.0.1:${port}/test/mock-homework.html`));
