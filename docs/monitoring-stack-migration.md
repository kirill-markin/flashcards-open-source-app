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
schedule verification. It privately copies that deployment's `cdk.out` before
synthesizing the split topology into the same `cdk.out` staging location, then
copies the split assembly privately. The checkout, account, region, local context,
final schedule/cleanup flags and disabled source-map upload stay identical.

The pinned CDK uses output hashes for NodejsFunction assets and includes the
staging directory in its bundling cache key. Local esbuild source maps contain
paths relative to the bundle output directory, so synthesizing directly into a
new evidence directory changes Lambda assets. Reusing the original output path
preserves those inputs; it does not guarantee that bundling is skipped. Any
remaining asset or migration-version difference must still fail comparison.
See [CDK asset staging](https://github.com/aws/aws-cdk/blob/v2.270.0/packages/aws-cdk-lib/core/lib/asset-staging.ts),
[NodejsFunction bundling](https://github.com/aws/aws-cdk/blob/v2.270.0/packages/aws-cdk-lib/aws-lambda-nodejs/lib/bundling.ts)
and [esbuild source-map paths](https://github.com/evanw/esbuild/blob/v0.28.2/internal/linker/linker.go#L7097-L7111).

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

To repeat preparation, run from `infra/aws` in the same cloud job after a fresh
successful final legacy deployment; do not synthesize deployment artifacts
locally. The evidence directory must not already exist. Preserve earlier evidence
separately before repeating; never reuse a split assembly as the legacy baseline.

```bash
set -euo pipefail
umask 077
evidence_directory="${RUNNER_TEMP}/monitoring-refactor"
mkdir "${evidence_directory}"
for baseline_file in manifest.json FlashcardsOpenSourceApp.template.json FlashcardsOpenSourceApp.assets.json; do
  if [[ ! -s "cdk.out/${baseline_file}" ]]; then
    echo "Missing final legacy assembly file: cdk.out/${baseline_file}" >&2
    exit 1
  fi
done
if [[ -e cdk.out/FlashcardsOpenSourceAppMonitoring.template.json ]]; then
  echo "Expected the final legacy assembly; cdk.out contains a monitoring preview." >&2
  exit 1
fi
cp -R cdk.out "${evidence_directory}/legacy"
SENTRY_UPLOAD_BACKEND_SOURCEMAPS=false npx cdk synth --all --quiet \
  --output cdk.out \
  -c monitoringTopology=split \
  -c generatedMediaPromotionScheduleState=ENABLED \
  -c mediaBlobCleanupEnabled=true \
  -c multipartCompletionReconciliationScheduleState=ENABLED
cp -R cdk.out "${evidence_directory}/split"
python3 ../../scripts/deploy/prepare-monitoring-refactor.py \
  --legacy-assembly "${evidence_directory}/legacy" \
  --split-assembly "${evidence_directory}/split" \
  --output-directory "${evidence_directory}/report"
```

After preview synthesis, `cdk.out` is a preview assembly, even if comparison fails.
Never deploy it. The private `legacy` copy remains the final deployed baseline;
ordinary release recovery starts with a fresh legacy synthesis in CI.

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
