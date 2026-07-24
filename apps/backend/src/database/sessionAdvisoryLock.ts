import pg from "pg";
import { getDatabaseUrl } from "./config";
import { logDatabasePoolError, toDatabaseBoundaryError } from "./transient";

const lockPoolName = "session-advisory-lock";
const lockPoolMaximumClients = 2;
const lockAdmissionMaximumPendingCount = 8;
const lockClientConnectionTimeoutMs = 5_000;
const lockPoolCheckoutAttemptTimeoutMs = 5_500;
const unlockQueryTimeoutMs = 5_000;
const poolCheckoutTimeoutMessage = "timeout exceeded when trying to connect";
const connectionTimeoutMessages = new Set(["timeout expired", "Connection terminated due to connection timeout"]);
let lockPoolPromise: Promise<pg.Pool> | undefined;
let activeLockAdmissionCount = 0;
const pendingLockAdmissions: Array<() => void> = [];
export type SessionAdvisoryLockInput = Readonly<{
  lockName: string; lockKey: string; timeoutMs: number; pollIntervalMs: number;
  signal: AbortSignal;
}>;
type LockRow = Readonly<{ acquired: boolean }>;
type UnlockRow = Readonly<{ unlocked: boolean }>;
type LockClientLease = Readonly<{ client: pg.PoolClient; releaseAdmission: () => void }>;
class SessionAdvisoryLockClient extends pg.Client {
  constructor(config?: pg.ClientConfig) {
    super({ ...config, connectionTimeoutMillis: lockClientConnectionTimeoutMs });
  }
}
class SessionAdvisoryLockConnectionTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor(cause: Error) {
    super(
      `PostgreSQL session advisory lock connection timed out. timeoutMs=${lockClientConnectionTimeoutMs}`,
      { cause },
    );
    this.name = "SessionAdvisoryLockConnectionTimeoutError";
  }
}
class SessionAdvisoryLockQueryUncertainError extends Error {
  constructor(readonly operationError: unknown) {
    super("Session advisory lock query completion could not be confirmed.", { cause: operationError });
    this.name = "SessionAdvisoryLockQueryUncertainError";
  }
}
export class SessionAdvisoryLockAbortedError extends Error {
  constructor(readonly lockName: string, cause: unknown) {
    super(`Session advisory lock acquisition was aborted. lockName=${lockName}`, { cause });
    this.name = "SessionAdvisoryLockAbortedError";
  }
}
export class SessionAdvisoryLockTimeoutError extends Error {
  constructor(readonly lockName: string, readonly timeoutMs: number) {
    super(`Session advisory lock acquisition timed out. lockName=${lockName}; timeoutMs=${timeoutMs}`);
    this.name = "SessionAdvisoryLockTimeoutError";
  }
}
export class SessionAdvisoryLockCapacityError extends Error {
  constructor(readonly lockName: string, readonly maximumPendingCount: number) {
    super(`Session advisory lock admission queue is full. lockName=${lockName}; maximumPendingCount=${maximumPendingCount}`);
    this.name = "SessionAdvisoryLockCapacityError";
  }
}
async function createLockPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: await getDatabaseUrl(),
    ssl: process.env.DB_SECRET_ARN ? true : false,
    max: lockPoolMaximumClients,
    Client: SessionAdvisoryLockClient,
    connectionTimeoutMillis: lockPoolCheckoutAttemptTimeoutMs,
    application_name: "backend-session-advisory-lock",
  });
  pool.on("error", (error: Error): void => logDatabasePoolError(lockPoolName, error));
  return pool;
}
function getLockPool(): Promise<pg.Pool> {
  if (lockPoolPromise === undefined) {
    let retryablePromise: Promise<pg.Pool>;
    retryablePromise = createLockPool().catch((error: unknown) => {
      if (lockPoolPromise === retryablePromise) lockPoolPromise = undefined;
      throw error;
    });
    lockPoolPromise = retryablePromise;
  }
  return lockPoolPromise;
}
function abortError(input: SessionAdvisoryLockInput): SessionAdvisoryLockAbortedError {
  return new SessionAdvisoryLockAbortedError(input.lockName, input.signal.reason);
}
function timeoutError(input: SessionAdvisoryLockInput): SessionAdvisoryLockTimeoutError {
  return new SessionAdvisoryLockTimeoutError(input.lockName, input.timeoutMs);
}
function isPoolCheckoutTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === poolCheckoutTimeoutMessage;
}
export function toSessionAdvisoryLockConnectionBoundaryError(error: unknown): unknown {
  const normalizedError = error instanceof Error && connectionTimeoutMessages.has(error.message)
    ? new SessionAdvisoryLockConnectionTimeoutError(error)
    : error;
  return toDatabaseBoundaryError(normalizedError);
}
function releaseLockAdmission(): void {
  const nextAdmission = pendingLockAdmissions.shift();
  if (nextAdmission === undefined) {
    activeLockAdmissionCount -= 1;
    return;
  }
  nextAdmission();
}
function createLockAdmissionRelease(): () => void {
  let released = false;
  return () => {
    if (released) throw new Error("Session advisory lock admission was released more than once.");
    released = true;
    releaseLockAdmission();
  };
}
async function acquireLockAdmission(input: SessionAdvisoryLockInput, deadlineMs: number): Promise<() => void> {
  if (input.signal.aborted) throw abortError(input);
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw timeoutError(input);
  if (activeLockAdmissionCount < lockPoolMaximumClients) {
    activeLockAdmissionCount += 1;
    return createLockAdmissionRelease();
  }
  if (pendingLockAdmissions.length >= lockAdmissionMaximumPendingCount) {
    throw new SessionAdvisoryLockCapacityError(input.lockName, lockAdmissionMaximumPendingCount);
  }
  return new Promise<() => void>((resolve, reject) => {
    let queued = true;
    const cleanup = (): void => {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
    };
    const remove = (error: Error): void => {
      if (!queued) return;
      queued = false;
      cleanup();
      const index = pendingLockAdmissions.indexOf(grant);
      if (index >= 0) pendingLockAdmissions.splice(index, 1);
      reject(error);
    };
    const grant = (): void => {
      if (!queued) return;
      queued = false;
      cleanup();
      if (input.signal.aborted) {
        reject(abortError(input));
        releaseLockAdmission();
      } else if (Date.now() >= deadlineMs) {
        reject(timeoutError(input));
        releaseLockAdmission();
      } else {
        resolve(createLockAdmissionRelease());
      }
    };
    const onAbort = (): void => remove(abortError(input));
    const timer = setTimeout(() => remove(timeoutError(input)), remainingMs);
    pendingLockAdmissions.push(grant);
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
  });
}
function validateInput(input: SessionAdvisoryLockInput): void {
  if (input.lockName.trim() === "" || input.lockKey.trim() === "") {
    throw new Error("Session advisory lock name and key must not be empty.");
  }
  if (Number.isSafeInteger(input.timeoutMs) === false || input.timeoutMs < 1
      || Number.isSafeInteger(input.pollIntervalMs) === false || input.pollIntervalMs < 1) {
    throw new RangeError("Session advisory lock timeout and poll interval must be positive safe integers.");
  }
}

