import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AnalyticsAccessProps {
  vpc: ec2.Vpc;
  dbSg: ec2.SecurityGroup;
}

export interface AnalyticsAccessResult {
  ssmInstanceId: string;
}

/**
 * Provisions the bastion used for analytical access to the private RDS
 * instance without making the database itself publicly reachable.
 */
export function analyticsAccess(scope: Construct, props: AnalyticsAccessProps): AnalyticsAccessResult {
  const dbAccessSg = new ec2.SecurityGroup(scope, "DbAccessSg", {
    vpc: props.vpc,
    description: "Security group for the analytical bastion host",
    allowAllOutbound: true,
  });

  props.dbSg.addIngressRule(dbAccessSg, ec2.Port.tcp(5432), "Analytical DB access host to Postgres");

  // Registers the bastion with Systems Manager so operators can port-forward
  // to the database with their AWS credentials. The bastion has no ingress
  // rules at all: the tunnel is established outbound by the SSM Agent.
  const dbAccessRole = new iam.Role(scope, "DbAccessRole", {
    assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    description: "Instance role for the analytical bastion host",
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
    ],
  });

  const dbAccessInstance = new ec2.Instance(scope, "DbAccessInstance", {
    vpc: props.vpc,
    role: dbAccessRole,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    securityGroup: dbAccessSg,
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
    machineImage: ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
    }),
    requireImdsv2: true,
    blockDevices: [{
      deviceName: "/dev/xvda",
      volume: ec2.BlockDeviceVolume.ebs(10, {
        encrypted: true,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      }),
    }],
  });

  return {
    ssmInstanceId: dbAccessInstance.instanceId,
  };
}
