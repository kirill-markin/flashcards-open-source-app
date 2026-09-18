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
  alternateMcpHttpApiMappingConstructIdPrefix,
  primaryMcpHttpApiMappingConstructIdPrefix,
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
  addMcpHttpApiMappings(
    stack,
    "mcp.example.test",
    httpApi,
    httpStage,
    [httpStage],
    primaryMcpHttpApiMappingConstructIdPrefix,
  );
  addMcpHttpApiMappings(
    stack,
    "mcp.alternate.test",
    httpApi,
    httpStage,
    [httpStage],
    alternateMcpHttpApiMappingConstructIdPrefix,
  );

  return Template.fromStack(stack);
}

const mcpApiMappingKeys: ReadonlyArray<string> = [
  "mcp",
  "health",
  "robots.txt",
  ".well-known/oauth-protected-resource",
  ".well-known/oauth-protected-resource/mcp",
];

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
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "GET /robots.txt",
  });
});

test("MCP HTTP API mappings synthesize for public route prefixes without a v2 custom domain", () => {
  const template = synthesizeMcpHttpApiTemplate();
  const v2Domains = template.findResources("AWS::ApiGatewayV2::DomainName");

  assert.deepEqual(v2Domains, {});
  for (const apiMappingKey of mcpApiMappingKeys) {
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", {
      DomainName: "mcp.example.test",
      ApiMappingKey: apiMappingKey,
      Stage: "v1",
    });
  }
});

test("alternate MCP host maps the same stage under its own construct ids", () => {
  const template = synthesizeMcpHttpApiTemplate();
  const logicalIds = Object.keys(template.findResources("AWS::ApiGatewayV2::ApiMapping"));

  for (const apiMappingKey of mcpApiMappingKeys) {
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", {
      DomainName: "mcp.alternate.test",
      ApiMappingKey: apiMappingKey,
      Stage: "v1",
    });
  }

  // The deployed primary mappings must keep their construct ids, otherwise
  // adding the alternate host would replace them.
  assert.ok(logicalIds.includes("McpHttpMcpApiMapping"));
  assert.ok(logicalIds.includes("McpHttpProtectedResourceMcpApiMapping"));
  assert.equal(logicalIds.length, mcpApiMappingKeys.length * 2);
});

