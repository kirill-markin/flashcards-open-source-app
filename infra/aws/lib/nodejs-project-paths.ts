import * as path from "path";

export interface NodejsProjectPaths {
  projectRoot: string;
  depsLockFilePath: string;
}

function resolveInfraAwsRootPath(): string {
  const parentDirectoryName = path.basename(path.dirname(__dirname));
  return parentDirectoryName === "dist"
    ? path.resolve(__dirname, "../..")
    : path.resolve(__dirname, "..");
}

const infraAwsRootPath = resolveInfraAwsRootPath();
const repoRootPath = path.resolve(infraAwsRootPath, "../..");
const authProjectRootPath = path.join(repoRootPath, "apps", "auth");
const backendProjectRootPath = path.join(repoRootPath, "apps", "backend");

export const infraAwsNodejsProjectPaths: NodejsProjectPaths = {
  projectRoot: infraAwsRootPath,
  depsLockFilePath: path.join(infraAwsRootPath, "package-lock.json"),
};

export const authNodejsProjectPaths: NodejsProjectPaths = {
  projectRoot: authProjectRootPath,
  depsLockFilePath: path.join(authProjectRootPath, "package-lock.json"),
};

export const backendNodejsProjectPaths: NodejsProjectPaths = {
  projectRoot: backendProjectRootPath,
  depsLockFilePath: path.join(backendProjectRootPath, "package-lock.json"),
};

export function resolveFromRepoRoot(...segments: ReadonlyArray<string>): string {
  return path.join(repoRootPath, ...segments);
}
