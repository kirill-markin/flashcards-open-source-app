#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as fs from "fs";
import * as path from "path";
import { FlashcardsOpenSourceAppStack } from "../lib/stack";

const app = new cdk.App();

const localContextPath = path.join(__dirname, "..", "cdk.context.local.json");
if (fs.existsSync(localContextPath)) {
  const localContext = JSON.parse(fs.readFileSync(localContextPath, "utf-8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(localContext)) {
    if (value !== undefined && value !== null && value !== "") {
      app.node.setContext(key, value);
    }
  }
}

const getRequiredContext = (key: string, hint: string): string => {
  const value = app.node.tryGetContext(key) as string | undefined;
  if (!value) {
    throw new Error(`Missing required context: '${key}'. ${hint}`);
  }
  return value;
};

const region = getRequiredContext("region", "Set it in cdk.context.local.json or pass via -c region=eu-central-1");
const domainName = getRequiredContext("domainName", "Set it in cdk.context.local.json (for example flashcards-open-source-app.com)");
const alertEmail = getRequiredContext("alertEmail", "Set it in cdk.context.local.json (alarm notifications email)");
const githubRepo = getRequiredContext("githubRepo", "Set it in cdk.context.local.json (for example kirill-markin/flashcards-open-source-app)");

new FlashcardsOpenSourceAppStack(app, "FlashcardsOpenSourceApp", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  description: `Offline-first flashcards backend: API Gateway + Lambda + RDS (${domainName})`,
});
