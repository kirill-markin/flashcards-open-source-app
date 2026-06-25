import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import {
  addMcpHttpApiMappings,
  addMcpHttpApiRoutes,
} from "./mcp-gateway";
import { createSafeHttpApiAccessLogFormat } from "./api-gateway-access-log";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function synthesizeMcpHttpApiTemplate(): Template {
  const stack = new cdk.Stack();
  const httpApi = new apigwv2.HttpApi(stack, "McpHttpApi", {
    createDefaultStage: false,
  });
  const httpStage = new apigwv2.HttpStage(stack, "McpHttpApiStage", {
    httpApi,
    stageName: "v1",
  });
  const fn = new lambda.Function(stack, "McpHandler", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 200, body: '{}' });"),
  });
  const integration = new apigwv2Integrations.HttpLambdaIntegration("McpHttpLambdaIntegration", fn, {
    payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_1_0,
  });

  addMcpHttpApiRoutes(stack, httpApi, integration);
  addMcpHttpApiMappings(stack, "mcp.example.test", httpApi, httpStage, [httpStage]);

  return Template.fromStack(stack);
}

test("MCP gateway uses HTTP API v2 payload 1.0 so OAuth challenge headers are preserved", () => {
  const template = synthesizeMcpHttpApiTemplate();

  template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
    ProtocolType: "HTTP",
  });
  template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
    PayloadFormatVersion: "1.0",
  });
});

test("MCP HTTP API synthesizes explicit public routes and default mapped-path route", () => {
  const template = synthesizeMcpHttpApiTemplate();

  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "$default",
  });
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "GET /.well-known/oauth-protected-resource",
  });
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "GET /.well-known/oauth-protected-resource/mcp",
  });
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "ANY /mcp",
  });
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "GET /health",
  });
});

test("MCP HTTP API mappings synthesize for public route prefixes without a v2 custom domain", () => {
  const template = synthesizeMcpHttpApiTemplate();
  const v2Domains = template.findResources("AWS::ApiGatewayV2::DomainName");

  assert.deepEqual(v2Domains, {});
  for (const apiMappingKey of [
    "mcp",
    "health",
    ".well-known/oauth-protected-resource",
    ".well-known/oauth-protected-resource/mcp",
  ]) {
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", {
      DomainName: "mcp.example.test",
      ApiMappingKey: apiMappingKey,
      Stage: "v1",
    });
  }
});

test("MCP custom domain migration keeps the REST domain and Cloudflare target output", () => {
  const source = readLibSource("lib/gateways/mcp-gateway.ts");

  assert.match(source, /new apigw\.RestApi\(scope, "McpApi"/);
  assert.match(source, /restApi\.addDomainName\("McpCustomDomain"/);
  assert.equal(source.includes("new apigwv2.DomainName(scope, \"McpCustomDomain\""), false);
  assert.match(
    source,
    /addMcpHttpApiMappings\(scope, customDomain\.domainName, httpApi, httpStage, \[customDomain, httpStage\]\)/,
  );
  assert.match(source, /new cdk\.CfnOutput\(scope, "McpCustomDomainTarget"/);
  assert.match(source, /value: customDomain\.domainNameAliasDomainName/);
});

test("MCP HTTP API access logs avoid REST-only fields", () => {
  const format = createSafeHttpApiAccessLogFormat().toString();

  assert.match(format, /\$context\.requestId/);
  assert.match(format, /\$context\.routeKey/);
  assert.match(format, /\$context\.path/);
  assert.equal(format.includes("$context.resourcePath"), false);
  assert.equal(format.includes("$context.extendedRequestId"), false);
});

test("stack, monitoring, and outputs consume the MCP HTTP API result", () => {
  const stackSource = readLibSource("lib/stack.ts");
  const monitoringSource = readLibSource("lib/monitoring.ts");
  const outputsSource = readLibSource("lib/outputs.ts");

  assert.match(stackSource, /mcpHttpApi: mcpApi\.httpApi,/);
  assert.match(stackSource, /mcpHttpStage: mcpApi\.httpStage,/);
  assert.match(monitoringSource, /props\.mcpHttpApi\.metricServerError\(/);
  assert.match(outputsSource, /value: props\.mcpHttpStage\.url/);
  assert.match(outputsSource, /value: props\.mcpHttpApi\.httpApiId/);
});
