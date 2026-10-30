import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { backendStructuredLoggingProps } from "../backend-lambda-logging";
import { createCachedNodejsFunction } from "../lambda-input-cache";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";

// A chat run waits for each sandbox call, so the chat worker's own reservation bounds normal use; the
// rest absorbs invocations a transport retry left running.
const chatSandboxReservedConcurrency = 10;
const chatSandboxNodeModules = ["just-bash", "pdfjs-dist"] as const;

/**
 * Runs model-written commands over one chat session's files and parses the files people attach
 * (`apps/backend/src/chatSandbox/handler.ts`). It is attached to no VPC and its role, which carries no
 * managed policy, may only write to the function's own log group: it reaches no AWS service, only the
 * objects the chat worker pre-signed for one call, and the backend API's SQL bridge under the
 * capability the worker minted for that call.
 */
export function createChatSandboxFunction(scope: Construct): lambdaNodejs.NodejsFunction {
  // Kept like every other function's log group, which Lambda creates with no expiry.
  const logGroup = new logs.LogGroup(scope, "ChatSandboxLogGroup", {
    retention: logs.RetentionDays.INFINITE,
  });
  const role = new iam.Role(scope, "ChatSandboxRole", {
    assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
  });
  logGroup.grantWrite(role);
  return createCachedNodejsFunction(scope, "ChatSandboxHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-chat-sandbox.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    timeout: cdk.Duration.minutes(2),
    // A 20 MB CSV peaks near 1.5 GB in the Python runtime; memory also sets the CPU share.
    memorySize: 3008,
    reservedConcurrentExecutions: chatSandboxReservedConcurrency,
    role,
    logGroup,
    ...backendStructuredLoggingProps,
    ...backendNodejsProjectPaths,
    copiedAssetPaths: [
      resolveFromRepoRoot("apps", "backend", "scripts", "install-lambda-node-modules.mts"),
      resolveFromRepoRoot("apps", "backend", "scripts", "patch-just-bash.mts"),
    ],
    bundling: {
      minify: true,
      sourceMap: true,
      // just-bash loads its workers and the Python runtime, and pdf.js its worker, font metrics and
      // character maps, from their own package directories, which a single-file bundle does not carry.
      externalModules: [...chatSandboxNodeModules],
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        // CDK's nodeModules manifest drops npm overrides before installing the locked graph.
        afterBundling: (inputDir: string, outputDir: string) => [
          `node "${inputDir}/scripts/install-lambda-node-modules.mts" "${inputDir}" "${outputDir}" ${chatSandboxNodeModules.join(" ")}`,
          `node "${inputDir}/scripts/patch-just-bash.mts" "${outputDir}/node_modules"`,
        ],
      },
    },
  });
}
