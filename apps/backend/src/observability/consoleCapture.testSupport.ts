// Shared by every test that swaps `console` out to read the structured records this module emits.
// It lives here, apart from ./sentry/testHelpers, so that importing it does not also load
// `@sentry/aws-serverless`: two of the tests using it do not otherwise pull Sentry into their
// process, and a capture helper is not a reason to start.
//
// The backend hands `console` a record object rather than pre-serialized JSON (./cloudWatch.ts), so
// every one of those captures has to re-serialize it for the assertions. `JSON.stringify` alone is
// not enough: it answers `undefined` for `undefined` and for a function, which would put a
// non-string into an `Array<string>` and make the next `.includes` on that array throw an error
// with nothing to do with the assertion that actually failed. It also flattens an `Error` to `"{}"`,
// hiding exactly the detail a failing test needs, and it throws outright on a circular or BigInt
// value. So anything that is not a plain serializable record is rendered rather than serialized,
// and the return type is a string in every case.
export function formatCapturedConsoleMessage(message?: unknown): string {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof Error) {
    return message.stack ?? `${message.name}: ${message.message}`;
  }

  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}
