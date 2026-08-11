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
  addDirectImageIngestionApiRoutes,
  addTextContentHandlingToMockOptionsMethods,
  createLegacyAuthNotFoundIntegration,
  createDirectImageIngestionObjectPolicyStatement,
  createMediaAssetsObjectPolicyStatement,
  createChatLiveFunctionUrlCorsOptions,
  createGatewayErrorResponseHeaders,
  directImageIngestionLambdaTimeoutSeconds,
  directImageIngestionMaximumOnDemandInitSeconds,
  globalMetricsCorsPreflightOptions,
  publicRestApiDefaultIntegrationTimeoutSeconds,
} from "./api-gateway";
import {
  createDirectImageIngestionHandled5xxFilterPattern,
} from "../monitoring";

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

test("API Gateway exposes catalog with site, app, and local credential-free CORS origins", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assert.match(
    apiGatewaySource,
    /const publicAppOrigin = parsePublicOrigin\(\s*`https:\/\/app\.\$\{props\.baseDomain\}`,\s*"appBaseUrl",\s*\);/,
  );
  assert.match(
    apiGatewaySource,
    /const publicSiteOrigin = parsePublicOrigin\(\s*props\.siteBaseUrl \?\? `https:\/\/\$\{props\.baseDomain\}`,\s*"siteBaseUrl",\s*\);/,
  );
  assert.match(
    apiGatewaySource,
    /const publicCatalogAllowedOrigins = \[\s*publicSiteOrigin,\s*publicAppOrigin,\s*"http:\/\/localhost:3000",\s*\];/,
  );
  assert.match(
    apiGatewaySource,
    /const catalog = restApi\.root\.addResource\("catalog",[\s\S]*catalog\.addMethod\("GET", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /PUBLIC_APP_BASE_URL: props\.publicAppOrigin/,
  );
  const publicCatalogCorsStart = apiGatewaySource.indexOf(
    "function createPublicCatalogCorsPreflightOptions",
  );
  const publicCatalogCorsEnd = apiGatewaySource.indexOf("\n}\n", publicCatalogCorsStart);
  assert.notEqual(publicCatalogCorsStart, -1);
  assert.notEqual(publicCatalogCorsEnd, -1);
  const publicCatalogCorsSource = apiGatewaySource.slice(
    publicCatalogCorsStart,
    publicCatalogCorsEnd,
  );
  assert.match(publicCatalogCorsSource, /allowOrigins: allowedOrigins/);
  assert.match(publicCatalogCorsSource, /allowMethods: \["GET", "OPTIONS"\]/);
  assert.doesNotMatch(publicCatalogCorsSource, /allowCredentials/);
  assert.doesNotMatch(publicCatalogCorsSource, /\["\*"\]/);
});

test("API Gateway proxy accepts browser-safe binary bodies", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
  assert.match(
    apiGatewaySource,
    /binaryMediaTypes: \["\*\/\*"\]/,
  );
});

test("backend, direct ingestion, and chat worker package sharp with ARM64 Docker bundling", () => {
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
    /"DirectImageIngestionHandler"[\s\S]*lambda-direct-image-ingestion\.ts[\s\S]*timeout: cdk\.Duration\.seconds\(directImageIngestionLambdaTimeoutSeconds\)[\s\S]*memorySize: 1024[\s\S]*architecture: lambda\.Architecture\.ARM_64[\s\S]*nodeModules: \["sharp"\][\s\S]*forceDockerBundling: true/,
  );
  assert.match(
    apiGatewaySource,
    /hostPath: resolveFromRepoRoot\(\)[\s\S]*containerPath: dockerBundlingRepoRootPath/,
  );
  assert.match(
    apiGatewaySource,
    /SENTRY_BACKEND_CLI_PATH: `\$\{dockerBundlingRepoRootPath\}\/apps\/backend\/node_modules\/\.bin\/sentry-cli`/,
  );
  assert.equal(apiGatewaySource.match(/mediaAssetsBucket: props\.mediaAssetsBucket/g)?.length, 3);
  assert.equal(apiGatewaySource.match(/nodeModules: \["sharp"\]/g)?.length, 3);
  assert.doesNotMatch(
    chatLiveConfiguration,
    /mediaAssetsBucket: props\.mediaAssetsBucket/,
  );
  assert.doesNotMatch(
    chatLiveConfiguration,
    /nodeModules: \["sharp"\]/,
  );
});

test("direct ingestion has a hard service envelope and one explicit API Gateway owner", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assert.equal(directImageIngestionMaximumOnDemandInitSeconds, 10);
  assert.equal(directImageIngestionLambdaTimeoutSeconds, 15);
  assert.equal(
    publicRestApiDefaultIntegrationTimeoutSeconds
      - directImageIngestionMaximumOnDemandInitSeconds
      - directImageIngestionLambdaTimeoutSeconds,
    4,
  );
  assert.ok(
    directImageIngestionMaximumOnDemandInitSeconds
      + directImageIngestionLambdaTimeoutSeconds
      < publicRestApiDefaultIntegrationTimeoutSeconds,
  );
  assert.match(
    apiGatewaySource,
    /addDirectImageIngestionApiRoutes\(\s*restApi,\s*integration,\s*directImageIngestionIntegration,\s*\);/,
  );
  assert.equal(
    apiGatewaySource.match(
      /new apigw\.LambdaIntegration\(\s*directImageIngestionFn,/g,
    )?.length,
    1,
  );
});

