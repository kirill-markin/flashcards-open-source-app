import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { loadAppStoreConnectReportsSecretJson } from "../aws/secrets";

const apiOrigin = "https://api.appstoreconnect.apple.com";
const requestTimeoutMs = 120_000;
const maxAttempts = 3;
const retryDelayMs = 2_000;
// Apple rejects tokens that live longer than 20 minutes.
const tokenLifetimeSeconds = 600;
const pageLimit = 200;

export type AppStoreConnectCredentials = Readonly<{
  privateKey: KeyObject;
  keyId: string;
  issuerId: string;
  appId: string;
}>;

export type AppStoreConnectRetry = Readonly<{
  label: string;
  attempt: number;
  status: number | null;
}>;

export type AnalyticsReportRequest = Readonly<{
  id: string;
  accessType: string;
  stoppedDueToInactivity: boolean;
}>;

export type AnalyticsReport = Readonly<{ id: string; name: string }>;

export type AnalyticsReportGranularity = "DAILY" | "WEEKLY" | "MONTHLY";

export type AnalyticsReportInstance = Readonly<{
  id: string;
  granularity: AnalyticsReportGranularity;
  processingDate: string;
}>;

export type AnalyticsReportSegment = Readonly<{
  id: string;
  checksum: string | null;
  url: string;
}>;

const reportsSecretSchema = z.object({
  privateKey: z.string().min(1),
  keyId: z.string().min(1),
  issuerId: z.string().min(1),
  appId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
});

const pageSchema = z.object({
  data: z.array(z.unknown()),
  links: z.object({ next: z.string().nullish() }),
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const reportRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal("analyticsReportRequests"),
  attributes: z.object({
    accessType: z.string().min(1),
    stoppedDueToInactivity: z.boolean().nullish(),
  }),
});

const reportSchema = z.object({
  id: z.string().min(1),
  type: z.literal("analyticsReports"),
  attributes: z.object({ name: z.string().min(1) }),
});

const instanceSchema = z.object({
  id: z.string().min(1),
  type: z.literal("analyticsReportInstances"),
  attributes: z.object({
    granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    processingDate: isoDateSchema,
  }),
});

const segmentSchema = z.object({
  id: z.string().min(1),
  type: z.literal("analyticsReportSegments"),
  attributes: z.object({
    checksum: z.string().nullish(),
    url: z.string().url(),
  }),
});

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

