import { resolveFromRepoRoot } from "./nodejs-project-paths";

const defaultBackendSentryCliPath = resolveFromRepoRoot("apps", "backend", "node_modules", ".bin", "sentry-cli");

export function createSentrySourceMapInjectionCommand(outputDir: string): string {
  return [
    `backend_sentry_cli_path="\${SENTRY_BACKEND_CLI_PATH:-${defaultBackendSentryCliPath}}";`,
    `if [ ! -x "$backend_sentry_cli_path" ]; then echo "Sentry CLI not found or not executable at $backend_sentry_cli_path. Run npm ci --prefix apps/backend before CDK synth." >&2; exit 1; fi;`,
    // Injection hashes the emitted JS and map, without credentials or release metadata.
    `"$backend_sentry_cli_path" sourcemaps inject "${outputDir}" || exit "$?";`,
  ].join(" ");
}

export function getDockerSentryCliPath(repoRootMount: string): string {
  if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) {
    throw new Error("Docker Sentry injection requires a Linux x64 or arm64 CI runner");
  }

  // Use the statically linked Linux binary directly: the Node wrapper would select
  // the container architecture, whose optional package is absent on QEMU runners.
  return `${repoRootMount}/apps/backend/node_modules/@sentry/cli-linux-${process.arch}/bin/sentry-cli`;
}
