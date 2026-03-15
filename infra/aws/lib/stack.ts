import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { networking } from "./networking";
import { database } from "./database";
import { preSignUp } from "./pre-signup";
import { auth } from "./auth";
import { apiGateway } from "./api-gateway";
import { monitoring } from "./monitoring";
import { ciCd } from "./ci-cd";
import { backupPlan } from "./backup";
import { outputs } from "./outputs";
import { webApp } from "./web";
import { migrationRunner } from "./migration-runner";
import { authGateway } from "./auth-gateway";

function getOptionalContextValue(stack: cdk.Stack, key: string): string | undefined {
  const value = stack.node.tryGetContext(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? undefined : trimmedValue;
}

export class FlashcardsOpenSourceAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseDomain = this.node.tryGetContext("domainName") as string;
    const alertEmail = this.node.tryGetContext("alertEmail") as string;
    const githubRepo = this.node.tryGetContext("githubRepo") as string;
    const apiCertificateArn = getOptionalContextValue(this, "apiCertificateArn");
    const authCertificateArn = getOptionalContextValue(this, "authCertificateArn");
    const webCertificateArnUsEast1 = getOptionalContextValue(this, "webCertificateArnUsEast1");
    const apexRedirectCertificateArnUsEast1 = getOptionalContextValue(this, "apexRedirectCertificateArnUsEast1");
    const githubOidcProviderArn = getOptionalContextValue(this, "githubOidcProviderArn");
    const openAiApiKeySecretArn = getOptionalContextValue(this, "openAiApiKeySecretArn");
    const anthropicApiKeySecretArn = getOptionalContextValue(this, "anthropicApiKeySecretArn");
    const sesSenderEmail = getOptionalContextValue(this, "sesSenderEmail");

    const net = networking(this);
    const dbResult = database(this, { vpc: net.vpc, dbSg: net.dbSg });
    const preSignUpFn = preSignUp(this);
    const authResult = auth(this, {
      baseDomain,
      preSignUpFn,
      sesSenderEmail,
    });
    const authApi = authGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      authDbSecret: dbResult.authDbSecret,
      baseDomain,
      authCertificateArn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const migrationFn = migrationRunner(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      backendDbSecret: dbResult.backendDbSecret,
      authDbSecret: dbResult.authDbSecret,
    });
    const api = apiGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      baseDomain,
      apiCertificateArn,
      openAiApiKeySecretArn,
      anthropicApiKeySecretArn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolArn: authResult.userPool.userPoolArn,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const web = webApp(this, {
      baseDomain,
      webCertificateArnUsEast1,
      apexRedirectCertificateArnUsEast1,
    });

    const mon = monitoring(this, {
      alertEmail,
      db: dbResult.db,
      restApi: api.restApi,
      backendFn: api.backendFn,
    });

    ciCd(this, {
      stackId: this.stackId,
      githubRepo,
      githubOidcProviderArn,
      migrationFn,
      webBucket: web.bucket,
      webDistribution: web.distribution,
    });

    backupPlan(this, { db: dbResult.db });

    outputs(this, {
      baseDomain,
      authConfigurationSetName: authResult.configurationSetName,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      backendDbSecret: dbResult.backendDbSecret,
      authDbSecret: dbResult.authDbSecret,
      alertTopic: mon.alertTopic,
      restApi: api.restApi,
      authRestApi: authApi.restApi,
      backendFn: api.backendFn,
      authFn: authApi.authFn,
      migrationFn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
      webBucket: web.bucket,
      webDistribution: web.distribution,
      webCustomDomain: web.customDomain,
      apexRedirectDistribution: web.apexRedirectDistribution,
      apexRedirectCustomDomain: web.apexRedirectCustomDomain,
    });
  }
}
