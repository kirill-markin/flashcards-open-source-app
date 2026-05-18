import { resolveFromRepoRoot } from "./nodejs-project-paths";

const backendSentryCliPath = resolveFromRepoRoot("apps", "backend", "node_modules", ".bin", "sentry-cli");
const sentrySourceMapUploadMaxAttempts = 3;

export function createSentrySourceMapUploadCommand(outputDir: string): string {
  return [
    `if [ "$SENTRY_UPLOAD_BACKEND_SOURCEMAPS" != "true" ]; then`,
    `echo "Sentry backend source map upload disabled. Set SENTRY_UPLOAD_BACKEND_SOURCEMAPS=true in GitHub Actions to enable it.";`,
    `elif [ "$GITHUB_ACTIONS" != "true" ]; then`,
    `echo "WARNING: SENTRY_UPLOAD_BACKEND_SOURCEMAPS=true ignored because backend source map upload is only enabled in GitHub Actions." >&2;`,
    `else`,
    `missing_sentry_env="";`,
    `[ -n "$SENTRY_AUTH_TOKEN" ] || missing_sentry_env="$missing_sentry_env SENTRY_AUTH_TOKEN";`,
    `[ -n "$SENTRY_ORG" ] || missing_sentry_env="$missing_sentry_env SENTRY_ORG";`,
    `[ -n "$SENTRY_PROJECT" ] || missing_sentry_env="$missing_sentry_env SENTRY_PROJECT";`,
    `[ -n "$SENTRY_RELEASE" ] || missing_sentry_env="$missing_sentry_env SENTRY_RELEASE";`,
    `if [ -n "$missing_sentry_env" ]; then echo "Missing required Sentry source map upload environment variables:$missing_sentry_env" >&2; exit 1; fi;`,
    `if [ ! -x "${backendSentryCliPath}" ]; then echo "Sentry CLI not found or not executable at ${backendSentryCliPath}. Run npm ci --prefix apps/backend before CDK deploy." >&2; exit 1; fi;`,
    `run_sentry_command_with_retries() { sentry_command_name="$1"; shift; sentry_attempt=1; while true; do sentry_status=0; "$@" || sentry_status="$?"; if [ "$sentry_status" -eq 0 ]; then return 0; fi; if [ "$sentry_attempt" -ge "${sentrySourceMapUploadMaxAttempts}" ]; then echo "Sentry \${sentry_command_name} failed after \${sentry_attempt} attempts with exit status \${sentry_status}." >&2; return "$sentry_status"; fi; sentry_next_attempt=$((sentry_attempt + 1)); echo "WARNING: Sentry \${sentry_command_name} failed with exit status \${sentry_status}; retrying attempt \${sentry_next_attempt}/${sentrySourceMapUploadMaxAttempts}." >&2; sentry_attempt="$sentry_next_attempt"; sleep "$sentry_attempt"; done; };`,
    `run_sentry_command_with_retries "source map inject" "${backendSentryCliPath}" sourcemaps inject "${outputDir}" || exit "$?";`,
    `run_sentry_command_with_retries "source map upload" "${backendSentryCliPath}" sourcemaps upload "${outputDir}" --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" --release "$SENTRY_RELEASE" || exit "$?";`,
    `fi`,
  ].join(" ");
}
