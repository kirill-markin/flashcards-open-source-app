import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";
import {
  addTextContentHandlingToMockOptionsMethods,
  createLegacyAuthNotFoundIntegration,
  createMediaAssetsObjectPolicyStatement,
  createChatLiveFunctionUrlCorsOptions,
  createGatewayErrorResponseHeaders,
  globalMetricsCorsPreflightOptions,
} from "./api-gateway";

function loadApiGatewaySource(): string {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  return readFileSync(apiGatewayPath, "utf8");
}

function getBackendFunctionConfiguration(apiGatewaySource: string, constructId: string): string {
  const configurationStart = apiGatewaySource.indexOf(`constructId: "${constructId}"`);
  assert.notEqual(configurationStart, -1, `Missing ${constructId} configuration`);

  const configurationEnd = apiGatewaySource.indexOf("\n  });", configurationStart);
  assert.notEqual(configurationEnd, -1, `Missing ${constructId} configuration end`);

  return apiGatewaySource.slice(configurationStart, configurationEnd);
}

function assertApiGatewayUsesBackendProxy(apiGatewaySource: string): void {
  assert.match(
    apiGatewaySource,
    /restApi\.root\.addResource\("\{proxy\+}"\)\.addMethod\("ANY", integration\);/,
  );
}

test("API Gateway routes backend paths through the greedy proxy", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
  assert.match(apiGatewaySource, /restApi\.root\.addMethod\("GET", integration\);/);
  assert.doesNotMatch(apiGatewaySource, /const meProgress = me\.addResource\("progress"\);/);
});

test("API Gateway keeps global snapshot and legacy auth as explicit edge routes", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assert.match(apiGatewaySource, /const global = restApi\.root\.addResource\("global"\);/);
  assert.match(apiGatewaySource, /defaultCorsPreflightOptions: globalMetricsCorsPreflightOptions/);
  assert.match(apiGatewaySource, /const legacyAuth = restApi\.root\.addResource\("auth"\);/);
  assert.match(apiGatewaySource, /legacyAuth\.addMethod\("ANY", notFoundIntegration, notFoundMethodOptions\);/);
});

test("API Gateway proxy accepts browser-safe binary bodies", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
  assert.match(
    apiGatewaySource,
    /binaryMediaTypes: \["\*\/\*"\]/,
  );
});

test("backend API and chat worker package sharp with ARM64 Docker bundling and managed media access", () => {
  const apiGatewaySource = loadApiGatewaySource();
  const backendConfiguration = getBackendFunctionConfiguration(apiGatewaySource, "BackendHandler");
  const chatWorkerConfiguration = getBackendFunctionConfiguration(apiGatewaySource, "ChatRunWorkerHandler");
  const chatLiveConfiguration = getBackendFunctionConfiguration(apiGatewaySource, "ChatLiveHandler");

  assert.match(
    backendConfiguration,
    /mediaAssetsBucket: props\.mediaAssetsBucket[\s\S]*memorySize: 1024[\s\S]*architecture: lambda\.Architecture\.ARM_64[\s\S]*nodeModules: \["sharp"\][\s\S]*forceDockerBundling: true/,
  );
  assert.match(
    chatWorkerConfiguration,
    /mediaAssetsBucket: props\.mediaAssetsBucket[\s\S]*memorySize: 1024[\s\S]*architecture: lambda\.Architecture\.ARM_64[\s\S]*nodeModules: \["sharp"\][\s\S]*forceDockerBundling: true/,
  );
  assert.match(
    apiGatewaySource,
    /hostPath: resolveFromRepoRoot\(\)[\s\S]*containerPath: dockerBundlingRepoRootPath/,
  );
  assert.match(
    apiGatewaySource,
    /SENTRY_BACKEND_CLI_PATH: `\$\{dockerBundlingRepoRootPath\}\/apps\/backend\/node_modules\/\.bin\/sentry-cli`/,
  );
  assert.equal(apiGatewaySource.match(/mediaAssetsBucket: props\.mediaAssetsBucket/g)?.length, 2);
  assert.equal(apiGatewaySource.match(/nodeModules: \["sharp"\]/g)?.length, 2);
  assert.doesNotMatch(
    chatLiveConfiguration,
    /mediaAssetsBucket: props\.mediaAssetsBucket/,
  );
  assert.doesNotMatch(
    chatLiveConfiguration,
    /nodeModules: \["sharp"\]/,
  );
});

test("API Gateway browser CORS allows PUT for admin updates", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /allowMethods: \["GET", "POST", "PUT", "PATCH", "OPTIONS"\]/);
});

test("global snapshot API Gateway mock preflight allows content type and Sentry trace headers", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "Api");
  const globalResource = restApi.root.addResource("global");
  globalResource.addResource("snapshot", {
    defaultCorsPreflightOptions: globalMetricsCorsPreflightOptions,
  });
  addTextContentHandlingToMockOptionsMethods(restApi);

  const template = Template.fromStack(stack);
  const methods = template.findResources("AWS::ApiGateway::Method", {
    Properties: {
      HttpMethod: "OPTIONS",
    },
  });
  const optionsMethods = Object.values(methods);

  assert.equal(optionsMethods.length, 1);
  assert.equal(optionsMethods[0]?.Properties?.Integration?.ContentHandling, "CONVERT_TO_TEXT");
  assert.equal(
    optionsMethods[0]?.Properties?.Integration?.IntegrationResponses?.[0]?.ContentHandling,
    "CONVERT_TO_TEXT",
  );
  assert.deepEqual(optionsMethods[0]?.Properties?.Integration?.IntegrationResponses?.[0]?.ResponseParameters, {
    "method.response.header.Access-Control-Allow-Headers": "'content-type,authorization,sentry-trace,baggage'",
    "method.response.header.Access-Control-Allow-Methods": "'GET,OPTIONS'",
    "method.response.header.Access-Control-Allow-Origin": "'*'",
  });
  assert.equal(
    optionsMethods[0]?.Properties?.MethodResponses?.[0]?.ResponseParameters?.[
      "method.response.header.Access-Control-Allow-Headers"
    ],
    true,
  );
});

