import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import {
  addDatabaseMigrationDependency,
  databaseMigrationGate,
} from "./migration-runner";

type CloudFormationResource = Readonly<{
  Type: string;
  DependsOn?: string | ReadonlyArray<string>;
  Properties?: Readonly<Record<string, unknown>>;
}>;

// Independent of the resolver under test: the newest NNNN_*.sql in the bundled
// directory by byte order, the same rule scripts/deploy/migrate-aws.sh applies.
function readExpectedLatestMigration(): string {
  const migrationFileNames = readdirSync(resolve(process.cwd(), "../../db/migrations"))
    .filter((fileName) => /^[0-9]{4}_.*\.sql$/.test(fileName))
    .sort();
  const latestMigrationFileName = migrationFileNames.at(-1);
  if (latestMigrationFileName === undefined) {
    throw new Error("db/migrations holds no NNNN_*.sql file to expect from the gate");
  }
  return latestMigrationFileName;
}

test("database migration gate requires the newest bundled migration and blocks the dependent backend runtime", () => {
  const expectedLatestMigration = readExpectedLatestMigration();
  const stack = new cdk.Stack();
  const migrationFn = new lambda.Function(stack, "MigrationHandler", {
    code: lambda.Code.fromInline("exports.handler = async () => ({ installedMigrations: [] });"),
    handler: "index.handler",
    runtime: lambda.Runtime.NODEJS_24_X,
  });
  const migrationGate = databaseMigrationGate(stack, migrationFn);
  const dependentRuntime = new lambda.Function(stack, "DependentBackendHandler", {
    code: lambda.Code.fromInline("exports.handler = async () => ({});"),
    description: "Catalog-dependent backend runtime",
    handler: "index.handler",
    runtime: lambda.Runtime.NODEJS_24_X,
  });

  addDatabaseMigrationDependency(dependentRuntime, migrationGate);

  const template = Template.fromStack(stack).toJSON() as Readonly<{
    Resources: Readonly<Record<string, CloudFormationResource>>;
  }>;
  const migrationGateEntry = Object.entries(template.Resources).find(([, resource]) => (
    resource.Type === "AWS::CloudFormation::CustomResource"
    && resource.Properties?.RequiredMigration === expectedLatestMigration
  ));
  if (migrationGateEntry === undefined) {
    throw new Error(
      `Synthesized template is missing a database migration gate requiring ${expectedLatestMigration}`,
    );
  }

  const dependentRuntimeEntry = Object.entries(template.Resources).find(([, resource]) => (
    resource.Type === "AWS::Lambda::Function"
    && resource.Properties?.Description === "Catalog-dependent backend runtime"
  ));
  if (dependentRuntimeEntry === undefined) {
    throw new Error("Synthesized template is missing the catalog-dependent backend runtime");
  }

  const migrationGateLogicalId = migrationGateEntry[0];
  const dependentRuntimeResource = dependentRuntimeEntry[1];
  const dependencies = Array.isArray(dependentRuntimeResource.DependsOn)
    ? dependentRuntimeResource.DependsOn
    : [dependentRuntimeResource.DependsOn];
  assert.ok(dependencies.includes(migrationGateLogicalId));
});
