import fs from "node:fs";
import path from "node:path";

type OpenApiDocument = Readonly<Record<string, unknown>>;

const findOpenApiPath = (): string => {
  const candidates = [
    path.resolve(process.cwd(), "api/openapi.yaml"),
    path.resolve(process.cwd(), "../../api/openapi.yaml"),
    path.resolve(__dirname, "../../../api/openapi.yaml"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate api/openapi.yaml");
};

let cachedDocument: OpenApiDocument | null = null;

export const loadOpenApiDocument = (): OpenApiDocument => {
  if (cachedDocument !== null) {
    return cachedDocument;
  }

  // This document is intentionally the external AI-agent contract only. It
  // excludes shared first-party routes such as sync, local chat, and human
  // connection-management endpoints even when those routes remain live.
  const rawDocument = fs.readFileSync(findOpenApiPath(), "utf8");
  cachedDocument = JSON.parse(rawDocument) as OpenApiDocument;
  return cachedDocument;
};
