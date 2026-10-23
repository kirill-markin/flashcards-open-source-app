import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { IConstruct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveFromRepoRoot } from "./nodejs-project-paths";

interface FunctionProperties {
  Runtime?: string;
  Architectures?: string[];
  Environment?: { Variables?: Record<string, string> };
  Layers?: object[];
  EphemeralStorage?: { Size: number };
}

function properties(stack: cdk.Stack, resource: cdk.CfnResource): FunctionProperties {
  const template = stack.resolve(resource._toCloudFormation()) as {
    Resources: Record<string, { Properties: FunctionProperties }>;
  };
  return Object.values(template.Resources)[0].Properties;
}

export function activatePatchedNodeRuntime(stack: cdk.Stack): void {
  const layers = new Map<string, { arn: string; identity: string; scratch: number }>();
  for (const [architecture, nodeArchitecture] of [["x86_64", "x64"], ["arm64", "arm64"]]) {
    const assetPath = resolveFromRepoRoot(".cache/node-runtime", architecture);
    const manifest = JSON.parse(fs.readFileSync(path.join(assetPath, "nibomo-node/manifest.json"), "utf8")) as {
      version: string; arch: string; size: number;
    };
    const version = `v${fs.readFileSync(resolveFromRepoRoot(".nvmrc"), "utf8").trim()}`;
    if (manifest.version !== version || manifest.arch !== nodeArchitecture || !Number.isSafeInteger(manifest.size)
      || manifest.size <= 0 || manifest.size > 140 * 1024 * 1024) {
      throw new Error(`Invalid CI-prepared patched Node manifest: ${assetPath}`);
    }
    const layer = new lambda.LayerVersion(stack, `PatchedNode${architecture}`, {
      code: lambda.Code.fromAsset(assetPath),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      compatibleArchitectures: [architecture === "arm64" ? lambda.Architecture.ARM_64 : lambda.Architecture.X86_64],
      description: `Official Node ${manifest.version} executable (${architecture})`,
    });
    layers.set(architecture, {
      arn: layer.layerVersionArn,
      identity: cdk.FileSystem.fingerprint(assetPath),
      scratch: Math.ceil(manifest.size / (1024 * 1024)) + 8,
    });
  }
  const activated = new Set<cdk.CfnResource>();
  cdk.Aspects.of(stack).add({ visit(node: IConstruct): void {
    if (!(node instanceof cdk.CfnResource) || node.cfnResourceType !== "AWS::Lambda::Function") return;
    const original = properties(stack, node);
    if (!original.Runtime?.startsWith("nodejs")) return;
    if (original.Runtime !== "nodejs24.x") throw new Error(`Unsupported Node Lambda runtime: ${node.node.path}`);
    const architecture = original.Architectures ?? ["x86_64"];
    const layer = architecture.length === 1 ? layers.get(architecture[0]) : undefined;
    if (!layer || original.Layers?.length || original.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER) {
      throw new Error(`Unsupported Lambda layer/wrapper configuration: ${node.node.path}`);
    }
    const scratch = original.EphemeralStorage?.Size ?? 512;
    if (!Number.isSafeInteger(scratch) || scratch + layer.scratch > 10240) {
      throw new Error(`Insufficient ephemeral storage headroom for patched Node: ${node.node.path}`);
    }
    node.addPropertyOverride("Layers", [layer.arn]);
    node.addPropertyOverride("Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER", "/opt/bin/nibomo-node-wrapper");
    // The fingerprint also rotates published currentVersion hashes when layer contents change.
    node.addPropertyOverride("Environment.Variables.NIBOMO_NODE_RUNTIME_ID", layer.identity);
    node.addPropertyOverride("EphemeralStorage.Size", scratch + layer.scratch);
    activated.add(node);
  } }, { priority: cdk.AspectPriority.MUTATING });
  stack.node.addValidation({ validate(): string[] {
    return stack.node.findAll().filter((node): node is cdk.CfnResource =>
      node instanceof cdk.CfnResource && node.cfnResourceType === "AWS::Lambda::Function")
      .filter((node) => properties(stack, node).Runtime?.startsWith("nodejs") && !activated.has(node))
      .map((node) => `Node Lambda missed patched runtime activation: ${node.node.path}`);
  } });
}
