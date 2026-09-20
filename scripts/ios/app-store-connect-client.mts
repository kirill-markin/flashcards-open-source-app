import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Resource = { id: string; type: string; attributes: JsonObject };

export function object(value: Json, context: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected object: ${context}`);
  return value;
}

export function string(value: Json | undefined, context: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected nonempty string: ${context}`);
  return value;
}

export function resource(value: Json, type: string): Resource {
  const data = object(value, type);
  if (data.type !== type) throw new Error(`Expected resource type ${type}; got ${data.type}`);
  return { id: string(data.id, `${type}.id`), type, attributes: object(data.attributes, `${type}.attributes`) };
}

export function text(resource: Resource, key: string): string {
  return string(resource.attributes[key], `${resource.type}/${resource.id}.${key}`);
}

export async function request(url: string, method: string, headers: Record<string, string>, body: string | Buffer | undefined, label: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      // POST has no idempotency key: an uncertain creation must be reconciled by a fresh run.
      if (method === "POST" || attempt === 3) throw new Error(`${label}: transport failed; inspect remote state before rerunning`, { cause: error });
      console.warn(JSON.stringify({ event: "app_store_retry", label, attempt, reason: "transport" }));
      await sleep(attempt * 2000);
      continue;
    }
    const result = await response.text();
    if (response.ok) return result;
    const error = new Error(`${label}: HTTP ${response.status}: ${result}`);
    if (method === "POST" || attempt === 3 || (response.status !== 429 && response.status < 500)) throw error;
    console.warn(JSON.stringify({ event: "app_store_retry", label, attempt, status: response.status }));
    await sleep(attempt * 2000);
  }
  throw new Error(`${label}: retry limit reached`);
}

export function createClient(repoRoot: string) {
  const commonDirectory = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const mainRoot = dirname(commonDirectory);
  const env = parseEnv(readFileSync(resolve(mainRoot, ".env"), "utf8"));
  const required = (name: string): string => string(env[name], `main checkout .env: ${name}`);
  const kind = required("APP_STORE_CONNECT_KEY_KIND");
  if (kind !== "individual" && kind !== "team") throw new Error("APP_STORE_CONNECT_KEY_KIND must be individual or team");
  const appId = required("APP_STORE_CONNECT_APP_ID");
  if (!/^\d+$/.test(appId)) throw new Error("APP_STORE_CONNECT_APP_ID must be a numeric Apple app ID");
  const keyId = required("APP_STORE_CONNECT_KEY_ID");
  const issuer = kind === "team" ? required("APP_STORE_CONNECT_ISSUER_ID") : undefined;
  const privateKey = createPrivateKey(readFileSync(resolve(mainRoot, required("APP_STORE_CONNECT_PRIVATE_KEY_PATH"))));
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("App Store Connect requires an ES256 private key");
  const api = async (method: string, path: string, payload: Json | undefined): Promise<JsonObject> => {
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    if (url.origin !== "https://api.appstoreconnect.apple.com" || !url.pathname.startsWith("/v1/")) throw new Error(`Unexpected API URL: ${url.origin}${url.pathname}`);
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: JsonObject): string => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "ES256", kid: keyId, typ: "JWT" });
    const claims = encode({ aud: "appstoreconnect-v1", iat: now, exp: now + 600, ...(kind === "team" ? { iss: issuer! } : { sub: "user" }) });
    const unsigned = `${header}.${claims}`;
    const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const result = await request(url.href, method, { Authorization: `Bearer ${unsigned}.${signature}`, "Content-Type": "application/json" }, payload === undefined ? undefined : JSON.stringify(payload), `${method} ${url.pathname}${url.search}`);
    return result === "" ? {} : object(JSON.parse(result), `${method} ${path}`);
  };
  const read = async (path: string, type: string): Promise<Resource> => resource((await api("GET", path, undefined)).data, type);
  const list = async (path: string, type: string): Promise<Resource[]> => {
    const result: Resource[] = [];
    let next: string | null = path;
    const visited = new Set<string>();
    while (next !== null) {
      if (visited.has(next)) throw new Error(`Repeated pagination link: ${path}`);
      visited.add(next);
      const page = await api("GET", next, undefined);
      if (!Array.isArray(page.data)) throw new Error(`Expected resource list: ${path}`);
      result.push(...page.data.map((item) => resource(item, type)));
      const nextValue = object(page.links, `${path}.links`).next;
      next = nextValue === null || nextValue === undefined ? null : string(nextValue, `${path}.links.next`);
    }
    return result;
  };
  return { appId, api, read, list };
}

export type Client = ReturnType<typeof createClient>;
export type Write = (method: string, path: string, data: JsonObject | JsonObject[]) => Promise<JsonObject>;
