#!/usr/bin/env bash
# Decide which AWS/Web Release components deploy. Each component diffs its own
# recorded production SHA against the target commit, so every merge since that
# component's last successful release lands in one diff. Anything this script
# cannot establish deploys the component: detection never skips a deploy.
#
# Writes deploy flags to $GITHUB_OUTPUT and the per-component decision to
# $GITHUB_STEP_SUMMARY.

set -euo pipefail

EVENT_NAME=""
TARGET_SHA=""
PLATFORM_DEPLOYED_SHA=""
WEB_DEPLOYED_SHA=""
ADMIN_DEPLOYED_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --event-name) EVENT_NAME="$2"; shift 2 ;;
    --target-sha) TARGET_SHA="$2"; shift 2 ;;
    --platform-deployed-sha) PLATFORM_DEPLOYED_SHA="$2"; shift 2 ;;
    --web-deployed-sha) WEB_DEPLOYED_SHA="$2"; shift 2 ;;
    --admin-deployed-sha) ADMIN_DEPLOYED_SHA="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must name the step output file}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must name the step summary file}"

if [[ -z "${EVENT_NAME}" || -z "${TARGET_SHA}" || -z "${PLATFORM_DEPLOYED_SHA}" || -z "${WEB_DEPLOYED_SHA}" || -z "${ADMIN_DEPLOYED_SHA}" ]]; then
  echo "ERROR: --event-name, --target-sha and all three --*-deployed-sha values are required (a SHA, missing, or unreadable)." >&2
  exit 1
fi

if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  echo "ERROR: target commit '${TARGET_SHA}' is not in the local history; check out with fetch-depth: 0." >&2
  exit 1
fi

