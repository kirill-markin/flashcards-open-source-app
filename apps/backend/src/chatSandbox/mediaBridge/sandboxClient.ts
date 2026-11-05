import { setTimeout as sleep } from "node:timers/promises";
import type { Command, ExecResult, ResolvedCommandContext } from "just-bash";
import { z } from "zod";
import { maximumImageIngestionOriginalBytes } from "../../mediaAssets/validators";
import {
  bridgeRetryDelaysMs,
  describeBridgeOutcome,
  isBridgeAttemptRetryable,
  sendBridgeAttempt,
  type BridgeRequest,
} from "../bridgeTransport";
import {
  maximumMediaGetBytes,
  maximumMediaGetsPerCommand,
  maximumMediaPutsPerCommand,
  type ChatSandboxMediaBridge,
} from "../contract";
import { downloadPresignedObject, PresignedTransferError } from "../presignedTransfer";

const workPathPrefix = "/work/";
const fcassetPrefix = "fcasset:";
/** The destinations of a generated image that is not on the card yet; neither has a file to copy. */
const unreadyImageQueries: ReadonlySet<string> = new Set(["?state=pending", "?state=failed"]);
const mediaAssetIdSchema = z.string().uuid();

const mediaGetAnswerSchema = z.object({
  sizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string().url(),
});

const mediaPutAnswerSchema = z.object({
  mediaAssetId: mediaAssetIdSchema,
});

/** A media bridge call that did not succeed; its message is what the command prints on stderr. */
class ChatSandboxMediaCallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChatSandboxMediaCallError";
  }
}

function fail(name: string, message: string, exitCode: number): ExecResult {
  return { stdout: "", stderr: `${name}: ${message}\n`, exitCode };
}

