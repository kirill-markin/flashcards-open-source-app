import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const sourceRoot = resolve(__dirname, "../..");
const directEntrypoint = resolve(
  __dirname,
  "lambda.ts",
);

function resolveLocalModule(
  importerPath: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const modulePath = resolve(dirname(importerPath), specifier);
  for (const candidate of [
    `${modulePath}.ts`,
    join(modulePath, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Direct ingestion import graph contains an unresolved local module. importer=${relative(sourceRoot, importerPath)} specifier=${specifier}`,
  );
}

function readRuntimeImportSpecifiers(filePath: string): ReadonlyArray<string> {
  const source = readFileSync(filePath, "utf8")
    .replace(/import\s+type\s+[\s\S]*?\s+from\s+["'][^"']+["'];?/gu, "")
    .replace(/export\s+type\s+[\s\S]*?\s+from\s+["'][^"']+["'];?/gu, "");
  return [...source.matchAll(
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu,
  )].map((match) => match[1]).filter(
    (specifier): specifier is string => specifier !== undefined,
  );
}

function collectRuntimeImportGraph(entrypoint: string): Readonly<{
  files: ReadonlyArray<string>;
  externalModules: ReadonlyArray<string>;
}> {
  const pending = [entrypoint];
  const files = new Set<string>();
  const externalModules = new Set<string>();
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined || files.has(filePath)) continue;
    files.add(filePath);
    for (const specifier of readRuntimeImportSpecifiers(filePath)) {
      const localPath = resolveLocalModule(filePath, specifier);
      if (localPath === null) {
        externalModules.add(specifier);
      } else {
        pending.push(localPath);
      }
    }
  }
  return {
    files: [...files].map((filePath) => relative(sourceRoot, filePath)).sort(),
    externalModules: [...externalModules].sort(),
  };
}

test("dedicated direct ingestion entrypoint excludes the shared app, AI, Langfuse, and Sentry SDK", () => {
  const graph = collectRuntimeImportGraph(directEntrypoint);
  assert.ok(graph.files.includes("server/mediaRequests/directImageIngestionApp.ts"));
  assert.equal(graph.files.includes("server/app.ts"), false);
  assert.equal(
    graph.files.some((filePath) =>
      filePath.startsWith("routes/chat")
      || filePath.startsWith("chat/")
      || filePath.startsWith("telemetry/langfuse")
      || filePath.startsWith("observability/sentry/capture")
      || filePath.startsWith("observability/sentry/config")
      || filePath.startsWith("observability/sentry/tracing")
    ),
    false,
  );
  assert.equal(graph.externalModules.includes("@sentry/aws-serverless"), false);
  assert.equal(graph.externalModules.includes("openai"), false);
  assert.equal(graph.externalModules.includes("@langfuse/tracing"), false);
});