test("legacy auth tombstone API Gateway mock response converts text under binary media types", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "Api", {
    binaryMediaTypes: ["*/*"],
  });
  const legacyAuth = restApi.root.addResource("auth");

  legacyAuth.addMethod("ANY", createLegacyAuthNotFoundIntegration(), {
    methodResponses: [
      {
        statusCode: "404",
      },
    ],
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::ApiGateway::Method", {
    HttpMethod: "ANY",
    Integration: {
      Type: "MOCK",
      ContentHandling: "CONVERT_TO_TEXT",
      IntegrationResponses: [
        {
          StatusCode: "404",
          ContentHandling: "CONVERT_TO_TEXT",
          ResponseTemplates: {
            "application/json": "{\"error\":\"Not found\"}",
          },
        },
      ],
      RequestTemplates: {
        "application/json": "{\"statusCode\": 404}",
      },
    },
    MethodResponses: [
      {
        StatusCode: "404",
      },
    ],
  });
});

test("chat live Lambda Function URL CORS exposes request id header", () => {
  const stack = new cdk.Stack();
  const fn = new lambda.Function(stack, "ChatLiveHandler", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 200 });"),
  });

  fn.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    cors: createChatLiveFunctionUrlCorsOptions(["https://app.example.test"]),
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Lambda::Url", {
    AuthType: "NONE",
    InvokeMode: "RESPONSE_STREAM",
    Cors: {
      AllowCredentials: true,
      AllowHeaders: [
        "content-type",
        "authorization",
        "x-csrf-token",
        "sentry-trace",
        "baggage",
        "x-chat-request-id",
        "x-chat-resume-attempt-id",
        "x-client-platform",
        "x-client-version",
        "x-media-asset-id",
        "x-media-source-url",
        "x-media-created-at",
        "x-media-client-updated-at",
        "x-media-last-modified-by-replica-id",
        "x-media-last-operation-id",
      ],
      AllowMethods: ["GET"],
      AllowOrigins: ["https://app.example.test"],
      ExposeHeaders: ["content-disposition", "x-request-id"],
    },
  });
});

test("media asset object IAM covers blob multipart transfer permissions", () => {
  const stack = new cdk.Stack();
  const bucket = new s3.Bucket(stack, "MediaAssetsBucket");
  const fn = new lambda.Function(stack, "BackendHandler", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 200 });"),
  });
  fn.addToRolePolicy(createMediaAssetsObjectPolicyStatement(bucket));

  const template = Template.fromStack(stack);
  const policyJson = JSON.stringify(template.findResources("AWS::IAM::Policy"));

  assert.match(policyJson, /s3:GetObject/);
  assert.match(policyJson, /s3:PutObject/);
  assert.match(policyJson, /s3:AbortMultipartUpload/);
  assert.match(policyJson, /s3:ListMultipartUploadParts/);
  assert.match(policyJson, /media\/blobs\/\*/);
  assert.match(policyJson, /media\/uploads\/\*/);
  assert.doesNotMatch(policyJson, /media-assets\/\*/);
});

test("default API Gateway generated errors expose supported request id headers", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "Api");
  restApi.root.addMethod("GET", new apigw.MockIntegration({
    integrationResponses: [{ statusCode: "204" }],
    requestTemplates: { "application/json": "{\"statusCode\": 204}" },
  }), {
    methodResponses: [{ statusCode: "204" }],
  });
  const gatewayErrorResponseHeaders = createGatewayErrorResponseHeaders();

  new apigw.GatewayResponse(stack, "ApiDefault4xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_4XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  new apigw.GatewayResponse(stack, "ApiDefault5xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_5XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  const template = Template.fromStack(stack);
  const allowHeaders = [
    "content-type",
    "authorization",
    "x-csrf-token",
    "sentry-trace",
    "baggage",
    "x-chat-request-id",
    "x-chat-resume-attempt-id",
    "x-client-platform",
    "x-client-version",
    "x-media-asset-id",
    "x-media-source-url",
    "x-media-created-at",
    "x-media-client-updated-at",
    "x-media-last-modified-by-replica-id",
    "x-media-last-operation-id",
  ].join(",");
  const responseParameters = {
    "gatewayresponse.header.Access-Control-Allow-Credentials": "'true'",
    "gatewayresponse.header.Access-Control-Allow-Headers": `'${allowHeaders}'`,
    "gatewayresponse.header.Access-Control-Allow-Methods": "'GET,POST,PUT,PATCH,OPTIONS'",
    "gatewayresponse.header.Access-Control-Allow-Origin": "method.request.header.Origin",
    "gatewayresponse.header.Access-Control-Expose-Headers": "'content-disposition,x-request-id,x-amzn-requestid,x-amz-apigw-id'",
    "gatewayresponse.header.Vary": "'Origin'",
    "gatewayresponse.header.X-Request-Id": "context.requestId",
  };

  template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
    ResponseType: "DEFAULT_4XX",
    ResponseParameters: responseParameters,
  });
  template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
    ResponseType: "DEFAULT_5XX",
    ResponseParameters: responseParameters,
  });
});