async function connectLockClientAttempt(
  input: SessionAdvisoryLockInput,
  deadlineMs: number,
  onClientError: (error: Error) => void,
  releaseAdmission: () => void,
): Promise<LockClientLease> {
  if (input.signal.aborted) {
    releaseAdmission();
    throw abortError(input);
  }
  if (Date.now() >= deadlineMs) {
    releaseAdmission();
    throw timeoutError(input);
  }
  const connectPromise = getLockPool().then((pool) => pool.connect());
  return new Promise<LockClientLease>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => settle(() => reject(abortError(input)));
    const timer = setTimeout(() => settle(() => reject(timeoutError(input))),
      Math.max(0, deadlineMs - Date.now()));
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    void connectPromise.then(
      (client) => {
        if (settled) {
          client.release();
          releaseAdmission();
          return;
        }
        client.on("error", onClientError);
        settle(() => resolve({ client, releaseAdmission }));
      },
      (error: unknown) => {
        releaseAdmission();
        settle(() => reject(error));
      },
    ).catch((error: unknown) => logDatabasePoolError(lockPoolName, error));
  });
}

async function connectLockClient(
  input: SessionAdvisoryLockInput,
  deadlineMs: number,
  onClientError: (error: Error) => void,
): Promise<LockClientLease> {
  while (true) {
    const releaseAdmission = await acquireLockAdmission(input, deadlineMs);
    try {
      return await connectLockClientAttempt(input, deadlineMs, onClientError, releaseAdmission);
    } catch (error) {
      if (error instanceof SessionAdvisoryLockAbortedError
          || error instanceof SessionAdvisoryLockTimeoutError) {
        throw error;
      }
      if (isPoolCheckoutTimeout(error) === false) {
        throw toSessionAdvisoryLockConnectionBoundaryError(error);
      }
      if (input.signal.aborted) throw abortError(input);
      if (Date.now() >= deadlineMs) throw timeoutError(input);
    }
  }
}

