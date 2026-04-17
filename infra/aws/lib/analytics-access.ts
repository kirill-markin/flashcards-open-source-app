import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface AnalyticsAccessProps {
  vpc: ec2.Vpc;
  dbSg: ec2.SecurityGroup;
  dbHost: string;
  sshAllowedCidrs: ReadonlyArray<string>;
  sshPublicKeys: ReadonlyArray<string>;
  sshUsername: string;
}

export interface AnalyticsAccessResult {
  dbAccessInstance: ec2.Instance;
  sshUsername: string;
}

function validateAnalyticsSshUsername(sshUsername: string): string {
  const unixUsernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/;
  if (unixUsernamePattern.test(sshUsername) === false) {
    throw new Error(
      "analyticsSshUsername must be a valid Unix username: 1-32 chars, start with a lowercase letter or underscore, and contain only lowercase letters, digits, underscores, or hyphens",
    );
  }

  return sshUsername;
}

/**
 * Provisions the public SSH bastion used for analytical access to the private
 * RDS instance without making the database itself publicly reachable.
 */
export function analyticsAccess(scope: Construct, props: AnalyticsAccessProps): AnalyticsAccessResult {
  const sshUsername = validateAnalyticsSshUsername(props.sshUsername);
  const dbAccessSg = new ec2.SecurityGroup(scope, "DbAccessSg", {
    vpc: props.vpc,
    description: "Security group for the analytical SSH bastion host",
    allowAllOutbound: true,
  });

  for (const allowedCidr of props.sshAllowedCidrs) {
    dbAccessSg.addIngressRule(
      ec2.Peer.ipv4(allowedCidr),
      ec2.Port.tcp(22),
      "Approved analytical SSH client",
    );
  }

  props.dbSg.addIngressRule(dbAccessSg, ec2.Port.tcp(5432), "Analytical DB access host to Postgres");

  const dbAccessInstance = new ec2.Instance(scope, "DbAccessInstance", {
    vpc: props.vpc,
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

  const userHomeDirectory = `/home/${sshUsername}`;
  const userSshDirectory = `${userHomeDirectory}/.ssh`;
  const authorizedKeysPath = `${userSshDirectory}/authorized_keys`;
  const authorizedKeysPayload = Buffer.from(
    `${props.sshPublicKeys.join("\n")}\n`,
    "utf8",
  ).toString("base64");

  dbAccessInstance.addUserData(
    "#!/bin/bash",
    "set -euxo pipefail",
    "",
    "# Install psql and configure SSH tunneling for analytical access.",
    "dnf install -y postgresql16 || dnf install -y postgresql15 || dnf install -y postgresql",
    "NOLOGIN_SHELL=\"$(command -v nologin)\"",
    "if [[ -z \"${NOLOGIN_SHELL}\" ]]; then echo 'nologin binary is required for analytics SSH hardening' >&2; exit 1; fi",
    `id -u ${sshUsername} >/dev/null 2>&1 || useradd --create-home --shell "\${NOLOGIN_SHELL}" ${sshUsername}`,
    `usermod --shell "\${NOLOGIN_SHELL}" ${sshUsername}`,
    `install -d -m 700 -o ${sshUsername} -g ${sshUsername} ${userSshDirectory}`,
    `echo '${authorizedKeysPayload}' | base64 -d > ${authorizedKeysPath}`,
    `chown ${sshUsername}:${sshUsername} ${authorizedKeysPath}`,
    `chmod 600 ${authorizedKeysPath}`,
    "cat <<'EOF' > /etc/ssh/sshd_config.d/flashcards-analytics.conf",
    "PermitRootLogin no",
    `Match User ${sshUsername}`,
    "  AllowAgentForwarding no",
    "  AllowStreamLocalForwarding no",
    "  AllowTcpForwarding yes",
    "  AuthenticationMethods publickey",
    "  ChallengeResponseAuthentication no",
    "  GatewayPorts no",
    "  KbdInteractiveAuthentication no",
    "  PasswordAuthentication no",
    `  PermitOpen ${props.dbHost}:5432`,
    "  PermitTTY no",
    "  PermitUserRC no",
    "  PubkeyAuthentication yes",
    "  X11Forwarding no",
    "EOF",
    "systemctl enable sshd",
    "systemctl restart sshd",
  );

  return {
    dbAccessInstance,
    sshUsername,
  };
}
