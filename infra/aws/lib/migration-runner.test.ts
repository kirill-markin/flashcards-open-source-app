import assert from "node:assert/strict";
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

test("database migration gate blocks the dependent backend runtime", () => {
  const stack = new cdk.Stack();
  const migrationFn = new lambda.Function(stack, "MigrationHandler", {
    code: lambda.Code.fromInline("exports.handler = async () => ({ installedMigrations: [] });"),
    handler: "index.handler",
    runtime: lambda.Runtime.NODEJS_24_X,
  });
  const migrationGate = databaseMigrationGate(
    stack,
    migrationFn,
    "0112_prepare_catalog_topic_removal.sql",
  );
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
    && resource.Properties?.RequiredMigration === "0112_prepare_catalog_topic_removal.sql"
  ));
  if (migrationGateEntry === undefined) {
    throw new Error("Synthesized template is missing the required database migration gate");
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
