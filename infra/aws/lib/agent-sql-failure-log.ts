import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * Failed MCP agent SQL executions with their full SQL and error message, which carry flashcard
 * content, so the group expires after 30 days.
 */
export function mcpAgentSqlFailureLog(scope: Construct, mcpFn: lambda.Function): void {
  const logGroup = new logs.LogGroup(scope, "McpAgentSqlFailureLogGroup", {
    logGroupName: "/flashcards-open-source-app/mcp-agent-sql-failures",
    retention: logs.RetentionDays.ONE_MONTH,
  });
  logGroup.grants.write(mcpFn);
  mcpFn.addEnvironment("AGENT_SQL_FAILURE_LOG_GROUP_NAME", logGroup.logGroupName);
}