test("direct ingestion monitoring covers handled HTTP 5xx and thrown Lambda failures", () => {
  const monitoringSource = readFileSync(
    resolve(process.cwd(), "lib/monitoring.ts"),
    "utf8",
  );
  const handled5xxPattern =
    createDirectImageIngestionHandled5xxFilterPattern().logPatternString;

  assert.match(
    handled5xxPattern,
    /direct_image_ingestion_handled_http_5xx/,
  );
  assert.match(handled5xxPattern, /\$\.message\.statusCode >= 500/);
  assert.match(handled5xxPattern, /\$\.message\.statusCode < 600/);
  assert.match(
    monitoringSource,
    /\$\.message\.action/,
  );
  assert.match(
    monitoringSource,
    /DirectImageIngestionLambdaErrorAlarm[\s\S]*directImageIngestionFn\.metricErrors/,
  );
  assert.match(
    monitoringSource,
    /DirectImageIngestionHandled5xxMetricFilter[\s\S]*directImageIngestionFn\.logGroup[\s\S]*DirectImageIngestionHandled5xxAlarm/,
  );
  assert.match(
    loadApiGatewaySource(),
    /DirectImageIngestionHandler[\s\S]*loggingFormat: lambda\.LoggingFormat\.JSON/,
  );
});

test("direct ingestion routes keep shared workspace and catalog admin fallbacks", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "Api");
  const sharedIntegration = new apigw.MockIntegration({
    integrationResponses: [{ statusCode: "200" }],
  });
  const directIntegration = new apigw.MockIntegration({
    integrationResponses: [{ statusCode: "201" }],
  });

  const routes = addDirectImageIngestionApiRoutes(
    restApi,
    sharedIntegration,
    directIntegration,
  );

  assert.equal(
    routes.workspaceImages.path,
    "/workspaces/{workspaceId}/media-assets/images",
  );
  assert.doesNotThrow(() => routes.workspaceImages.node.findChild("ANY"));
  assert.doesNotThrow(() => routes.workspaceImages.node.findChild("POST"));
  assert.equal(
    routes.catalogCardImages.path,
    "/admin/catalog/packages/{packageId}/media-assets/images",
  );
  assert.doesNotThrow(() => routes.catalogCardImages.node.findChild("ANY"));
  assert.doesNotThrow(() => routes.catalogCardImages.node.findChild("POST"));
  assert.equal(
    routes.catalogCover.path,
    "/admin/catalog/packages/{packageId}/cover",
  );
  assert.doesNotThrow(() => routes.catalogCover.node.findChild("ANY"));
  assert.doesNotThrow(() => routes.catalogCover.node.findChild("PUT"));
  assert.equal(
    routes.catalogCollectionCover.path,
    "/admin/catalog/collections/{collectionId}/cover",
  );
  assert.doesNotThrow(() => routes.catalogCollectionCover.node.findChild("ANY"));
  assert.doesNotThrow(() => routes.catalogCollectionCover.node.findChild("PUT"));
  const workspaces = restApi.root.getResource("workspaces");
  const workspace = workspaces?.getResource("{workspaceId}");
  const mediaAssets = workspace?.getResource("media-assets");
  assert.notEqual(workspace?.getResource("{proxy+}"), undefined);
  assert.notEqual(mediaAssets?.getResource("{proxy+}"), undefined);
  const admin = restApi.root.getResource("admin");
  const catalog = admin?.getResource("catalog");
  const packages = catalog?.getResource("packages");
  const catalogPackage = packages?.getResource("{packageId}");
  const packageMediaAssets = catalogPackage?.getResource("media-assets");
  const collections = catalog?.getResource("collections");
  const catalogCollection = collections?.getResource("{collectionId}");
  assert.notEqual(admin?.getResource("{proxy+}"), undefined);
  assert.notEqual(catalog?.getResource("{proxy+}"), undefined);
  assert.notEqual(catalogPackage?.getResource("{proxy+}"), undefined);
  assert.notEqual(packageMediaAssets?.getResource("{proxy+}"), undefined);
  assert.notEqual(catalogCollection?.getResource("{proxy+}"), undefined);
});

test("custom-domain mapping strips one v1 segment before direct route selection", () => {
  const apiGatewaySource = loadApiGatewaySource();
  assert.match(apiGatewaySource, /basePath: "v1"/);
  assert.match(
    apiGatewaySource,
    /addDirectImageIngestionApiRoutes\(\s*restApi,\s*integration,\s*directImageIngestionIntegration,\s*\);/,
  );
  assertApiGatewayUsesBackendProxy(apiGatewaySource);
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
        "x-package-media-key",
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

test("direct ingestion object IAM is limited to permanent blob reads and writes", () => {
  const stack = new cdk.Stack();
  const bucket = new s3.Bucket(stack, "MediaAssetsBucket");
  const fn = new lambda.Function(stack, "DirectImageIngestionHandler", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 200 });"),
  });
  fn.addToRolePolicy(createDirectImageIngestionObjectPolicyStatement(bucket));

  const template = Template.fromStack(stack);
  const policyJson = JSON.stringify(template.findResources("AWS::IAM::Policy"));

  assert.match(policyJson, /s3:GetObject/);
  assert.match(policyJson, /s3:PutObject/);
  assert.match(policyJson, /media\/blobs\/\*/);
  assert.doesNotMatch(policyJson, /s3:AbortMultipartUpload/);
  assert.doesNotMatch(policyJson, /s3:ListMultipartUploadParts/);
  assert.doesNotMatch(policyJson, /media\/uploads\/\*/);
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
    "x-package-media-key",
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