# Prints the components a changed path deploys. The cases mirror the
# workflow's on.push.paths: a path outside that list is not a release input,
# and a trigger path added there needs a case here.
components_for_path() {
  local path="$1"

  case "${path}" in
    # The release pipeline itself.
    .github/workflows/aws-web-release.yml|scripts/deploy/select-release-components.sh)
      echo "platform web admin" ;;
    # CDK owns the web and admin buckets and distributions (infra/aws/lib/web.ts,
    # infra/aws/lib/admin.ts); a replaced bucket comes up empty until the assets
    # are published again in the same run.
    infra/*)
      echo "platform web admin" ;;
    # The web client compiles this backend module into its bundle.
    apps/backend/src/scheduling/*)
      echo "platform web" ;;
    apps/backend/*|apps/auth/*|db/*)
      echo "platform" ;;
    apps/web/*|scripts/deploy/deploy-web.sh)
      echo "web" ;;
    apps/admin/*|scripts/deploy/deploy-admin.sh)
      echo "admin" ;;
    scripts/geolite/*|scripts/deploy/migrate-aws.sh|scripts/generate/write-ci-cdk-context.py)
      echo "platform" ;;
    scripts/generate/generate-catalog-dump.sh|scripts/generate/generate-global-metrics-snapshot.sh)
      echo "platform" ;;
    scripts/checks/check-agent-api-smoke.sh|scripts/checks/check-api-health.sh|scripts/checks/check-demo-cognito-users.sh)
      echo "platform" ;;
    scripts/checks/check-mcp-smoke.sh|scripts/checks/check-multipart-completion-reconciliation-schedule.sh|scripts/checks/check-public-endpoints.sh)
      echo "platform" ;;
    *)
      echo "" ;;
  esac
}

# Prints "<deploy>\t<reason>" for one component, then one path per line that
# made it deploy.
select_component() {
  local component="$1"
  local deployed_sha="$2"

  if [[ "${EVENT_NAME}" == "workflow_dispatch" ]]; then
    printf 'true\tfull deploy: workflow_dispatch\n'
    return
  fi

  if [[ "${deployed_sha}" == "missing" ]]; then
    printf 'true\tfull deploy: no deployed SHA recorded in SSM\n'
    return
  fi

  if [[ ! "${deployed_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'true\tfull deploy: deployed SHA could not be read from SSM\n'
    return
  fi

  local ancestor_status=0
  git merge-base --is-ancestor "${deployed_sha}" "${TARGET_SHA}" 2>/dev/null || ancestor_status=$?
  if [[ "${ancestor_status}" -eq 1 ]]; then
    printf 'true\tfull deploy: deployed SHA is not an ancestor of the target (rewritten history)\n'
    return
  fi
  if [[ "${ancestor_status}" -ne 0 ]]; then
    printf 'true\tfull deploy: deployed SHA is not in the repository history\n'
    return
  fi

  # --no-renames lists both sides of a move, so a file leaving a component
  # still deploys that component.
  local changed_paths
  if ! changed_paths="$(git diff --no-renames --name-only "${deployed_sha}" "${TARGET_SHA}")"; then
    printf 'true\tfull deploy: git diff against the deployed SHA failed\n'
    return
  fi

  local matched_paths=""
  local matched_count=0
  local path
  while IFS= read -r path; do
    if [[ -z "${path}" ]]; then
      continue
    fi
    if [[ " $(components_for_path "${path}") " == *" ${component} "* ]]; then
      matched_paths="${matched_paths}${path}"$'\n'
      matched_count=$((matched_count + 1))
    fi
  done <<< "${changed_paths}"

  if [[ "${matched_count}" -eq 0 ]]; then
    printf 'false\tno %s paths changed since the deployed SHA\n' "${component}"
    return
  fi

  printf 'true\t%s paths changed since the deployed SHA: %s\n' "${component}" "${matched_count}"
  printf '%s' "${matched_paths}"
}

# Prints "true" when the platform must run the pre-deploy checks of one area.
# A full deploy, or a change to the pipeline itself, runs all of them.
platform_area_changed() {
  local platform_selection="$1"
  local area_pattern="$2"

  local reason
  reason="$(printf '%s\n' "${platform_selection}" | sed -n '1p' | cut -f2)"
  local paths
  paths="$(printf '%s\n' "${platform_selection}" | sed '1d')"

  if [[ "${reason}" == "full deploy:"* ]] \
    || printf '%s\n' "${paths}" | grep -Eq "^(${area_pattern}|\.github/workflows/aws-web-release\.yml$|scripts/deploy/select-release-components\.sh$)"; then
    echo "true"
  else
    echo "false"
  fi
}

platform_selection="$(select_component platform "${PLATFORM_DEPLOYED_SHA}")"
web_selection="$(select_component web "${WEB_DEPLOYED_SHA}")"
admin_selection="$(select_component admin "${ADMIN_DEPLOYED_SHA}")"

deploy_flag() {
  printf '%s\n' "$1" | sed -n '1p' | cut -f1
}

deploy_platform="$(deploy_flag "${platform_selection}")"
deploy_web="$(deploy_flag "${web_selection}")"
deploy_admin="$(deploy_flag "${admin_selection}")"

deploy_any="false"
if [[ "${deploy_platform}" == "true" || "${deploy_web}" == "true" || "${deploy_admin}" == "true" ]]; then
  deploy_any="true"
fi

auth_changed="false"
backend_changed="false"
infra_changed="false"
if [[ "${deploy_platform}" == "true" ]]; then
  auth_changed="$(platform_area_changed "${platform_selection}" 'apps/auth/')"
  backend_changed="$(platform_area_changed "${platform_selection}" 'apps/backend/')"
  infra_changed="$(platform_area_changed "${platform_selection}" 'infra/')"
fi

{
  echo "deploy_platform=${deploy_platform}"
  echo "deploy_web=${deploy_web}"
  echo "deploy_admin=${deploy_admin}"
  echo "deploy_any=${deploy_any}"
  echo "auth_changed=${auth_changed}"
  echo "backend_changed=${backend_changed}"
  echo "infra_changed=${infra_changed}"
} >> "${GITHUB_OUTPUT}"

summarize_component() {
  local component="$1"
  local deployed_sha="$2"
  local selection="$3"

  local deploy
  deploy="$(deploy_flag "${selection}")"
  local reason
  reason="$(printf '%s\n' "${selection}" | sed -n '1p' | cut -f2)"

  local deploy_label="no"
  if [[ "${deploy}" == "true" ]]; then
    deploy_label="yes"
  fi

  echo "| ${component} | \`${deployed_sha}\` | ${deploy_label} | ${reason} |"
}

summarize_paths() {
  local component="$1"
  local selection="$2"

  local paths
  paths="$(printf '%s\n' "${selection}" | sed '1d')"
  if [[ -z "${paths}" ]]; then
    return
  fi

  echo ""
  echo "<details><summary>${component}: changed paths</summary>"
  echo ""
  printf '%s\n' "${paths}" | sed 's/^/- `/; s/$/`/'
  echo ""
  echo "</details>"
}

{
  echo "## Release components"
  echo ""
  echo "Target SHA: \`${TARGET_SHA}\`"
  echo ""
  echo "| Component | Deployed SHA | Deploys | Reason |"
  echo "| --- | --- | --- | --- |"
  summarize_component platform "${PLATFORM_DEPLOYED_SHA}" "${platform_selection}"
  summarize_component web "${WEB_DEPLOYED_SHA}" "${web_selection}"
  summarize_component admin "${ADMIN_DEPLOYED_SHA}" "${admin_selection}"
  summarize_paths platform "${platform_selection}"
  summarize_paths web "${web_selection}"
  summarize_paths admin "${admin_selection}"
} >> "${GITHUB_STEP_SUMMARY}"
