import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { monitoring, type MonitoringProps } from "./monitoring";

interface MonitoringStackProps extends cdk.StackProps {
  monitoringInputs: MonitoringProps;
}

export class FlashcardsOpenSourceAppMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    monitoring(this, props.monitoringInputs);
  }
}
