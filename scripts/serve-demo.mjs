// Offline presentation. Serve only the prebuilt HTML, using Node's standard library.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const address = "127.0.0.1";
const port = 4173;
const filename = "VSZ-calculator-07D3.html";
const html = await readFile(new URL("../dist/" + filename, import.meta.url));
const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (req.url !== "/" && req.url !== "/" + filename) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : html);
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE"
    ? "Порт 4173 занят. Закройте предыдущий сервер показа (Ctrl+C) и повторите запуск."
    : error.message);
  process.exitCode = 1;
});
server.listen(port, address, () => {
  console.log("Откройте http://127.0.0.1:4173/ в Chrome. Для остановки нажмите Ctrl+C.");
});
