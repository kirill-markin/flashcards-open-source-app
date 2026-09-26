# Monitoring stack migration

Normal releases use the `legacy` topology: `FlashcardsOpenSourceApp` owns all
resources. The temporary `monitoringTopology=split` context synthesizes
`FlashcardsOpenSourceAppMonitoring` for preparation only. Never deploy that
assembly before the native CloudFormation refactor is approved and executed.

The intended move is exactly 58 CloudWatch alarms and 8 Logs metric filters.
SNS topic/subscription, core outputs, functions, log groups and their retention
resources remain in core. Monitoring imports core references; core never imports
monitoring. The freshness metric retains the producer's core `StackName`.

## Preparation evidence

`AWS/Web Release` runs the comparison after the final ENABLED deployment and
schedule verification. It preserves that deployment's `cdk.out`, synthesizes a
separate split assembly with the same checkout, account, region, local context
and final schedule/cleanup flags, and leaves source-map upload disabled.

The comparison helper requires the same alarm/filter logical IDs and relative
construct paths, unchanged resource properties after expanding only literal CDK
imports of direct core `Ref`/`Fn::GetAtt` exports, unchanged surviving resources
(including Lambda asset keys, versions, API deployments and settings), and
unchanged published outputs. It classifies CDK telemetry, bootstrap checks and
new exports explicitly. Unnamed alarms/filters remain unnamed in both templates;
their actual CloudFormation-generated physical names must be preserved and
verified by the server refactor, not guessed or newly set in code.

The private runner directory `${RUNNER_TEMP}/monitoring-refactor` contains the
legacy/split assemblies and detailed `report/evidence.private.json`. Only
`resource-mappings.json` and a sanitized count/status summary are uploaded.
Do not upload templates, local context or the private report as public artifacts.
A failed comparison emits an explicit warning and blocks migration; the ordinary
legacy release remains usable. A passing comparison proves template equivalence
within the stated boundary, **not AWS refactor eligibility**.

To repeat preparation, run in the same cloud job after a fresh successful final
legacy deployment; do not synthesize deployment artifacts locally:

```bash
umask 077
mkdir -p "${RUNNER_TEMP}/monitoring-refactor"
cp -R cdk.out "${RUNNER_TEMP}/monitoring-refactor/legacy"
SENTRY_UPLOAD_BACKEND_SOURCEMAPS=false npx cdk synth --all --quiet \
  --output "${RUNNER_TEMP}/monitoring-refactor/split" \
  -c monitoringTopology=split \
  -c generatedMediaPromotionScheduleState=ENABLED \
  -c mediaBlobCleanupEnabled=true \
  -c multipartCompletionReconciliationScheduleState=ENABLED
python3 ../../scripts/deploy/prepare-monitoring-refactor.py \
  --legacy-assembly "${RUNNER_TEMP}/monitoring-refactor/legacy" \
  --split-assembly "${RUNNER_TEMP}/monitoring-refactor/split" \
  --output-directory "${RUNNER_TEMP}/monitoring-refactor/report"
```

## Next-stage server preview

Perform this only in the separately authorized migration stage. Serialize all
releases, regenerate the evidence from the exact final deployed assembly in the
same CI run, and stop if the source stack changes during preparation. Refresh
`DescribeStacks`, `GetTemplate`, `ListStackResources`, `GetStackPolicy`, regional
`DescribeType` provisioning support for both moved types, and SNS subscription
confirmation. Confirm the target does not exist. Save the current 66 physical
IDs, alert topic ARN, confirmed subscription ARN, output values, and log-group
ownership for comparison after execution. Compare the deployed source template
to the final legacy assembly before asking AWS to plan the move.

The pinned CDK CLI 2.1142.0 rejects creating a new stack during `_refactor`, even
for dry runs. Do not invoke `cdk refactor` or replace the bootstrap to work around
that restriction. Use the public native CloudFormation API with
`EnableStackCreation=true` instead.

After a narrowly scoped migration role is available, create a server-side plan
using the exact private split templates and generated mappings. From
`${RUNNER_TEMP}/monitoring-refactor`:

```bash
aws cloudformation create-stack-refactor \
  --region eu-central-1 \
  --enable-stack-creation \
  --description "Move the existing monitoring resources without replacement" \
  --resource-mappings file://report/resource-mappings.json \
  --stack-definitions \
    StackName=FlashcardsOpenSourceApp,TemplateBody@=file://split/FlashcardsOpenSourceApp.template.json \
    StackName=FlashcardsOpenSourceAppMonitoring,TemplateBody@=file://split/FlashcardsOpenSourceAppMonitoring.template.json \
  > server-preview.private.json
```

Poll `describe-stack-refactor --stack-refactor-id <id>` until creation completes,
then save every page from `list-stack-refactor-actions --stack-refactor-id <id>`
privately. Require exactly the intended moves, no replacements or workload
creation/deletion, preserved names/properties/metric dimensions, and an explicit
AWS decision on target CDK metadata, bootstrap parameters and outputs. Any
unexplained action or server rejection blocks execution; preparation must not
claim success from only the local comparison.

The current repository deployment policy delegates ordinary deployment to CDK
roles and scopes stack reads to core. It does not grant native refactor actions.
The migration stage must inspect the actual OIDC and bootstrap role policies,
trust and resource scopes, then supply narrow permissions for
`CreateStackRefactor`, `DescribeStackRefactor`, `ListStackRefactorActions` and
`ExecuteStackRefactor`, the necessary stack/resource reads, and new-target stack
creation. Do not assume CDK role assumption alone authorizes these operations.
No IAM or bootstrap modification is part of preparation.

## Recovery boundaries

Before execution, an unsuccessful comparison or server preview changes no
existing resource ownership: keep releasing legacy. Creating a server preview
can create an empty target when stack creation is enabled; inspect its status
and follow the separately approved migration procedure before cleanup.

After execution, never run a legacy deployment to roll back. Inspect both stacks,
verify the physical identities and notification subscription, and use a reviewed
reverse native refactor if recovery is needed. Delete/create and retain/import
are not substitutes. The subsequent finalization removes the temporary topology
switch only after the split is the deployed and verified source of truth.

References: [native CreateStackRefactor](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-stack-refactor.html),
[stack refactoring](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html),
[release gates](release-gates.md).
