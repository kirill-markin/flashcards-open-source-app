import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { networking } from "./networking";
import { database } from "./database";
import { apiGateway } from "./api-gateway";
import { reviewWorker } from "./review-worker";
import { monitoring } from "./monitoring";
import { ciCd } from "./ci-cd";
import { backupPlan } from "./backup";
import { outputs } from "./outputs";

export class FlashcardsOpenSourceAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseDomain = this.node.tryGetContext("domainName") as string;
    const alertEmail = this.node.tryGetContext("alertEmail") as string;
    const githubRepo = this.node.tryGetContext("githubRepo") as string;
    const apiCertificateArn = this.node.tryGetContext("apiCertificateArn") as string | undefined;

    const net = networking(this);
    const dbResult = database(this, { vpc: net.vpc, dbSg: net.dbSg });
    const api = apiGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      appDbSecret: dbResult.appDbSecret,
      baseDomain,
      apiCertificateArn,
    });

    const worker = reviewWorker(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      workerDbSecret: dbResult.workerDbSecret,
    });

    const mon = monitoring(this, {
      alertEmail,
      db: dbResult.db,
      restApi: api.restApi,
      backendFn: api.backendFn,
      workerFn: worker.workerFn,
    });

    ciCd(this, {
      stackId: this.stackId,
      workerFn: worker.workerFn,
      githubRepo,
    });

    backupPlan(this, { db: dbResult.db });

    outputs(this, {
      baseDomain,
      db: dbResult.db,
      appDbSecret: dbResult.appDbSecret,
      workerDbSecret: dbResult.workerDbSecret,
      alertTopic: mon.alertTopic,
      restApi: api.restApi,
      backendFn: api.backendFn,
      workerFn: worker.workerFn,
    });
  }
}
