/* eslint-disable */
import http from "http";

// importing this file starts the worker loop
import "./chapterWorker";

const port = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/healthz" || req.url === "/healthz.txt") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`[worker] health server listening on port ${port}`);
});