/** Never quotes the secret: neither the JSON parser's message nor a zod issue is attached as-is. */
export async function loadAppStoreConnectCredentials(secretId: string): Promise<AppStoreConnectCredentials> {
  const secretJson = await loadAppStoreConnectReportsSecretJson(secretId);
  let value: unknown;
  try {
    value = JSON.parse(secretJson);
  } catch {
    throw new Error(`Secret ${secretId} SecretString is not valid JSON`);
  }
  const parsed = reportsSecretSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Secret ${secretId} must hold privateKey, keyId, issuerId and a numeric appId: ${describeIssues(parsed.error)}`,
    );
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(parsed.data.privateKey);
  } catch {
    throw new Error(`Secret ${secretId} privateKey is not a PEM private key`);
  }
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error(`Secret ${secretId} privateKey must be an ES256 (P-256) key`);
  }

  return {
    privateKey,
    keyId: parsed.data.keyId,
    issuerId: parsed.data.issuerId,
    appId: String(parsed.data.appId),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Read-only App Store Connect Analytics Reports API client. The team key signs a fresh ES256 token
 * per request; segment URLs are pre-signed and fetched without the token.
 */
export class AppStoreConnectClient {
  private readonly credentials: AppStoreConnectCredentials;
  private readonly onRetry: (retry: AppStoreConnectRetry) => void;

  constructor(credentials: AppStoreConnectCredentials, onRetry: (retry: AppStoreConnectRetry) => void) {
    this.credentials = credentials;
    this.onRetry = onRetry;
  }

  async listReportRequests(appId: string): Promise<ReadonlyArray<AnalyticsReportRequest>> {
    const items = await this.listAll(
      `/v1/apps/${encodeURIComponent(appId)}/analyticsReportRequests?limit=${pageLimit}`,
      reportRequestSchema,
    );
    return items.map((item) => ({
      id: item.id,
      accessType: item.attributes.accessType,
      stoppedDueToInactivity: item.attributes.stoppedDueToInactivity === true,
    }));
  }

  async listReports(requestId: string): Promise<ReadonlyArray<AnalyticsReport>> {
    const items = await this.listAll(
      `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?limit=${pageLimit}`,
      reportSchema,
    );
    return items.map((item) => ({ id: item.id, name: item.attributes.name }));
  }

  async listInstances(reportId: string): Promise<ReadonlyArray<AnalyticsReportInstance>> {
    const items = await this.listAll(
      `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances?limit=${pageLimit}`,
      instanceSchema,
    );
    return items.map((item) => ({
      id: item.id,
      granularity: item.attributes.granularity,
      processingDate: item.attributes.processingDate,
    }));
  }

  async listSegments(instanceId: string): Promise<ReadonlyArray<AnalyticsReportSegment>> {
    const items = await this.listAll(
      `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments?limit=${pageLimit}`,
      segmentSchema,
    );
    return items.map((item) => ({
      id: item.id,
      checksum: item.attributes.checksum ?? null,
      url: item.attributes.url,
    }));
  }

  /** `label` names the segment in errors; the pre-signed URL itself is never logged. */
  async downloadSegment(url: string, label: string): Promise<Buffer> {
    return this.fetchWithRetry(url, {}, label);
  }

  private createToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: Readonly<Record<string, string | number>>): string =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "ES256", kid: this.credentials.keyId, typ: "JWT" });
    const claims = encode({
      iss: this.credentials.issuerId,
      aud: "appstoreconnect-v1",
      iat: now,
      exp: now + tokenLifetimeSeconds,
    });
    const unsigned = `${header}.${claims}`;
    const signature = sign("sha256", Buffer.from(unsigned), {
      key: this.credentials.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return `${unsigned}.${signature}`;
  }

  private async listAll<Item>(path: string, itemSchema: z.ZodType<Item>): Promise<ReadonlyArray<Item>> {
    const items: Array<Item> = [];
    const visited = new Set<string>();
    let next: string | null = new URL(path, apiOrigin).href;
    while (next !== null) {
      const url = new URL(next);
      if (url.origin !== apiOrigin || !url.pathname.startsWith("/v1/")) {
        throw new Error(`App Store Connect returned an unexpected pagination URL for ${path}: ${url.origin}${url.pathname}`);
      }
      if (visited.has(url.href)) {
        throw new Error(`App Store Connect repeated a pagination link for ${path}: ${url.pathname}${url.search}`);
      }
      visited.add(url.href);

      const label = `GET ${url.pathname}${url.search}`;
      const body = await this.fetchWithRetry(url.href, { Authorization: `Bearer ${this.createToken()}` }, label);
      let json: unknown;
      try {
        json = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error(`${label}: response is not JSON: ${body.toString("utf8").slice(0, 500)}`);
      }
      const page = pageSchema.safeParse(json);
      if (!page.success) {
        throw new Error(`${label}: unexpected page shape: ${describeIssues(page.error)}`);
      }
      for (const [index, rawItem] of page.data.data.entries()) {
        const item = itemSchema.safeParse(rawItem);
        if (!item.success) {
          throw new Error(`${label}: unexpected data[${index}]: ${describeIssues(item.error)}`);
        }
        items.push(item.data);
      }
      next = page.data.links.next ?? null;
    }
    return items;
  }

  private async fetchWithRetry(
    url: string,
    headers: Readonly<Record<string, string>>,
    label: string,
  ): Promise<Buffer> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(requestTimeoutMs) });
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw new Error(`${label}: request failed after ${attempt} attempts`, { cause: error });
        }
        this.onRetry({ label, attempt, status: null });
        await sleep(attempt * retryDelayMs);
        continue;
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (response.ok) {
        return body;
      }
      if (attempt >= maxAttempts || !isRetryableStatus(response.status)) {
        throw new Error(`${label}: HTTP ${response.status}: ${body.toString("utf8").slice(0, 2_000)}`);
      }
      this.onRetry({ label, attempt, status: response.status });
      await sleep(attempt * retryDelayMs);
    }
  }
}
