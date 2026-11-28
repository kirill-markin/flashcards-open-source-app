import { readFileSync } from "node:fs";

/**
 * `NIBOMO_DEPLOYMENT=standalone` switches this auth service into the single-server self-host mode. The
 * same contract lives in apps/backend/src/deployment/standalone.ts; the apps share no package.
 */
const standaloneDeploymentValue = "standalone";

/** Each of these proves an AWS runtime or AWS configuration, which standalone must never run beside. */
const awsOnlyVariableNames: ReadonlyArray<string> = [
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "OIDC_SIGNING_KEY_ARN",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
];

/** Secret files this app reads; outside standalone a set one would be ignored, so it is refused. */
const standaloneSecretFileVariableNames: ReadonlyArray<string> = [
  "OIDC_SIGNING_KEY_FILE",
];

const minimumSecretFileBytes = 32;

let resolvedStandaloneDeployment: boolean | undefined;
const resolvedSecretFiles = new Map<string, string>();

function findAwsOnlyVariableName(): string | undefined {
  return Object.keys(process.env).find((name) => (
    name.endsWith("_SECRET_ARN") || awsOnlyVariableNames.includes(name)
  ));
}

function evaluateStandaloneDeployment(): boolean {
  const value = process.env.NIBOMO_DEPLOYMENT;
  if (value === undefined) {
    const strayFileVariableName = standaloneSecretFileVariableNames.find((name) => process.env[name] !== undefined);
    if (strayFileVariableName !== undefined) {
      throw new Error(`${strayFileVariableName} is read only when NIBOMO_DEPLOYMENT=standalone; unset it or set the switch.`);
    }
    return false;
  }

  if (value !== standaloneDeploymentValue) {
    throw new Error(`NIBOMO_DEPLOYMENT must be unset or exactly "${standaloneDeploymentValue}", got "${value}".`);
  }

  const awsOnlyVariableName = findAwsOnlyVariableName();
  if (awsOnlyVariableName !== undefined) {
    throw new Error(`NIBOMO_DEPLOYMENT=standalone refuses to run with ${awsOnlyVariableName} set; unset it.`);
  }
  return true;
}

export function isStandaloneDeployment(): boolean {
  if (resolvedStandaloneDeployment === undefined) {
    resolvedStandaloneDeployment = evaluateStandaloneDeployment();
  }
  return resolvedStandaloneDeployment;
}

/**
 * The standalone secret at the path named by `variableName`, read once per process. One trailing
 * newline is dropped so `echo`/`openssl rand` output works; anything else is the secret as written.
 */
export function readStandaloneSecretFile(variableName: string): string {
  const cached = resolvedSecretFiles.get(variableName);
  if (cached !== undefined) {
    return cached;
  }

  const path = process.env[variableName];
  if (path === undefined || path.trim() === "") {
    throw new Error(`${variableName} is required when NIBOMO_DEPLOYMENT=standalone and must name a secret file.`);
  }

  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${variableName} names ${path}, which could not be read: ${reason}`);
  }

  const secret = contents.replace(/\r?\n$/, "");
  if (Buffer.byteLength(secret, "utf8") < minimumSecretFileBytes) {
    throw new Error(`${variableName} names ${path}, which must hold at least ${minimumSecretFileBytes} bytes after one trailing newline.`);
  }

  resolvedSecretFiles.set(variableName, secret);
  return secret;
}
