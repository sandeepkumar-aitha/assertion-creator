import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 3000);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const routes = {
  "/": "web/index.html",
  "/app.js": "web/app.js",
  "/styles.css": "web/styles.css",
  "/src/generator.js": "src/generator.js",
};

function getFilePath(requestPath) {
  const relativePath = routes[requestPath];
  if (relativePath === undefined) {
    return undefined;
  }

  const filePath = resolve(rootDirectory, normalize(relativePath));
  return filePath.startsWith(rootDirectory) ? filePath : undefined;
}

const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const filePath = getFilePath(requestPath);

  if (filePath === undefined) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to load the requested file");
  }
});

server.listen(port, () => {
  console.log(`Assertion Creator is running at http://localhost:${port}`);
});