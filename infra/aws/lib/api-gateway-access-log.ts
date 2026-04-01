import * as apigw from "aws-cdk-lib/aws-apigateway";

export function createSafeApiGatewayAccessLogFormat(): apigw.AccessLogFormat {
  return apigw.AccessLogFormat.custom(JSON.stringify({
    requestId: apigw.AccessLogField.contextRequestId(),
    extendedRequestId: apigw.AccessLogField.contextExtendedRequestId(),
    apiId: apigw.AccessLogField.contextApiId(),
    domainName: apigw.AccessLogField.contextDomainName(),
    stage: apigw.AccessLogField.contextStage(),
    httpMethod: apigw.AccessLogField.contextHttpMethod(),
    resourcePath: apigw.AccessLogField.contextResourcePath(),
    status: apigw.AccessLogField.contextStatus(),
    protocol: apigw.AccessLogField.contextProtocol(),
    responseLength: apigw.AccessLogField.contextResponseLength(),
    requestTime: apigw.AccessLogField.contextRequestTime(),
    ip: apigw.AccessLogField.contextIdentitySourceIp(),
    userAgent: apigw.AccessLogField.contextIdentityUserAgent(),
    integrationStatus: apigw.AccessLogField.contextIntegrationStatus(),
    integrationLatency: apigw.AccessLogField.contextIntegrationLatency(),
    integrationError: apigw.AccessLogField.contextIntegrationErrorMessage(),
    errorMessage: apigw.AccessLogField.contextErrorMessage(),
  }));
}
