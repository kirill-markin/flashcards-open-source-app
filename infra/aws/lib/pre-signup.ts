/** CDK construct for the Cognito PreSignUp Lambda trigger. */
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

export function preSignUp(scope: Construct): lambda.Function {
  const fn = new lambda.Function(scope, "PreSignUpFn", {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/pre-signup")),
    description: "Auto-confirm user and verify email on sign-up",
  });

  fn.addPermission("CognitoInvoke", {
    principal: new iam.ServicePrincipal("cognito-idp.amazonaws.com"),
  });

  return fn;
}
