import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { LAMBDA_NODEJS_SDK_V3_EXCLUDE_SMITHY_PACKAGES } from "aws-cdk-lib/cx-api";
import { Construct } from "constructs";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as esbuild from "esbuild";
import * as ts from "typescript";
import { infraAwsNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";

interface CachedFunctionProps extends lambdaNodejs.NodejsFunctionProps {
  readonly copiedAssetPaths?: ReadonlyArray<string>;
}

const supportedBundlingOptions = new Set([
  "minify", "sourceMap", "bundleAwsSDK", "nodeModules", "forceDockerBundling",
  "volumes", "environment", "commandHooks",
]);
const repoRoot = resolveFromRepoRoot();

interface NpmLockfile {
  readonly lockfileVersion: number;
  readonly packages: Readonly<Record<string, { readonly resolved?: string; readonly link?: boolean }>>;
}

function assertRegistryDependencies(file: string): void {
  const lock = JSON.parse(fs.readFileSync(file, "utf8")) as NpmLockfile;
  if (lock.lockfileVersion !== 3 || lock.packages === undefined) {
    throw new Error(`Lambda cache requires npm lockfile v3: ${file}`);
  }
  for (const [name, dependency] of Object.entries(lock.packages)) {
    if (dependency.link === true || dependency.resolved?.startsWith("file:")) {
      throw new Error(`Local/linked dependency needs explicit cache input support: ${file}: ${name}`);
    }
  }
}

function relativePath(file: string): string {
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Lambda build input is outside the repository: ${file}`);
  }
  return relative;
}

function filesUnder(file: string): Array<string> {
  const stat = fs.lstatSync(file);
  if (stat.isFile()) return [file];
  if (!stat.isDirectory()) throw new Error(`Unsupported Lambda input type: ${file}`);
  return fs.readdirSync(file).sort().flatMap((name) => filesUnder(path.join(file, name)));
}

function assertStaticImports(file: string): void {
  if (file.includes("/node_modules/") || !/\.[cm]?[jt]sx?$/.test(file)) return;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require"
          && node.expression.name.text === "resolve"))) {
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isStringLiteralLike(argument)) {
        throw new Error(`Nonliteral module loading is unsupported by the Lambda input cache: ${file}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function configurationFiles(input: string): Array<string> {
  const result: Array<string> = [];
  let directory = path.dirname(input);
  while (directory !== path.dirname(repoRoot)) {
    relativePath(directory);
    for (const name of ["package.json", "tsconfig.json", ".npmrc"]) {
      const file = path.join(directory, name);
      if (!fs.existsSync(file)) continue;
      if (name === "tsconfig.json" && file.includes("/node_modules/")) continue;
      result.push(file);
    }
    if (directory === repoRoot) break;
    directory = path.dirname(directory);
  }
  return result;
}

export function createCachedNodejsFunction(
  scope: Construct,
  id: string,
  props: CachedFunctionProps,
): lambdaNodejs.NodejsFunction {
  if (process.env.SENTRY_BACKEND_CLI_PATH !== undefined) {
    throw new Error("Lambda input cache requires the locked Sentry CLI; unset SENTRY_BACKEND_CLI_PATH on the synth host");
  }
  const { copiedAssetPaths, ...functionProps } = props;
  const bundling = props.bundling ?? {};
  if (bundling.sourceMap !== true) {
    throw new Error(`Lambda ${id} cache requires sourceMap:true for complete asset validation`);
  }
  for (const key of Object.keys(bundling)) {
    if (!supportedBundlingOptions.has(key)) {
      throw new Error(`Lambda ${id} bundling option needs cache input support: ${key}`);
    }
  }
  if (props.code !== undefined || props.entry === undefined || props.runtime !== lambda.Runtime.NODEJS_24_X) {
    throw new Error(`Lambda ${id} cache requires an explicit Node.js 24 entry and no supplied code`);
  }
  const projectRoot = props.projectRoot ?? infraAwsNodejsProjectPaths.projectRoot;
  const depsLockFilePath = props.depsLockFilePath ?? infraAwsNodejsProjectPaths.depsLockFilePath;
  const externalModules = bundling.bundleAwsSDK ? [] : [
    "@aws-sdk/*",
    ...(cdk.FeatureFlags.of(scope).isEnabled(LAMBDA_NODEJS_SDK_V3_EXCLUDE_SMITHY_PACKAGES) ? ["@smithy/*"] : []),
  ];
  // The graph uses the same resolver, version, target and externals as CDK's
  // bundler. write:false produces dependency metadata without staging an asset.
  const graph = esbuild.buildSync({
    absWorkingDir: projectRoot,
    entryPoints: [props.entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    minify: bundling.minify,
    external: [...externalModules, ...bundling.nodeModules ?? []],
    outfile: "index.js",
    logLevel: "warning",
  });
  if (graph.metafile === undefined) throw new Error(`Missing esbuild input graph for Lambda ${id}`);
  const inputs = Object.keys(graph.metafile.inputs).map((file) => path.resolve(projectRoot, file));
  inputs.forEach(assertStaticImports);
  const hookCommands = {
    beforeBundling: bundling.commandHooks?.beforeBundling("/asset-input", "/asset-output") ?? [],
    beforeInstall: bundling.commandHooks?.beforeInstall("/asset-input", "/asset-output") ?? [],
    afterBundling: bundling.commandHooks?.afterBundling("/asset-input", "/asset-output") ?? [],
  };
  if (hookCommands.beforeBundling.length > 0 || hookCommands.beforeInstall.length > 0) {
    throw new Error(`Lambda ${id} cache does not support hooks that modify graph inputs`);
  }
  const files = [...new Set([
    ...inputs,
    ...inputs.flatMap(configurationFiles),
    ...(copiedAssetPaths ?? []).flatMap(filesUnder),
    depsLockFilePath,
    ...["package.json", "package-lock.json", "tsconfig.json"].map((name) => resolveFromRepoRoot("infra", "aws", name)),
    // The injector is shared even by auth/infra Lambdas; its executable is
    // platform-specific and its package lock is independent of their locks.
    resolveFromRepoRoot("apps", "backend", "package-lock.json"),
    resolveFromRepoRoot("scripts", "deploy", "lambda-asset-cache.py"),
    resolveFromRepoRoot("scripts", "deploy", "prepare-lambda-build-inputs.sh"),
    ...(hookCommands.afterBundling.some((command) => command.includes("sourcemaps inject"))
      ? [fs.realpathSync(resolveFromRepoRoot("apps", "backend", "node_modules", "@sentry", `cli-linux-${process.arch}`, "bin", "sentry-cli"))]
      : []),
    ...["lambda-input-cache.ts", "rds-ca-bundle.ts", "sentry-source-maps.ts"].map((name) => resolveFromRepoRoot("infra", "aws", "lib", name)),
  ])].sort();
  const identity = crypto.createHash("sha256");
  identity.update(JSON.stringify({
    schema: 1,
    entry: relativePath(props.entry),
    handler: props.handler,
    runtime: props.runtime.name,
    architecture: (props.architecture ?? lambda.Architecture.X86_64).name,
    host: [process.platform, process.arch, process.version],
    esbuild: esbuild.version,
    bundling: { ...bundling, commandHooks: hookCommands },
  }).split(repoRoot).join("<repo>"));
  for (const file of files) {
    if (path.basename(file) === "package-lock.json") assertRegistryDependencies(file);
    if (path.basename(file) === "tsconfig.json") {
      const config = ts.readConfigFile(file, (name) => fs.readFileSync(name, "utf8"));
      if (config.error !== undefined) throw new Error(`Cannot read Lambda compiler configuration: ${file}`);
      if (config.config.extends !== undefined) {
        throw new Error(`Extended tsconfig requires explicit cache input support: ${file}`);
      }
    }
    identity.update(JSON.stringify([relativePath(file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
  }
  const outdir = cdk.Stage.of(scope)?.outdir;
  if (outdir === undefined) throw new Error(`Lambda ${id} requires a CDK Stage output directory`);
  const previousAssets = new Set(fs.existsSync(outdir) ? fs.readdirSync(outdir) : []);
  const fn = new lambdaNodejs.NodejsFunction(scope, id, {
    ...functionProps,
    projectRoot,
    depsLockFilePath,
    bundling: {
      ...bundling,
      externalModules,
      esbuildVersion: esbuild.version,
      assetHash: identity.digest("hex"),
    },
  });
  const resource = fn.node.defaultChild;
  if (!(resource instanceof lambda.CfnFunction)) throw new Error(`Lambda ${id} has no CfnFunction`);
  const code = cdk.Stack.of(fn).resolve(resource.code) as lambda.CfnFunction.CodeProperty;
  const assetHash = typeof code.s3Key === "string" ? /^([a-f0-9]{64})\.zip$/.exec(code.s3Key)?.[1] : undefined;
  if (assetHash === undefined) throw new Error(`Lambda ${id} has no staged asset identity`);
  const asset = `asset.${assetHash}`;
  const result = previousAssets.has(asset) ? "reused" : "built";
  execFileSync("python3", [
    resolveFromRepoRoot("scripts", "deploy", "lambda-asset-cache.py"), "verify", outdir, asset, result,
  ], { stdio: "inherit" });
  // These tiny reference files contain no CloudFormation context or credentials.
  const referenceDirectory = path.join(outdir, "lambda-cache-references");
  fs.mkdirSync(referenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(referenceDirectory, `${assetHash}.json`), JSON.stringify({ schema: 1, asset }));
  console.log(JSON.stringify({
    event: "lambda_asset_cache", function: fn.node.path, asset,
    result, inputs: files.length,
  }));
  return fn;
}
