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
import { listPendingInstances } from "./appleDiscovery";
import { AppStoreConnectClient, type AppStoreConnectRetry } from "./appStoreConnectClient";

const origin = "https://api.appstoreconnect.apple.com";

test("App Store Connect discovery and downloads honor source cancellation over real HTTPS", { timeout: 90_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "asc-transport-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  const previousDispatcher = getGlobalDispatcher();
  const requests: Array<string> = [];
  const retries: Array<AppStoreConnectRetry> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const counts = new Map<string, number>();
  const discoveryRequests: Array<string> = [];
  const pendingDiscoveryResponses = new Set<string>();
  let maximumDiscovery = 0;
  let completedCatalogPages = 0;
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
    const discoveryApp = url.pathname.match(/^\/v1\/apps\/discovery-([^/]+)\/analyticsReportRequests$/);
    const discoveryReports = url.pathname.match(/^\/v1\/analyticsReportRequests\/(catalog|terminal|malformed|deadline|lock)-([ab])\/reports$/);
    const discoveryInstances = url.pathname.match(/^\/v1\/analyticsReports\/(catalog|terminal|malformed|deadline|lock)-(\d+)\/instances$/);
    const page = (data: ReadonlyArray<object>, next: string | null): void => {
      pendingDiscoveryResponses.delete(url.href);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data, links: { next } }));
    };
    if (discoveryApp !== null) {
      const second = url.searchParams.has("page");
      page([{
        id: discoveryApp[1] + (second ? "-b" : "-a"), type: "analyticsReportRequests",
        attributes: { accessType: second ? "ONE_TIME_SNAPSHOT" : "ONGOING" },
      }], second ? null : origin + url.pathname + "?page=2");
      return;
    }
    if (discoveryReports !== null) {
      const catalog = discoveryReports[1] === "catalog";
      const second = url.searchParams.has("page");
      const offset = (discoveryReports[2] === "a" ? 0 : catalog ? 175 : 12) + (second ? 100 : 0);
      const size = catalog ? second ? 75 : 100 : 12;
      const next = catalog && !second ? origin + url.pathname + "?page=2" : null;
      const timer = setTimeout(() => {
        if (catalog) completedCatalogPages += 1;
        page(Array.from({ length: size }, (_, index) => ({
          id: discoveryReports[1] + "-" + (offset + index), type: "analyticsReports",
          attributes: { name: "Fixture report " + (offset + index) },
        })), next);
      }, 5);
      timers.add(timer);
      return;
    }
    if (discoveryInstances !== null) {
      const scenario = discoveryInstances[1];
      const index = Number(discoveryInstances[2]);
      if (scenario === "catalog") assert.equal(completedCatalogPages, 4);
      discoveryRequests.push(url.pathname + url.search);
      pendingDiscoveryResponses.add(url.href);
      maximumDiscovery = Math.max(maximumDiscovery, pendingDiscoveryResponses.size);
      response.once("close", () => { pendingDiscoveryResponses.delete(url.href); });
      if (scenario === "deadline" || scenario === "lock") {
        if (index % 3 === 0) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write('{"data":[');
        } else if (index % 3 === 1) {
          pendingDiscoveryResponses.delete(url.href);
          response.writeHead(500);
          response.end("provider busy");
        }
        return;
      }
      const timer = setTimeout(() => {
        if (index === 0 && scenario === "terminal") {
          pendingDiscoveryResponses.delete(url.href);
          response.writeHead(403);
          response.end("discovery denied");
          return;
        }
        if (index === 0 && scenario === "malformed") {
          page([{ id: "incomplete" }], null);
          return;
        }
        const second = url.searchParams.has("page");
        const next = scenario === "catalog" && index % 17 === 0 && !second
          ? origin + url.pathname + "?page=2" : null;
        page([{
          id: scenario + "-" + index + "-instance-" + (second ? 1 : 0), type: "analyticsReportInstances",
          attributes: { granularity: "DAILY", processingDate: "2026-11-02" },
        }], next);
      }, scenario === "catalog" ? 8 + index % 7 * 4 : index === 0 ? 20 : 100);
      timers.add(timer);
      return;
    }
    if (url.pathname === "/segment/long-download") {
      timers.add(setTimeout(() => response.end("complete long segment"), 31_000));
      return;
    }
    if (url.pathname.includes("metadata-stall") && count === 1) return;
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
      response.writeHead(url.pathname.includes("429") ? 429 : 503);
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
      assert.equal((await active.listReportRequests("retry-429-recovery")).length, 1);
      assert.equal(counts.get("/v1/apps/retry-429-recovery/analyticsReportRequests"), 2);
      assert.deepEqual(retries.at(-1), {
        label: "GET /v1/apps/retry-429-recovery/analyticsReportRequests?limit=200", attempt: 1, status: 429,
      });
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

    await t.test("all 350 reports and their pages complete with ordered context and at most eight overlapping listings", async () => {
      const active = client(Date.now() + 10_000, new AbortController().signal);
      const catalogRequests = await active.listReportRequests("discovery-catalog");
      const before = discoveryRequests.length;
      maximumDiscovery = 0;
      const result = await listPendingInstances(active, catalogRequests);
      assert.equal(result.reports, 350);
      const expected = Array.from({ length: 350 }, (_, index) => [0, ...(index % 17 === 0 ? [1] : [])]
        .map((page) => ({
          reportId: "catalog-" + index, reportName: "Fixture report " + index,
          instanceId: "catalog-" + index + "-instance-" + page, granularity: "DAILY", processingDate: "2026-11-02",
          table: "apple_other_report_rows", detailLevel: "single",
        }))).flat();
      assert.deepEqual(result.listed.map(({ report, instance, variant }) => ({
        reportId: report.id, reportName: report.name, instanceId: instance.id,
        granularity: instance.granularity, processingDate: instance.processingDate,
        table: variant.table.tableName, detailLevel: variant.detailLevel,
      })), expected);
      assert.equal(discoveryRequests.length - before, expected.length);
      assert.equal(new Set(discoveryRequests.slice(before)).size, expected.length);
      assert.equal(maximumDiscovery, 8);
      assert.equal(pendingDiscoveryResponses.size, 0);
      t.diagnostic(JSON.stringify({ reports: result.reports, instances: result.listed.length, maximumDiscovery }));
    });

    await t.test("terminal and malformed inventories stop report admissions and drain siblings before rejecting", async () => {
      for (const scenario of ["terminal", "malformed"]) {
        const active = client(Date.now() + 5_000, new AbortController().signal);
        const catalogRequests = await active.listReportRequests("discovery-" + scenario);
        const before = discoveryRequests.length;
        const started = Date.now();
        await assert.rejects(listPendingInstances(active, catalogRequests), scenario === "terminal"
          ? /HTTP 403: discovery denied/ : /unexpected data\[0\]/);
        assert.ok(Date.now() - started >= 90, "discovery must await slower admitted siblings");
        assert.equal(discoveryRequests.length - before, 8);
        assert.equal(pendingDiscoveryResponses.size, 0);
        await new Promise<void>((resolve) => { timers.add(setTimeout(resolve, 120)); });
        assert.equal(discoveryRequests.length - before, 8, "no late report admission after rejection");
      }
    });

    await t.test("deadline and lock loss drain concurrent headers, bodies and retry waits without more admissions", async () => {
      for (const scenario of ["deadline", "lock"]) {
        const controller = new AbortController();
        const started = Date.now();
        const active = client(started + (scenario === "deadline" ? 300 : 5_000), controller.signal);
        const catalogRequests = await active.listReportRequests("discovery-" + scenario);
        const before = discoveryRequests.length;
        const retryCount = retries.length;
        if (scenario === "lock") {
          timers.add(setTimeout(() => controller.abort(new Error("local discovery lock lost")), 150));
        }
        await assert.rejects(listPendingInstances(active, catalogRequests),
          scenario === "deadline" ? /deadline exceeded/ : /import aborted/);
        assert.ok(Date.now() - started < 1_500);
        assert.equal(discoveryRequests.length - before, 8);
        assert.equal(retries.length - retryCount, 3);
        // Native fetch has settled; allow the server to observe the cancelled TLS sockets.
        await new Promise<void>((resolve) => { timers.add(setTimeout(resolve, 120)); });
        assert.equal(pendingDiscoveryResponses.size, 0);
        assert.equal(discoveryRequests.length - before, 8);
        assert.equal(retries.length - retryCount, 3);
      }
    });

    await t.test("a stalled metadata attempt retries while a segment may download beyond that ceiling", { timeout: 40_000 }, async () => {
      const started = Date.now();
      const retryCount = retries.length;
      const active = client(started + 45_000, new AbortController().signal);
      const [result, segment] = await Promise.all([
        active.listReportRequests("metadata-stall"),
        active.downloadSegment(origin + "/segment/long-download", "long segment"),
      ]);
      assert.equal(segment.toString("utf8"), "complete long segment");
      assert.equal(counts.get("/segment/long-download"), 1);
      assert.equal(result.length, 1);
      assert.ok(Date.now() - started >= 30_000 && Date.now() - started < 38_000);
      assert.equal(counts.get("/v1/apps/metadata-stall/analyticsReportRequests"), 2);
      assert.deepEqual(retries.slice(retryCount), [{
        label: "GET /v1/apps/metadata-stall/analyticsReportRequests?limit=200", attempt: 1, status: null,
      }]);
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
