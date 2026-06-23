#!/usr/bin/env python3

import argparse
import json
import math
import os
import pathlib
import re

AWS_ROLE_ARN_RE = re.compile(r"arn:(?P<partition>aws[a-z0-9-]*):iam::(?P<account_id>\d{12}):role/.+")
AWS_SECRETS_MANAGER_SECRET_ARN_RE = re.compile(
    r"arn:(?P<partition>aws[a-z0-9-]*):secretsmanager:[a-z0-9-]+:(?P<account_id>\d{12}):secret:.+",
)


def get_trimmed_env(name: str) -> str:
    return os.environ.get(name, "").strip()


def get_raw_env(name: str) -> str:
    return os.environ.get(name, "")


def require_non_empty_context_value(values: dict[str, str], key: str, env_name: str) -> None:
    if values.get(key, "") == "":
        raise ValueError(f"{env_name} is required for CI AWS deploy context")


def validate_sentry_traces_sample_rate(value: str) -> None:
    try:
        traces_sample_rate = float(value)
    except ValueError as exc:
        raise ValueError("CDK_CONTEXT_SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1") from exc

    if not math.isfinite(traces_sample_rate) or traces_sample_rate < 0 or traces_sample_rate > 1:
        raise ValueError("CDK_CONTEXT_SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1")


def get_deploy_role_account_id(aws_deploy_role_arn: str) -> str:
    match = AWS_ROLE_ARN_RE.fullmatch(aws_deploy_role_arn)
    if match is None:
        raise ValueError(
            "AWS_DEPLOY_ROLE_ARN must be a valid IAM role ARN so CI can derive githubOidcProviderArn",
        )
    return match.group("account_id")


def get_secrets_manager_secret_account_id(secret_arn: str) -> str:
    match = AWS_SECRETS_MANAGER_SECRET_ARN_RE.fullmatch(secret_arn)
    if match is None:
        raise ValueError("CDK_CONTEXT_SENTRY_DSN_SECRET_ARN must be a valid Secrets Manager secret ARN")
    return match.group("account_id")


def validate_sentry_secret_account(values: dict[str, str], aws_deploy_role_arn: str) -> None:
    if aws_deploy_role_arn == "" or values["sentryDsnSecretArn"] == "":
        return

    deploy_account_id = get_deploy_role_account_id(aws_deploy_role_arn)
    sentry_secret_account_id = get_secrets_manager_secret_account_id(values["sentryDsnSecretArn"])
    if sentry_secret_account_id != deploy_account_id:
        raise ValueError(
            "CDK_CONTEXT_SENTRY_DSN_SECRET_ARN must be in the same AWS account as AWS_DEPLOY_ROLE_ARN "
            f"({deploy_account_id}); got secret account {sentry_secret_account_id}",
        )


def validate_required_backend_sentry_context(values: dict[str, str], aws_deploy_role_arn: str) -> None:
    sentry_context_env_names = {
        "sentryDsnSecretArn": "CDK_CONTEXT_SENTRY_DSN_SECRET_ARN",
        "sentryEnvironment": "CDK_CONTEXT_SENTRY_ENVIRONMENT",
        "sentryRelease": "CDK_CONTEXT_SENTRY_RELEASE",
        "sentryTracesSampleRate": "CDK_CONTEXT_SENTRY_TRACES_SAMPLE_RATE",
    }

    if aws_deploy_role_arn == "":
        configured_values = [values[key] for key in sentry_context_env_names if values[key] != ""]
        if len(configured_values) == 0:
            return
    else:
        for key, env_name in sentry_context_env_names.items():
            require_non_empty_context_value(values, key, env_name)

    missing_env_names = [
        env_name
        for key, env_name in sentry_context_env_names.items()
        if values[key] == ""
    ]
    if len(missing_env_names) > 0:
        joined_missing_env_names = ", ".join(missing_env_names)
        raise ValueError(f"Backend Sentry context must be configured all-or-none. Missing: {joined_missing_env_names}")

    validate_sentry_traces_sample_rate(values["sentryTracesSampleRate"])
    validate_sentry_secret_account(values, aws_deploy_role_arn)


