import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * Failed agent SQL executions with their full SQL and error message, which carry flashcard content,
 * so the group expires after 30 days.
 */
export function agentSqlFailureLog(
  scope: Construct,
  agentSqlFunctions: ReadonlyArray<lambda.Function>,
): void {
  const logGroup = new logs.LogGroup(scope, "AgentSqlFailureLogGroup", {
    logGroupName: "/flashcards-open-source-app/agent-sql-failures",
    retention: logs.RetentionDays.ONE_MONTH,
  });
  for (const fn of agentSqlFunctions) {
    logGroup.grants.write(fn);
    fn.addEnvironment("AGENT_SQL_FAILURE_LOG_GROUP_NAME", logGroup.logGroupName);
  }
}