async function queryLockAttempt(
  client: pg.PoolClient,
  input: SessionAdvisoryLockInput,
  deadlineMs: number,
): Promise<pg.QueryResult<LockRow>> {
  if (input.signal.aborted) throw abortError(input);
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw timeoutError(input);

  let queryPromise: Promise<pg.QueryResult<LockRow>>;
  try {
    queryPromise = client.query<LockRow>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 3::bigint)) AS acquired", [input.lockKey],
    );
  } catch (error) {
    throw new SessionAdvisoryLockQueryUncertainError(toDatabaseBoundaryError(error));
  }

  return new Promise<pg.QueryResult<LockRow>>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      callback();
    };
    const rejectUncertain = (error: unknown): void => settle(
      () => reject(new SessionAdvisoryLockQueryUncertainError(error)),
    );
    const onAbort = (): void => rejectUncertain(abortError(input));
    const timer = setTimeout(() => rejectUncertain(timeoutError(input)), remainingMs);
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    void queryPromise.then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => rejectUncertain(toDatabaseBoundaryError(error)),
    );
  });
}

async function waitToPoll(input: SessionAdvisoryLockInput, deadlineMs: number): Promise<void> {
  if (input.signal.aborted) throw abortError(input);
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw timeoutError(input);
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(abortError(input)); };
    const timer = setTimeout(() => {
      input.signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.min(input.pollIntervalMs, remainingMs));
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
  });
}

async function acquireLock(
  client: pg.PoolClient, input: SessionAdvisoryLockInput, deadlineMs: number,
): Promise<void> {
  while (Date.now() < deadlineMs) {
    const result = await queryLockAttempt(client, input, deadlineMs);
    if (result.rows[0]?.acquired === true) return;
    if (result.rows[0]?.acquired !== false) {
      throw new Error(`PostgreSQL returned an invalid advisory lock result. lockName=${input.lockName}`);
    }
    await waitToPoll(input, deadlineMs);
  }
  throw timeoutError(input);
}

async function queryUnlock(client: pg.PoolClient, input: SessionAdvisoryLockInput): Promise<pg.QueryResult<UnlockRow>> {
  const queryPromise = client.query<UnlockRow>(
    "SELECT pg_advisory_unlock(hashtextextended($1, 3::bigint)) AS unlocked", [input.lockKey],
  );

  return new Promise<pg.QueryResult<UnlockRow>>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => settle(() => reject(new Error(
        `Session advisory unlock query timed out. lockName=${input.lockName}; timeoutMs=${unlockQueryTimeoutMs}`,
      ))), unlockQueryTimeoutMs);
    void queryPromise.then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

