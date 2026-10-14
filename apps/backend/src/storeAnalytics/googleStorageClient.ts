import { setTimeout as sleep } from "node:timers/promises";
import { AwsClient } from "google-auth-library";
import { z } from "zod";

// The provider trusts only the Lambda role FlashcardsStoreReportsImportRole; the service account is
// a Play Console user allowed to download bulk reports. It is not the billing identity.
const googleProviderAudience = "//iam.googleapis.com/projects/360001205059/locations/global/workloadIdentityPools/nibomo-aws-store-reports/providers/aws-store-reports-import";
const googleServiceAccount = "nibomo-store-reports@flashcards-open-source-app.iam.gserviceaccount.com";
const storageReadOnlyScope = "https://www.googleapis.com/auth/devstorage.read_only";
const storageApiOrigin = "https://storage.googleapis.com";
const requestTimeoutMs = 120_000;
const maxAttempts = 3;
const retryDelayMs = 2_000;
const listPageSize = 1_000;

export type GoogleStorageObject = Readonly<{
  name: string;
  generation: string;
  md5Hash: string | null;
}>;

export type GoogleStorageRetry = Readonly<{
  label: string;
  attempt: number;
  status: number | null;
}>;

const listPageSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    generation: z.string().regex(/^\d+$/),
    md5Hash: z.string().nullish(),
  })).nullish(),
  nextPageToken: z.string().nullish(),
});

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createStoreReportsAuthClient(
  onRetry: (retry: GoogleStorageRetry) => void, scopes: ReadonlyArray<string>,
): AwsClient {
  for (const field of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"]) {
    if (process.env[field] === undefined || process.env[field]?.trim() === "") {
      throw new Error(`Google Play reports access requires Lambda temporary AWS credentials and region: ${field} is missing`);
    }
  }
  return new AwsClient({
    type: "external_account",
    audience: googleProviderAudience,
    subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${googleServiceAccount}:generateAccessToken`,
    scopes: [...scopes],
    credential_source: {
      environment_id: "aws1",
      regional_cred_verification_url: "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
    },
    transporterOptions: {
      // gaxios defaults to node-fetch, whose timeout abort carries no TimeoutError code and is never retried.
      fetchImplementation: fetch,
      timeout: 5_000,
      retry: true,
      redirect: "error",
      retryConfig: {
        retry: 2,
        noResponseRetries: 2,
        httpMethodsToRetry: ["GET", "POST"],
        statusCodesToRetry: [[408, 408], [429, 429], [500, 599]],
        totalTimeout: 15_000,
        maxRetryDelay: 500,
        onRetryAttempt: (error): void => {
          onRetry({
            label: "Google reports identity request",
            attempt: error.config.retryConfig?.currentRetryAttempt ?? 0,
            status: error.response?.status ?? null,
          });
        },
      },
    },
  });
}

export class GoogleStorageClient {
  private readonly authClient: AwsClient;
  private readonly onRetry: (retry: GoogleStorageRetry) => void;

  constructor(onRetry: (retry: GoogleStorageRetry) => void) {
    this.authClient = createStoreReportsAuthClient(onRetry, [storageReadOnlyScope]);
    this.onRetry = onRetry;
  }

  async listObjects(bucket: string, prefix: string): Promise<ReadonlyArray<GoogleStorageObject>> {
    const objects: Array<GoogleStorageObject> = [];
    const visitedPageTokens = new Set<string>();
    let pageToken: string | null = null;
    do {
      const url = new URL(`/storage/v1/b/${encodeURIComponent(bucket)}/o`, storageApiOrigin);
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("maxResults", String(listPageSize));
      url.searchParams.set("fields", "items(name,generation,md5Hash),nextPageToken");
      if (pageToken !== null) {
        url.searchParams.set("pageToken", pageToken);
      }
      const label = `list gs://${bucket}/${prefix}`;
      const body = await this.fetchWithRetry(url.href, label);
      let json: unknown;
      try {
        json = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error(`${label}: response is not JSON: ${body.toString("utf8").slice(0, 500)}`);
      }
      const page = listPageSchema.safeParse(json);
      if (!page.success) {
        throw new Error(`${label}: unexpected page shape: ${describeIssues(page.error)}`);
      }
      for (const item of page.data.items ?? []) {
        objects.push({ name: item.name, generation: item.generation, md5Hash: item.md5Hash ?? null });
      }
      pageToken = page.data.nextPageToken ?? null;
      if (pageToken !== null) {
        if (visitedPageTokens.has(pageToken)) {
          throw new Error(`${label}: Cloud Storage repeated page token ${pageToken}`);
        }
        visitedPageTokens.add(pageToken);
      }
    } while (pageToken !== null);
    return objects;
  }

  /** Pins the listed generation, so the bytes always belong to the generation recorded as imported. */
  async downloadObject(bucket: string, object: GoogleStorageObject): Promise<Buffer> {
    const url = new URL(
      `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.name)}`,
      storageApiOrigin,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("generation", object.generation);
    return this.fetchWithRetry(url.href, `download gs://${bucket}/${object.name}#${object.generation}`);
  }

  private async readAccessToken(): Promise<string> {
    const { token } = await this.authClient.getAccessToken();
    if (token === undefined || token === null || token === "") {
      throw new Error(`Google returned no access token for ${googleServiceAccount}`);
    }
    return token;
  }

  private async fetchWithRetry(url: string, label: string): Promise<Buffer> {
    for (let attempt = 1; ; attempt += 1) {
      const headers = { Authorization: `Bearer ${await this.readAccessToken()}` };
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
