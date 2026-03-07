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

export class FlashcardsOpenSourceAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseDomain = this.node.tryGetContext("domainName") as string;
    const alertEmail = this.node.tryGetContext("alertEmail") as string;
    const githubRepo = this.node.tryGetContext("githubRepo") as string;
    const apiCertificateArn = this.node.tryGetContext("apiCertificateArn") as string | undefined;
    const authCertificateArn = this.node.tryGetContext("authCertificateArn") as string | undefined;
    const webCertificateArnUsEast1 = this.node.tryGetContext("webCertificateArnUsEast1") as string | undefined;
    const githubOidcProviderArn = this.node.tryGetContext("githubOidcProviderArn") as string | undefined;

    const net = networking(this);
    const dbResult = database(this, { vpc: net.vpc, dbSg: net.dbSg });
    const preSignUpFn = preSignUp(this);
    const authResult = auth(this, { preSignUpFn });
    const authApi = authGateway(this, {
      baseDomain,
      authCertificateArn,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const migrationFn = migrationRunner(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      appDbSecret: dbResult.appDbSecret,
    });
    const api = apiGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      appDbSecret: dbResult.appDbSecret,
      baseDomain,
      apiCertificateArn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const web = webApp(this, {
      baseDomain,
      webCertificateArnUsEast1,
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
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      appDbSecret: dbResult.appDbSecret,
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
    });
  }
}
