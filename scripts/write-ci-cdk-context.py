#!/usr/bin/env python3

import argparse
import json
import os
import pathlib
import re


def get_trimmed_env(name: str) -> str:
    return os.environ.get(name, "").strip()


def build_github_oidc_provider_arn(aws_deploy_role_arn: str) -> str:
    if aws_deploy_role_arn == "":
        return ""

    match = re.fullmatch(
        r"arn:(?P<partition>aws[a-z0-9-]*):iam::(?P<account_id>\d{12}):role/.+",
        aws_deploy_role_arn,
    )
    if match is None:
        raise ValueError(
            "AWS_DEPLOY_ROLE_ARN must be a valid IAM role ARN so CI can derive githubOidcProviderArn",
        )

    partition = match.group("partition")
    account_id = match.group("account_id")
    return f"arn:{partition}:iam::{account_id}:oidc-provider/token.actions.githubusercontent.com"


def build_context_values(aws_deploy_role_arn: str) -> dict[str, str]:
    values = {
        "alertEmail": get_trimmed_env("CDK_CONTEXT_ALERT_EMAIL"),
        "analyticsSshAllowedCidrs": get_trimmed_env("CDK_CONTEXT_ANALYTICS_SSH_ALLOWED_CIDRS"),
        "analyticsSshPublicKeys": get_trimmed_env("CDK_CONTEXT_ANALYTICS_SSH_PUBLIC_KEYS"),
        "analyticsSshUsername": get_trimmed_env("CDK_CONTEXT_ANALYTICS_SSH_USERNAME"),
        "anthropicApiKeySecretArn": get_trimmed_env("CDK_CONTEXT_ANTHROPIC_API_KEY_SECRET_ARN"),
        "apiCertificateArn": get_trimmed_env("CDK_CONTEXT_API_CERTIFICATE_ARN"),
        "apexRedirectCertificateArnUsEast1": get_trimmed_env("CDK_CONTEXT_APEX_REDIRECT_CERTIFICATE_ARN_US_EAST_1"),
        "authCertificateArn": get_trimmed_env("CDK_CONTEXT_AUTH_CERTIFICATE_ARN"),
        "adminCertificateArnUsEast1": get_trimmed_env("CDK_CONTEXT_ADMIN_CERTIFICATE_ARN_US_EAST_1"),
        "adminEmails": get_trimmed_env("CDK_CONTEXT_ADMIN_EMAILS"),
        "demoEmailDostip": get_trimmed_env("CDK_CONTEXT_DEMO_EMAIL_DOSTIP"),
        "demoPasswordSecretArn": get_trimmed_env("CDK_CONTEXT_DEMO_PASSWORD_SECRET_ARN"),
        "domainName": get_trimmed_env("CDK_CONTEXT_DOMAIN_NAME"),
        "githubOidcProviderArn": build_github_oidc_provider_arn(aws_deploy_role_arn),
        "githubRepo": get_trimmed_env("CDK_CONTEXT_GITHUB_REPO"),
        "guestAiWeightedMonthlyTokenCap": get_trimmed_env("CDK_CONTEXT_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP"),
        "langfuseBaseUrl": get_trimmed_env("CDK_CONTEXT_LANGFUSE_BASE_URL"),
        "langfusePublicKeySecretArn": get_trimmed_env("CDK_CONTEXT_LANGFUSE_PUBLIC_KEY_SECRET_ARN"),
        "langfuseSecretKeySecretArn": get_trimmed_env("CDK_CONTEXT_LANGFUSE_SECRET_KEY_SECRET_ARN"),
        "openAiApiKeySecretArn": get_trimmed_env("CDK_CONTEXT_OPENAI_API_KEY_SECRET_ARN"),
        "region": get_trimmed_env("CDK_CONTEXT_REGION"),
        "resendApiKeySecretArn": get_trimmed_env("CDK_CONTEXT_RESEND_API_KEY_SECRET_ARN"),
        "resendSenderEmail": get_trimmed_env("CDK_CONTEXT_RESEND_SENDER_EMAIL"),
        "webCertificateArnUsEast1": get_trimmed_env("CDK_CONTEXT_WEB_CERTIFICATE_ARN_US_EAST_1"),
    }
    return {key: value for key, value in values.items() if value != ""}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write the CI CDK context file from workflow environment variables.",
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--aws-deploy-role-arn", required=False, default="")
    args = parser.parse_args()

    output_path = pathlib.Path(args.output)
    output_path.write_text(
        json.dumps(build_context_values(args.aws_deploy_role_arn), indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
