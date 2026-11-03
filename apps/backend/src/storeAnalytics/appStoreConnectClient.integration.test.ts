import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent, buildConnector, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { AppStoreConnectClient, type AppStoreConnectRetry } from "./appStoreConnectClient";

const origin = "https://api.appstoreconnect.apple.com";

test("App Store Connect discovery and downloads honor source cancellation over real HTTPS", { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "asc-transport-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  const previousDispatcher = getGlobalDispatcher();
  const requests: Array<string> = [];
  const retries: Array<AppStoreConnectRetry> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const counts = new Map<string, number>();
  const credentials = {
    privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
    keyId: "local-key", issuerId: "local-issuer", appId: "42",
  };
  const server = createServer((request, response) => {
    assert.ok(request.url !== undefined);
    const url = new URL(request.url, origin);
    requests.push(url.pathname + url.search);
    const count = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, count);
    if (url.pathname.startsWith("/segment/")) {
      assert.equal(request.headers.authorization, undefined);
    } else {
      assert.match(request.headers.authorization ?? "", /^Bearer /);
    }
    if (url.pathname.includes("slow-headers") || (url.pathname.includes("partial") && url.searchParams.has("page"))) {
      return;
    }
    if (url.pathname.includes("slow-body")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"data":[');
      return;
    }
    if (url.pathname.includes("broken-body") && count === 1) {
      response.writeHead(200, { "Content-Length": "100" });
      response.write("partial");
      setImmediate(() => response.destroy());
      return;
    }
    if (url.pathname.includes("retry") && (!url.pathname.includes("recovery") || count === 1)) {
      response.writeHead(503);
      response.end("provider busy");
      return;
    }
    if (url.pathname.includes("terminal")) {
      response.writeHead(403);
      response.end("provider denied");
      return;
    }
    let next: string | null = null;
    if ((url.pathname.includes("pages") || url.pathname.includes("partial")) && !url.searchParams.has("page")) {
      next = `${origin}${url.pathname}?page=2`;
    } else if (url.pathname.includes("foreign")) {
      next = "https://example.com/v1/stolen";
    } else if (url.pathname.includes("outside-v1")) {
      next = `${origin}/v2/stolen`;
    } else if (url.pathname.includes("repeated")) {
      next = url.href;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      data: [{
        id: url.searchParams.has("page") ? "second" : "first",
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
      }],
      links: { next },
      ...(url.pathname.includes("invalid") ? { data: [{ id: "invalid" }] } : {}),
    }));
  });
  let agent: Agent | undefined;
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=api.appstoreconnect.apple.com",
      "-addext", "subjectAltName=DNS:api.appstoreconnect.apple.com",
    ], { timeout: 5_000, stdio: "ignore" });
    server.setSecureContext({ key: readFileSync(keyPath), cert: readFileSync(certPath) });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const connect = buildConnector({ ca: readFileSync(certPath), timeout: 1_000 });
    agent = new Agent({
      connect(options, callback) {
        assert.equal(options.hostname, "api.appstoreconnect.apple.com");
        connect({ ...options, hostname: "127.0.0.1", port: String(address.port), servername: options.hostname }, callback);
      },
    });
    setGlobalDispatcher(agent);
    const client = (deadlineAtMs: number, signal: AbortSignal): AppStoreConnectClient =>
      new AppStoreConnectClient(credentials, (retry) => { retries.push(retry); }, deadlineAtMs, signal);

    await t.test("complete pagination, origin/path/repeated-link guards and Zod validation", async () => {
      const active = client(Date.now() + 5_000, new AbortController().signal);
      assert.deepEqual((await active.listReportRequests("pages")).map((item) => item.id), ["first", "second"]);
      for (const [id, message] of [
        ["foreign", /unexpected pagination URL/], ["outside-v1", /unexpected pagination URL/],
        ["repeated", /repeated a pagination link/], ["invalid", /unexpected data\[0\]/],
      ] as const) {
        const before = requests.length;
        await assert.rejects(active.listReportRequests(id), message);
        assert.equal(requests.length - before, 1);
      }
    });

    await t.test("deadline cancels headers, bodies, retry delay and incomplete discovery without another attempt", async () => {
      for (const id of ["slow-headers", "slow-body", "retry-deadline", "partial"]) {
        const before = requests.length;
        const retryCount = retries.length;
        const started = Date.now();
        await assert.rejects(client(started + 300, new AbortController().signal).listReportRequests(id), /deadline exceeded/);
        assert.ok(Date.now() - started < 1_500);
        assert.equal(requests.length - before, id === "partial" ? 2 : 1);
        assert.equal(retries.length - retryCount, id === "retry-deadline" ? 1 : 0);
      }
    });

    await t.test("lock loss cancels headers, bodies and retry delay without another attempt", async () => {
      for (const id of ["slow-headers-lock", "slow-body-lock", "retry-lock"]) {
        const controller = new AbortController();
        const before = requests.length;
        const retryCount = retries.length;
        const timer = setTimeout(() => controller.abort(new Error("local lock lost")), 150);
        timers.add(timer);
        const started = Date.now();
        await assert.rejects(client(started + 5_000, controller.signal).listReportRequests(id), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /import aborted/);
          assert.equal((error.cause as Error).message, "local lock lost");
          return true;
        });
        clearTimeout(timer);
        timers.delete(timer);
        assert.ok(Date.now() - started < 1_500);
        assert.equal(requests.length - before, 1);
        assert.equal(retries.length - retryCount, id === "retry-lock" ? 1 : 0);
      }
    });

    await t.test("provider retry warnings, recovery and final HTTP details survive", async () => {
      const active = client(Date.now() + 12_000, new AbortController().signal);
      const retryCount = retries.length;
      assert.equal((await active.listReportRequests("retry-recovery")).length, 1);
      assert.equal(retries.length - retryCount, 1);
      assert.equal(retries.at(-1)?.status, 503);
      await assert.rejects(active.listReportRequests("retry-exhausted"), /HTTP 503: provider busy/);
      assert.equal(counts.get("/v1/apps/retry-exhausted/analyticsReportRequests"), 3);
      assert.deepEqual(retries.slice(-2).map(({ attempt, status }) => ({ attempt, status })), [
        { attempt: 1, status: 503 }, { attempt: 2, status: 503 },
      ]);
      await assert.rejects(active.listReportRequests("terminal"), /HTTP 403: provider denied/);
    });

    await t.test("pre-signed segment bodies share the deadline and retry transport without authorization", async () => {
      const retryCount = retries.length;
      const recovered = await client(Date.now() + 5_000, new AbortController().signal)
        .downloadSegment(`${origin}/segment/broken-body`, "local segment");
      assert.ok(recovered.length > 0);
      assert.equal(counts.get("/segment/broken-body"), 2);
      assert.equal(retries.length - retryCount, 1);
      assert.deepEqual(retries.at(-1), { label: "local segment", attempt: 1, status: null });
      const before = requests.length;
      await assert.rejects(client(Date.now() + 300, new AbortController().signal)
        .downloadSegment(`${origin}/segment/slow-body`, "local segment"), /local segment:.*deadline exceeded/);
      assert.equal(requests.length - before, 1);
    });

    await t.test("expired budgets and pre-aborted locks start no transport", async () => {
      const before = requests.length;
      assert.throws(() => client(Date.now() - 1, new AbortController().signal), /deadline exceeded/);
      const controller = new AbortController();
      controller.abort(new Error("already lost"));
      assert.throws(() => client(Date.now() + 5_000, controller.signal), /import aborted/);
      const expired = client(Date.now() + 20, new AbortController().signal);
      await new Promise<void>((resolve) => { timers.add(setTimeout(resolve, 50)); });
      await assert.rejects(expired.listReportRequests("unused"), /deadline exceeded/);
      assert.equal(requests.length, before);
    });
  } finally {
    setGlobalDispatcher(previousDispatcher);
    for (const timer of timers) clearTimeout(timer);
    await agent?.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