/** The id bare or as the whole `fcasset:<id>` destination read on a card; anything else is a refusal. */
function readMediaAssetId(rawId: string): Readonly<{ mediaAssetId: string }> | Readonly<{ refusal: string }> {
  const destination = rawId.startsWith(fcassetPrefix) ? rawId.slice(fcassetPrefix.length) : rawId;
  const queryStart = destination.indexOf("?");
  const mediaAssetId = queryStart === -1 ? destination : destination.slice(0, queryStart);
  const query = queryStart === -1 ? "" : destination.slice(queryStart);
  if (!mediaAssetIdSchema.safeParse(mediaAssetId).success || (query !== "" && !unreadyImageQueries.has(query))) {
    return { refusal: `${JSON.stringify(rawId)} is not a media asset id: pass the UUID of an fcasset: image destination` };
  }

  if (query !== "") {
    return { refusal: `the image ${mediaAssetId} is not ready (${query}), so it has no file to copy: copy only an image whose fcasset: destination has no ?state=` };
  }

  return { mediaAssetId: mediaAssetId.toLowerCase() };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The host end of the chat sandbox's media bridge for one `bash` command: `fc-media-get` copies a managed
 * image of the open workspace into /work, and `fc-media-put` uploads a file as a new managed image and
 * prints its id, which code places on a card with an SQL write. Both are sent to the media route with the
 * command's capability.
 */
export class ChatSandboxMediaBridgeClient {
  private sentGets = 0;
  private sentPuts = 0;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly bridge: ChatSandboxMediaBridge,
    private readonly sessionId: string,
  ) {}

  public get getCount(): number {
    return this.sentGets;
  }

  public get putCount(): number {
    return this.sentPuts;
  }

  public createCommands(): ReadonlyArray<Command> {
    return [
      { name: "fc-media-get", execute: async (args, context) => this.runGet(args, context) },
      { name: "fc-media-put", execute: async (args, context) => this.runPut(args, context) },
    ];
  }

  private async runGet(args: ReadonlyArray<string>, context: ResolvedCommandContext): Promise<ExecResult> {
    const name = "fc-media-get";
    if (args.length !== 2) {
      return fail(name, "usage: fc-media-get MEDIA_ASSET_ID PATH_UNDER_WORK", 2);
    }

    const [rawId, rawPath] = args;
    const id = readMediaAssetId(rawId);
    if ("refusal" in id) {
      return fail(name, id.refusal, 1);
    }

    const path = context.fs.resolvePath(context.cwd, rawPath);
    if (!path.startsWith(workPathPrefix)) {
      return fail(name, `${path} is not under /work: copy the image to a path under /work`, 1);
    }

    if (this.sentGets >= maximumMediaGetsPerCommand) {
      return fail(name, `this bash command already copied ${maximumMediaGetsPerCommand} images, the most one command may copy: continue in another bash command`, 1);
    }

    this.sentGets += 1;
    let bytes: Uint8Array;
    try {
      const answer = mediaGetAnswerSchema.parse(JSON.parse(await this.runAlone(() => this.send({
        url: `${this.bridge.url}/${id.mediaAssetId}`,
        method: "GET",
        authorization: this.bridge.authorization,
        contentType: null,
        body: null,
      }, true, context.signal))));
      if (answer.sizeBytes > maximumMediaGetBytes) {
        return fail(name, `the image ${id.mediaAssetId} is ${answer.sizeBytes} bytes; fc-media-get copies images of at most ${maximumMediaGetBytes} bytes`, 1);
      }

      bytes = await downloadPresignedObject(answer.downloadUrl, path, answer.sizeBytes);
    } catch (error) {
      if (error instanceof ChatSandboxMediaCallError || error instanceof PresignedTransferError) {
        return fail(name, error.message, 1);
      }

      throw error;
    }

    try {
      await context.fs.writeFile(path, bytes);
    } catch (error) {
      return fail(name, `cannot write ${path}: ${readErrorMessage(error)}`, 1);
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private async runPut(args: ReadonlyArray<string>, context: ResolvedCommandContext): Promise<ExecResult> {
    const name = "fc-media-put";
    if (args.length !== 1) {
      return fail(name, "usage: fc-media-put PATH", 2);
    }

    const path = context.fs.resolvePath(context.cwd, args[0]);
    let bytes: Uint8Array;
    try {
      bytes = await context.fs.readFileBuffer(path);
    } catch (error) {
      return fail(name, `cannot read ${path}: ${readErrorMessage(error)}`, 1);
    }

    if (bytes.byteLength === 0 || bytes.byteLength > maximumImageIngestionOriginalBytes) {
      return fail(name, `${path} is ${bytes.byteLength} bytes; an uploaded image must be 1 to ${maximumImageIngestionOriginalBytes} bytes of JPEG, PNG or WebP`, 1);
    }

    if (this.sentPuts >= maximumMediaPutsPerCommand) {
      return fail(name, `this bash command already uploaded ${maximumMediaPutsPerCommand} images, the most one command may upload: continue in another bash command`, 1);
    }

    this.sentPuts += 1;
    try {
      const answer = mediaPutAnswerSchema.parse(JSON.parse(await this.runAlone(() => this.send({
        url: this.bridge.url,
        method: "POST",
        authorization: this.bridge.authorization,
        contentType: "application/octet-stream",
        body: bytes,
      }, false, context.signal))));
      return { stdout: `${answer.mediaAssetId}\n`, stderr: "", exitCode: 0 };
    } catch (error) {
      if (error instanceof ChatSandboxMediaCallError) {
        return fail(name, error.message, 1);
      }

      throw error;
    }
  }

  /** One call at a time, like the SQL bridge, so `xargs -P` cannot send many at once into the API's shared throttle. */
  private runAlone(run: () => Promise<string>): Promise<string> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * An unconfirmed upload may still have created an image, which stays unused until code puts its id on a
   * card, so uploading again is safe.
   */
  private async send(request: BridgeRequest, readOnly: boolean, signal: AbortSignal | undefined): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await sendBridgeAttempt(request, signal);
      if (outcome.answered && outcome.status === 200) {
        return outcome.body;
      }

      const failure = describeBridgeOutcome(outcome);
      const retryDelayMs = bridgeRetryDelaysMs[attempt - 1];
      if (retryDelayMs === undefined || !isBridgeAttemptRetryable(readOnly, outcome)) {
        throw new ChatSandboxMediaCallError(readOnly
          ? `the media bridge did not return the image: ${failure}`
          : `the media bridge did not confirm this upload: ${failure}`);
      }

      console.warn({ action: "chat_sandbox_media_retried", sessionId: this.sessionId, method: request.method, attempt, failure, retryDelayMs });
      await sleep(retryDelayMs, undefined, signal === undefined ? {} : { signal });
    }
  }
}
