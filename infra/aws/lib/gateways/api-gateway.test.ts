import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import {
  createChatLiveFunctionUrlCorsOptions,
  createGatewayErrorResponseHeaders,
  globalMetricsCorsPreflightOptions,
} from "./api-gateway";

test("API Gateway predeclares /me/community/profile", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityProfile = meCommunity\.addResource\("profile"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("PATCH", integration\);/);
});

test("API Gateway predeclares friend invitation routes", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityFriendInvitations = meCommunity\.addResource\("friend-invitations"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityFriendInvitations\.addMethod\("POST", integration\);/);
  assert.match(
    apiGatewaySource,
    /meCommunityFriendInvitations\s*\.addResource\("\{inviteToken\}"\)\s*\.addResource\("accept"\)\s*\.addMethod\("POST", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /const communityFriendInvitations = community\.addResource\("friend-invitations"\);/,
  );
  assert.match(
    apiGatewaySource,
    /communityFriendInvitations\.addResource\("\{inviteToken\}"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboard", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboards/streak", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meProgressLeaderboards = meProgress\.addResource\("leaderboards"\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboards\.addResource\("streak"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboards/profiles/{publicProfileId}", () => {
  const apiGatewayPath = resolve(process.cwd(), "lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meProgressLeaderboardProfiles = meProgressLeaderboards\.addResource\("profiles"\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboardProfiles\.addResource\("\{publicProfileId\}"\)\.addMethod\("GET", integration\);/,
  );
});

test("global snapshot API Gateway mock preflight allows content type and Sentry trace headers", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "Api");
  const globalResource = restApi.root.addResource("global");
  globalResource.addResource("snapshot", {
    defaultCorsPreflightOptions: globalMetricsCorsPreflightOptions,
  });

  const template = Template.fromStack(stack);
  const methods = template.findResources("AWS::ApiGateway::Method", {
    Properties: {
      HttpMethod: "OPTIONS",
    },
  });
  const optionsMethods = Object.values(methods);

  assert.equal(optionsMethods.length, 1);
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
      ],
      AllowMethods: ["GET"],
      AllowOrigins: ["https://app.example.test"],
      ExposeHeaders: ["x-request-id"],
    },
  });
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
  ].join(",");
  const responseParameters = {
    "gatewayresponse.header.Access-Control-Allow-Credentials": "'true'",
    "gatewayresponse.header.Access-Control-Allow-Headers": `'${allowHeaders}'`,
    "gatewayresponse.header.Access-Control-Allow-Methods": "'GET,POST,PATCH,OPTIONS'",
    "gatewayresponse.header.Access-Control-Allow-Origin": "method.request.header.Origin",
    "gatewayresponse.header.Access-Control-Expose-Headers": "'x-request-id,x-amzn-requestid,x-amz-apigw-id'",
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
