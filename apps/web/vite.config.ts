import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import webPackageInfo from "./package.json";

type SentrySourceMapUploadConfig = Readonly<{
  authToken: string;
  org: string;
  project: string;
  releaseName: string;
}>;

type RequiredSentryUploadEnvName =
  | "SENTRY_AUTH_TOKEN"
  | "SENTRY_ORG"
  | "SENTRY_PROJECT";

const REQUIRED_SENTRY_UPLOAD_ENV_NAMES: readonly RequiredSentryUploadEnvName[] = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
];

function resolveBuildId(): string {
  const buildId = process.env.VITE_APP_BUILD?.trim();
  return buildId === undefined || buildId === "" ? "local" : buildId;
}

function resolveWebRelease(): string {
  return `web@${webPackageInfo.version}+${resolveBuildId()}`;
}

function resolveOptionalEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function isSentrySourceMapUploadEnabled(): boolean {
  return resolveOptionalEnvValue("SENTRY_UPLOAD_SOURCEMAPS") === "true";
}

function resolveMissingSentryUploadEnvNames(): readonly RequiredSentryUploadEnvName[] {
  return REQUIRED_SENTRY_UPLOAD_ENV_NAMES.filter(
    (name) => resolveOptionalEnvValue(name) === undefined,
  );
}

function resolveSentrySourceMapUploadConfig(
  command: string,
): SentrySourceMapUploadConfig | undefined {
  if (command !== "build" || !isSentrySourceMapUploadEnabled()) {
    return undefined;
  }

  const sentryDsn = resolveOptionalEnvValue("VITE_SENTRY_DSN");
  if (sentryDsn === undefined) {
    return undefined;
  }

  const authToken = resolveOptionalEnvValue("SENTRY_AUTH_TOKEN");
  const org = resolveOptionalEnvValue("SENTRY_ORG");
  const project = resolveOptionalEnvValue("SENTRY_PROJECT");

  if (authToken === undefined || org === undefined || project === undefined) {
    const missingEnvNames = resolveMissingSentryUploadEnvNames();
    throw new Error(
      `SENTRY_UPLOAD_SOURCEMAPS is true and VITE_SENTRY_DSN is configured, but Sentry source map upload is missing required environment variables: ${missingEnvNames.join(
        ", ",
      )}. Configure SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT, or unset VITE_SENTRY_DSN to disable Sentry for this build.`,
    );
  }

  return {
    authToken,
    org,
    project,
    releaseName: resolveWebRelease(),
  };
}

export default defineConfig(({ command }) => {
  const sentrySourceMapUploadConfig = resolveSentrySourceMapUploadConfig(command);
  const shouldUploadSentrySourceMaps = sentrySourceMapUploadConfig !== undefined;

  return {
    plugins: [
      react(),
      ...(sentrySourceMapUploadConfig !== undefined
        ? sentryVitePlugin({
            org: sentrySourceMapUploadConfig.org,
            project: sentrySourceMapUploadConfig.project,
            authToken: sentrySourceMapUploadConfig.authToken,
            release: {
              name: sentrySourceMapUploadConfig.releaseName,
            },
            sourcemaps: {
              filesToDeleteAfterUpload: "dist/**/*.map",
            },
          })
        : []),
    ],
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
    },
    build: {
      chunkSizeWarningLimit: 2800,
      sourcemap: shouldUploadSentrySourceMaps,
    },
    test: {
      environment: "jsdom",
      environmentOptions: {
        jsdom: {
          url: "http://localhost:3000/",
        },
      },
    },
  };
});
