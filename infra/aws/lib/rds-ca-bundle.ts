import { resolveFromRepoRoot } from "./nodejs-project-paths";

export const rdsCaBundlePath = resolveFromRepoRoot(".cache", "lambda-build", "rds-global-bundle.pem");

export function createRdsCaBundleCopyCommand(outputDir: string, sourcePath: string): string {
  return `cp "${sourcePath}" "${outputDir}/rds-global-bundle.pem"`;
}
