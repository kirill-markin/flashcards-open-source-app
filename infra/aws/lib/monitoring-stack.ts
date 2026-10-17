import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { monitoring, type MonitoringProps } from "./monitoring";

interface MonitoringStackProps extends cdk.StackProps {
  monitoringInputs: MonitoringProps;
}

// Alarms and metric filters only. The SNS topic, log groups and every application resource stay in
// the core stack, and this stack only reads core references, never the reverse. Moving resources
// between the two stacks is a stack refactor: follow docs/aws-infrastructure-changes.md.
export class FlashcardsOpenSourceAppMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    monitoring(this, props.monitoringInputs);
  }
}