def build_github_oidc_provider_arn(aws_deploy_role_arn: str) -> str:
    if aws_deploy_role_arn == "":
        return ""

    match = AWS_ROLE_ARN_RE.fullmatch(aws_deploy_role_arn)
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
        "mcpCertificateArn": get_trimmed_env("CDK_CONTEXT_MCP_CERTIFICATE_ARN"),
        "adminCertificateArnUsEast1": get_trimmed_env("CDK_CONTEXT_ADMIN_CERTIFICATE_ARN_US_EAST_1"),
        "adminEmails": get_trimmed_env("CDK_CONTEXT_ADMIN_EMAILS"),
        "demoEmailDostip": get_trimmed_env("CDK_CONTEXT_DEMO_EMAIL_DOSTIP"),
        "demoPasswordSecretArn": get_trimmed_env("CDK_CONTEXT_DEMO_PASSWORD_SECRET_ARN"),
        "domainName": get_trimmed_env("CDK_CONTEXT_DOMAIN_NAME"),
        "githubOidcProviderArn": build_github_oidc_provider_arn(aws_deploy_role_arn),
        "githubRepo": get_trimmed_env("CDK_CONTEXT_GITHUB_REPO"),
        "globalMetricsVisible": get_raw_env("CDK_CONTEXT_GLOBAL_METRICS_VISIBLE"),
        "guestAiWeightedMonthlyTokenCap": get_trimmed_env("CDK_CONTEXT_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP"),
        "langfuseBaseUrl": get_trimmed_env("CDK_CONTEXT_LANGFUSE_BASE_URL"),
        "langfusePublicKeySecretArn": get_trimmed_env("CDK_CONTEXT_LANGFUSE_PUBLIC_KEY_SECRET_ARN"),
        "langfuseSecretKeySecretArn": get_trimmed_env("CDK_CONTEXT_LANGFUSE_SECRET_KEY_SECRET_ARN"),
        "openAiApiKeySecretArn": get_trimmed_env("CDK_CONTEXT_OPENAI_API_KEY_SECRET_ARN"),
        "region": get_trimmed_env("CDK_CONTEXT_REGION"),
        "resendApiKeySecretArn": get_trimmed_env("CDK_CONTEXT_RESEND_API_KEY_SECRET_ARN"),
        "resendSenderEmail": get_trimmed_env("CDK_CONTEXT_RESEND_SENDER_EMAIL"),
        "sentryDsnSecretArn": get_trimmed_env("CDK_CONTEXT_SENTRY_DSN_SECRET_ARN"),
        "sentryEnvironment": get_trimmed_env("CDK_CONTEXT_SENTRY_ENVIRONMENT"),
        "sentryRelease": get_trimmed_env("CDK_CONTEXT_SENTRY_RELEASE"),
        "sentryTracesSampleRate": get_trimmed_env("CDK_CONTEXT_SENTRY_TRACES_SAMPLE_RATE"),
        "siteBaseUrl": get_trimmed_env("CDK_CONTEXT_SITE_BASE_URL"),
        "webCertificateArnUsEast1": get_trimmed_env("CDK_CONTEXT_WEB_CERTIFICATE_ARN_US_EAST_1"),
    }
    validate_required_backend_sentry_context(values, aws_deploy_role_arn)
    return {key: value for key, value in values.items() if value != ""}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write the CI CDK context file from workflow environment variables.",
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--aws-deploy-role-arn", required=False, default="")
    args = parser.parse_args()

    output_path = pathlib.Path(args.output)
    try:
        context_values = build_context_values(args.aws_deploy_role_arn)
    except ValueError as exc:
        raise SystemExit(f"ERROR: {exc}") from None

    output_path.write_text(json.dumps(context_values, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
