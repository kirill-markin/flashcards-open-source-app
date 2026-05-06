import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

export interface DatabaseProps {
  vpc: ec2.Vpc;
  dbSg: ec2.SecurityGroup;
}

export interface DatabaseResult {
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  authDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.Secret;
}

const postgresEngineVersion = rds.PostgresEngineVersion.of("18.3", "18", {
  s3Export: true,
  s3Import: true,
});

export function database(scope: Construct, props: DatabaseProps): DatabaseResult {
  const dbCredentials = rds.Credentials.fromGeneratedSecret("flashcards_owner", {
    secretName: "flashcards-open-source-app/db-credentials",
    excludeCharacters: " %+~`#$&*()|[]{}:;<>?!/@\"\\",
  });

  const parameterGroup = new rds.ParameterGroup(scope, "DbParams", {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: postgresEngineVersion,
    }),
    parameters: {
      "log_connections": "all",
      "log_disconnections": "1",
      "rds.force_ssl": "1",
    },
  });

  const db = new rds.DatabaseInstance(scope, "Db", {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: postgresEngineVersion,
    }),
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.dbSg],
    credentials: dbCredentials,
    databaseName: "flashcards",
    parameterGroup,
    allocatedStorage: 20,
    maxAllocatedStorage: 50,
    storageEncrypted: true,
    backupRetention: cdk.Duration.days(7),
    deletionProtection: true,
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
  });

  const dbOwnerSecret = db.secret;
  if (dbOwnerSecret === undefined) {
    throw new Error("Database owner secret must be defined for generated credentials");
  }

  const backendDbSecret = new cdk.aws_secretsmanager.Secret(scope, "BackendDbSecret", {
    secretName: "flashcards-open-source-app/backend-db-password",
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "backend_app" }),
      generateStringKey: "password",
      excludePunctuation: true,
      passwordLength: 32,
    },
  });

  const authDbSecret = new cdk.aws_secretsmanager.Secret(scope, "AuthDbSecret", {
    secretName: "flashcards-open-source-app/auth-db-password",
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "auth_app" }),
      generateStringKey: "password",
      excludePunctuation: true,
      passwordLength: 32,
    },
  });

  const reportingDbSecret = new cdk.aws_secretsmanager.Secret(scope, "ReportingDbSecret", {
    secretName: "flashcards-open-source-app/reporting-db-password",
    description: "Generated credentials for the reporting_readonly Postgres role",
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "reporting_readonly" }),
      generateStringKey: "password",
      excludePunctuation: true,
      passwordLength: 32,
    },
  });

  return { db, dbOwnerSecret, backendDbSecret, authDbSecret, reportingDbSecret };
}
