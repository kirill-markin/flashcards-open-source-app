import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";

export function getLambdaSentryRelease(fn: lambda.Function): string {
  const resource = fn.node.defaultChild;
  if (!(resource instanceof lambda.CfnFunction)) {
    throw new Error(`Lambda ${fn.node.path} has no default CfnFunction resource`);
  }

  // The staged asset key includes transitive inputs and CDK bundling configuration.
  // Resolve only Code: currentVersion also hashes environment and would recurse.
  const code = cdk.Stack.of(fn).resolve(resource.code) as lambda.CfnFunction.CodeProperty;
  const assetHash = typeof code.s3Key === "string"
    ? /(?:^|\/)([a-f0-9]{64})\.zip$/.exec(code.s3Key)?.[1]
    : undefined;
  if (assetHash === undefined) {
    throw new Error(`Lambda ${fn.node.path} must use a content-addressed CDK S3 code asset for its Sentry release`);
  }

  return `lambda-${cdk.Names.uniqueId(fn)}@${assetHash}`;
}
