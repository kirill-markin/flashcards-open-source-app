import * as lambda from "aws-cdk-lib/aws-lambda";

/**
 * Logging configuration for every Lambda that bundles backend code.
 *
 * `writeCloudWatchRecord` in `apps/backend/src/observability/cloudWatch.ts` hands its structured
 * record to `console` as an object. Under the runtime's default TEXT format that object is printed
 * through `util.inspect`, which is neither JSON nor addressable; under JSON format the runtime nests
 * it under `message`, the whole log event becomes a JSON document, and `$.message.<field>` resolves
 * for a CloudWatch metric filter. That is the only reason a log-derived alarm can exist at all, and
 * it is why this is shared configuration rather than a per-function choice: a backend Lambda left on
 * TEXT format emits `util.inspect` output for the same records every other surface emits as JSON,
 * which is a silent readability regression that no test would catch.
 *
 * The application log level is pinned to INFO because breadcrumbs are emitted with `console.log`,
 * which maps to INFO: a coarser level would drop the records these alarms count. The system level is
 * pinned alongside it so the platform's own defaults cannot move either one.
 *
 * Spread this into every `NodejsFunction` whose entry can reach `writeCloudWatchRecord`. Lambdas
 * that bundle no backend code (`apps/auth`, and the handlers under `infra/aws/lambda/`) emit no such
 * record and are deliberately left on the runtime default. They still pre-serialize their own log
 * lines, which is why "one record shape, never pre-serialized" is a statement about backend records
 * rather than about every line in the repository: those services are separate, are read on their own
 * log groups, and are not covered by `docs/agent-sql-telemetry.md`.
 */
export const backendStructuredLoggingProps = {
  loggingFormat: lambda.LoggingFormat.JSON,
  applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
  systemLogLevelV2: lambda.SystemLogLevel.INFO,
} as const;
