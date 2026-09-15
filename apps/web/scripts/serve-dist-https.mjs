import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { extname, join, normalize } from "node:path";

const plainTextContentType = "text/plain; charset=utf-8";

const args = parseArgs(process.argv.slice(2));
const host = requireArgument(args, "host");
const port = Number.parseInt(requireArgument(args, "port"), 10);
const directory = requireArgument(args, "dir");
const certPath = requireArgument(args, "cert");
const keyPath = requireArgument(args, "key");

if (Number.isInteger(port) === false || port <= 0) {
  throw new Error(`Invalid HTTPS port: ${String(args.port)}`);
}

if (existsSync(certPath) === false) {
  throw new Error(`HTTPS certificate file does not exist: ${certPath}`);
}

if (existsSync(keyPath) === false) {
  throw new Error(`HTTPS key file does not exist: ${keyPath}`);
}

/**
 * A tiny HTTPS server is enough here because the live smoke job serves an
 * already-built SPA bundle. The server keeps the app on the production host
 * name so auth cookies stay same-site with the real auth and API domains.
 */
const server = createServer(
  {
    cert: await readFile(certPath),
    key: await readFile(keyPath),
  },
  async (request, response) => {
    const method = request.method ?? "UNKNOWN";
    const requestUrl = request.url ?? "/";
    const pathname = sanitizePathname(requestUrl);
    const candidatePath = join(directory, pathname);
    const filePath = normalize(candidatePath);

    if (filePath.startsWith(normalize(directory)) === false) {
      logRequest(method, pathname, 400, false, plainTextContentType);
      response.writeHead(400, { "content-type": plainTextContentType });
      response.end("Invalid path");
      return;
    }

    const resolvedFilePath = existsSync(filePath) ? filePath : join(directory, "index.html");
    const fallbackToIndex = existsSync(filePath) === false;

    if (existsSync(resolvedFilePath) === false) {
      logRequest(method, pathname, 404, fallbackToIndex, plainTextContentType);
      response.writeHead(404, { "content-type": plainTextContentType });
      response.end("File not found");
      return;
    }

    const contentType = contentTypeFor(extname(resolvedFilePath));
    logRequest(method, pathname, 200, fallbackToIndex, contentType);
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": fallbackToIndex ? "no-store" : "public, max-age=60",
    });
    createReadStream(resolvedFilePath).pipe(response);
  },
);

server.listen(port, host, () => {
  console.log(`HTTPS dist server listening on https://${host}:${String(port)}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  server.close(() => {
    process.exit(0);
  });
});

/**
 * The live smoke uploads this log when it fails, so every request needs a line
 * that separates a real asset from the SPA `index.html` fallback, which also
 * answers `200`. Only the sanitized pathname is logged, never the query string,
 * so the log cannot carry a credential into a public artifact.
 */
function logRequest(method, pathname, status, fallbackToIndex, contentType) {
  console.log(
    `${new Date().toISOString()} ${method} /${pathname} status=${String(status)} fallbackToIndex=${String(fallbackToIndex)} contentType=${contentType}`,
  );
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 2) {
    const key = rawArgs[index];
    const value = rawArgs[index + 1];

    if (typeof key !== "string" || key.startsWith("--") === false) {
      throw new Error(`Invalid argument key: ${String(key)}`);
    }

    if (typeof value !== "string") {
      throw new Error(`Missing value for argument: ${key}`);
    }

    parsed[key.slice(2)] = value;
  }

  return parsed;
}

function requireArgument(argsObject, key) {
  const value = argsObject[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required argument --${key}`);
  }

  return value;
}

function sanitizePathname(requestUrl) {
  const pathname = new URL(requestUrl, "https://localhost").pathname;
  const normalizedPathname = pathname === "/" ? "/index.html" : pathname;
  return normalizedPathname.replace(/^\/+/, "");
}

function contentTypeFor(extension) {
  switch (extension) {
  case ".css":
    return "text/css; charset=utf-8";
  case ".html":
    return "text/html; charset=utf-8";
  case ".ico":
    return "image/x-icon";
  case ".js":
    return "text/javascript; charset=utf-8";
  case ".json":
    return "application/json; charset=utf-8";
  case ".png":
    return "image/png";
  case ".svg":
    return "image/svg+xml";
  case ".txt":
    return "text/plain; charset=utf-8";
  default:
    return "application/octet-stream";
  }
}