test("MCP custom domain migration keeps the REST domain and Cloudflare target output", () => {
  const source = readLibSource("lib/gateways/mcp-gateway.ts");

  assert.match(source, /new apigw\.RestApi\(scope, "McpApi"/);
  assert.match(source, /restApi\.addDomainName\("McpCustomDomain"/);
  assert.equal(source.includes("new apigwv2.DomainName(scope, \"McpCustomDomain\""), false);
  assert.match(
    source,
    /addMcpHttpApiMappings\(scope, customDomain\.domainName, httpApi, httpStage, \[customDomain, httpStage\], primaryMcpHttpApiMappingConstructIdPrefix\)/,
  );
  assert.match(source, /new cdk\.CfnOutput\(scope, "McpCustomDomainTarget"/);
  assert.match(source, /value: customDomain\.domainNameAliasDomainName/);
});

test("alternate MCP custom domain is additive and needs both context values", () => {
  const source = readLibSource("lib/gateways/mcp-gateway.ts");
  const stackSource = readLibSource("lib/stack.ts");
  const monitoringSource = readLibSource("lib/monitoring.ts");

  assert.match(source, /restApi\.addDomainName\("McpAlternateCustomDomain"/);
  // One resolver decides whether the host exists at all, and it returns undefined
  // unless both context values are set (lib/mcp-alternate-host.test.ts).
  assert.match(
    source,
    /const mcpAlternateHost = resolveMcpAlternateHost\(\s*props\.baseDomain,\s*props\.mcpAlternateDomainName,\s*props\.mcpAlternateCertificateArn,\s*\);/,
  );
  assert.match(
    source,
    /if \(mcpAlternateHost !== undefined && hasConfiguredValue\(props\.mcpAlternateCertificateArn\)\) \{/,
  );
  assert.match(
    source,
    /addMcpHttpApiMappings\(scope, alternateCustomDomain\.domainName, httpApi, httpStage, \[alternateCustomDomain, httpStage\], alternateMcpHttpApiMappingConstructIdPrefix\)/,
  );
  assert.match(source, /new cdk\.CfnOutput\(scope, "McpAlternateCustomDomainTarget"/);
  assert.match(stackSource, /getOptionalContextValue\(this, "mcpAlternateDomainName"\)/);
  assert.match(stackSource, /getOptionalContextValue\(this, "mcpAlternateCertificateArn"\)/);
  assert.match(monitoringSource, /alarmId: "McpAlternateCertificateExpiryAlarm"/);
});

test("the alternate host reaches the MCP and auth Lambda environments only when configured", () => {
  const source = readLibSource("lib/gateways/mcp-gateway.ts");
  const authGatewaySource = readLibSource("lib/gateways/auth-gateway.ts");
  const stackSource = readLibSource("lib/stack.ts");
  const heartbeatSource = readLibSource("lib/scheduled-jobs/public-endpoint-heartbeat.ts");

  // Conditional spreads, so an unconfigured deployment has byte-identical Lambda
  // environments and the handler keeps accepting only mcp.<baseDomain>.
  assert.match(
    source,
    /\.\.\.\(mcpAlternateHost === undefined \? \{\} : \{ MCP_ALTERNATE_HOST: mcpAlternateHost \}\),/,
  );
  assert.match(
    authGatewaySource,
    /\.\.\.\(props\.mcpAlternateHost === undefined\s*\?\s*\{\}\s*:\s*\{ MCP_ALTERNATE_RESOURCE: getMcpResourceUrl\(props\.mcpAlternateHost\) \}\),/,
  );
  // The authorization server itself is unchanged: both hosts keep auth.<domain>.
  assert.match(authGatewaySource, /PUBLIC_AUTH_BASE_URL: `https:\/\/auth\.\$\{props\.baseDomain\}`/);
  // Both resource identifiers come from the one helper, so they cannot drift apart.
  assert.match(
    authGatewaySource,
    /MCP_RESOURCE: getMcpResourceUrl\(getPrimaryMcpHost\(props\.baseDomain\)\),/,
  );
  assert.equal(authGatewaySource.includes("https://mcp.${props.baseDomain}/mcp"), false);

  // One resolution in the stack feeds the auth Lambda, the heartbeat and the alarms.
  assert.match(
    stackSource,
    /const mcpAlternateHost = resolveMcpAlternateHost\(\s*baseDomain,\s*mcpAlternateDomainName,\s*mcpAlternateCertificateArn,\s*\);/,
  );
  assert.match(
    stackSource,
    /publicEndpointHeartbeat\(this, \{ baseDomain, mcpAlternateHeartbeatHost \}\);/,
  );
  assert.match(heartbeatSource, /id: "McpAlternate",/);
});

test("liveness policing of the alternate host waits for its own switch", () => {
  const stackSource = readLibSource("lib/stack.ts");
  const authGatewaySource = readLibSource("lib/gateways/auth-gateway.ts");
  const mcpGatewaySource = readLibSource("lib/gateways/mcp-gateway.ts");
  const monitoringSource = readLibSource("lib/monitoring.ts");

  // The host is created from the two values above; only the heartbeat and its
  // alarm wait for the third, because the alternate CNAME can only be created
  // from the McpAlternateCustomDomainTarget output of the deploy that creates
  // the custom domain.
  assert.match(
    stackSource,
    /const mcpAlternateHeartbeatHost = isMcpAlternateHostLive\(\s*getOptionalContextValue\(this, "mcpAlternateHostLive"\),\s*\)\s*\? mcpAlternateHost\s*: undefined;/,
  );
  assert.match(
    monitoringSource,
    /createPublicEndpointHeartbeatTargets\(props\.baseDomain, props\.mcpAlternateHeartbeatHost\)/,
  );
  // The certificate expiry alarm and the custom domain keep reading the deployed
  // host, which exists before anything is declared live.
  assert.match(monitoringSource, /host: props\.mcpAlternateHost,/);

  // The live switch never reaches a Lambda, so the handler and the authorization
  // server behave identically before and after it is flipped.
  for (const source of [authGatewaySource, mcpGatewaySource]) {
    assert.equal(source.includes("mcpAlternateHostLive"), false);
    assert.equal(source.includes("mcpAlternateHeartbeatHost"), false);
  }
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
