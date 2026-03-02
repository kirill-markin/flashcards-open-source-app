import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface NetworkingResult {
  vpc: ec2.Vpc;
  dbSg: ec2.SecurityGroup;
  lambdaSg: ec2.SecurityGroup;
}

export function networking(scope: Construct): NetworkingResult {
  const natProvider = ec2.NatProvider.instanceV2({
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
  });

  const vpc = new ec2.Vpc(scope, "Vpc", {
    maxAzs: 2,
    natGatewayProvider: natProvider,
    natGateways: 1,
    subnetConfiguration: [
      { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
    ],
  });

  const dbSg = new ec2.SecurityGroup(scope, "DbSg", {
    vpc,
    description: "RDS Postgres security group",
  });

  const lambdaSg = new ec2.SecurityGroup(scope, "LambdaSg", {
    vpc,
    description: "Lambda security group for backend and worker",
  });

  dbSg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), "Lambda to Postgres");

  return { vpc, dbSg, lambdaSg };
}
