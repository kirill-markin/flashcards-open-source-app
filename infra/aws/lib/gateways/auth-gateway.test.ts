import assert from "node:assert/strict";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Template } from "aws-cdk-lib/assertions";
import { createAuthGatewayErrorResponseHeaders } from "./auth-gateway";

test("auth API Gateway generated errors expose CORS and supported request id headers", () => {
  const stack = new cdk.Stack();
  const restApi = new apigw.RestApi(stack, "AuthApi");
  restApi.root.addMethod("GET", new apigw.MockIntegration({
    integrationResponses: [{ statusCode: "204" }],
    requestTemplates: { "application/json": "{\"statusCode\": 204}" },
  }), {
    methodResponses: [{ statusCode: "204" }],
  });
  const gatewayErrorResponseHeaders = createAuthGatewayErrorResponseHeaders();

  new apigw.GatewayResponse(stack, "AuthApiDefault4xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_4XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  new apigw.GatewayResponse(stack, "AuthApiDefault5xxGatewayResponse", {
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
  ].join(",");
  const responseParameters = {
    "gatewayresponse.header.Access-Control-Allow-Credentials": "'true'",
    "gatewayresponse.header.Access-Control-Allow-Headers": `'${allowHeaders}'`,
    "gatewayresponse.header.Access-Control-Allow-Methods": "'GET,POST,OPTIONS'",
    "gatewayresponse.header.Access-Control-Allow-Origin": "method.request.header.Origin",
    "gatewayresponse.header.Access-Control-Expose-Headers": "'retry-after,x-request-id,x-amzn-requestid,x-amz-apigw-id'",
    "gatewayresponse.header.Vary": "'Origin'",
  };
  const gatewayResponses = template.findResources("AWS::ApiGateway::GatewayResponse");

  assert.equal(Object.keys(gatewayResponses).length, 2);
  template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
    ResponseType: "DEFAULT_4XX",
    ResponseParameters: responseParameters,
  });
  template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
    ResponseType: "DEFAULT_5XX",
    ResponseParameters: responseParameters,
  });
});
