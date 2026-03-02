import * as rds from "aws-cdk-lib/aws-rds";
import * as backup from "aws-cdk-lib/aws-backup";
import { Construct } from "constructs";

export interface BackupProps {
  db: rds.DatabaseInstance;
}

export function backupPlan(scope: Construct, props: BackupProps): void {
  // --- AWS Backup ---
  const plan = backup.BackupPlan.daily35DayRetention(scope, "BackupPlan");
  plan.addSelection("DbBackup", {
    resources: [backup.BackupResource.fromRdsDatabaseInstance(props.db)],
  });
}