async function unlock(client: pg.PoolClient, input: SessionAdvisoryLockInput): Promise<void> {
  try {
    const result = await queryUnlock(client, input);
    if (result.rows[0]?.unlocked !== true) {
      throw new Error("PostgreSQL reported that the session did not own the advisory lock.");
    }
  } catch (error) {
    throw Object.assign(
      new Error(`Session advisory lock could not be confirmed as unlocked. lockName=${input.lockName}`, { cause: error }),
      { name: "SessionAdvisoryLockUnlockError" },
    );
  }
}

async function cleanupLockClient(
  client: pg.PoolClient,
  input: SessionAdvisoryLockInput,
  acquired: boolean,
  readConnectionError: () => Error | undefined,
  onClientError: (error: Error) => void,
): Promise<Error | undefined> {
  let cleanupError: Error | undefined;
  try {
    if (acquired && readConnectionError() === undefined) await unlock(client, input);
  } catch (error) {
    cleanupError = error instanceof Error ? error : new Error(String(error));
  }
  try {
    client.release(readConnectionError() ?? cleanupError);
  } catch (error) {
    const releaseError = Object.assign(new Error(
      `Session advisory lock connection could not be released. lockName=${input.lockName}`, { cause: error },
    ), { name: "SessionAdvisoryLockReleaseError" });
    if (cleanupError === undefined) cleanupError = releaseError;
    else logDatabasePoolError(`${lockPoolName}-cleanup`, releaseError);
  } finally {
    client.removeListener("error", onClientError);
  }
  return cleanupError;
}

export async function withSessionAdvisoryLock<Result>(
  input: SessionAdvisoryLockInput,
  callback: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  validateInput(input);
  const deadlineMs = Date.now() + input.timeoutMs;
  const lockLossController = new AbortController();
  let clientError: Error | undefined;
  const onClientError = (error: Error): void => {
    if (clientError !== undefined) return;
    clientError = error;
    lockLossController.abort(error);
  };
  const { client, releaseAdmission } = await connectLockClient(input, deadlineMs, onClientError);
  const callbackSignal = AbortSignal.any([input.signal, lockLossController.signal]);
  const activeInput: SessionAdvisoryLockInput = { ...input, signal: callbackSignal };
  let acquired = false;
  let succeeded = false;
  let primaryError: unknown;
  let connectionError: Error | undefined;
  let result!: Result;
  try {
    if (clientError !== undefined) throw clientError;
    await acquireLock(client, activeInput, deadlineMs);
    acquired = true;
    if (callbackSignal.aborted) throw abortError(activeInput);
    if (Date.now() >= deadlineMs) throw timeoutError(activeInput);
    result = await callback(callbackSignal);
    if (clientError !== undefined) throw clientError;
    succeeded = true;
  } catch (error) {
    if (clientError !== undefined) {
      connectionError = clientError;
      primaryError = toDatabaseBoundaryError(clientError);
    } else if (error instanceof SessionAdvisoryLockQueryUncertainError) {
      connectionError = error;
      primaryError = error.operationError;
    } else {
      primaryError = error;
    }
  }
  let cleanupError: Error | undefined;
  try {
    cleanupError = await cleanupLockClient(
      client, activeInput, acquired, () => clientError ?? connectionError, onClientError,
    );
  } finally {
    releaseAdmission();
  }
  if (succeeded === false) {
    if (cleanupError !== undefined) logDatabasePoolError(`${lockPoolName}-cleanup`, cleanupError);
    throw primaryError;
  }
  if (clientError !== undefined) {
    if (cleanupError !== undefined) logDatabasePoolError(`${lockPoolName}-cleanup`, cleanupError);
    throw toDatabaseBoundaryError(clientError);
  }
  if (cleanupError !== undefined) throw cleanupError;
  return result;
}

export async function closeSessionAdvisoryLockPoolForTests(): Promise<void> {
  const poolPromise = lockPoolPromise;
  lockPoolPromise = undefined;
  if (poolPromise !== undefined) await (await poolPromise).end();
}

export function readSessionAdvisoryLockWaitingCountForTests(): number {
  return pendingLockAdmissions.length;
}
