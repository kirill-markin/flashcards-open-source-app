const authBaseUrl = process.env.FLASHCARDS_LIVE_E2E_AUTH_BASE_URL ?? "https://auth.flashcards-open-source-app.com";
const apiBaseUrl = process.env.FLASHCARDS_LIVE_E2E_API_BASE_URL ?? "https://api.flashcards-open-source-app.com/v1";
const workspacePrefix = process.env.FLASHCARDS_LIVE_E2E_WORKSPACE_PREFIX ?? "E2E ";
const ttlHours = parsePositiveInteger(
  process.env.FLASHCARDS_LIVE_E2E_WORKSPACE_TTL_HOURS ?? "48",
  "FLASHCARDS_LIVE_E2E_WORKSPACE_TTL_HOURS",
);
const reviewEmails = parseReviewEmails(process.env.FLASHCARDS_LIVE_E2E_REVIEW_EMAILS ?? "apple-review@example.com,google-review@example.com");

/**
 * This cleanup job uses the same auth demo bypass as the live smoke tests:
 * review emails return an ID token directly from send-code, so the script can
 * clean stale E2E workspaces without OTP, browser cookies, or UI automation.
 */
async function main() {
  const failures = [];

  for (const email of reviewEmails) {
    try {
      const idToken = await signInWithReviewEmail(email);
      const workspaces = await listAllWorkspaces(idToken);
      const staleWorkspaces = workspaces.filter((workspace) => shouldDeleteWorkspace(workspace));

      console.log(`[cleanup] email=${email} workspaces=${workspaces.length} stale=${staleWorkspaces.length}`);

      for (const workspace of staleWorkspaces) {
        await deleteWorkspace(idToken, workspace);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`email=${email}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Live E2E cleanup failed:\n${failures.join("\n")}`);
  }
}

function parsePositiveInteger(rawValue, envName) {
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isInteger(parsedValue) === false || parsedValue <= 0) {
    throw new Error(`${envName} must be a positive integer, received "${rawValue}"`);
  }

  return parsedValue;
}

function parseReviewEmails(rawValue) {
  const emails = rawValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");

  if (emails.length === 0) {
    throw new Error("FLASHCARDS_LIVE_E2E_REVIEW_EMAILS must contain at least one email");
  }

  return emails;
}

async function signInWithReviewEmail(email) {
  const response = await fetch(`${authBaseUrl}/api/send-code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`Demo sign-in failed for ${email}: status=${response.status} body=${JSON.stringify(payload)}`);
  }

  if (typeof payload.idToken !== "string" || payload.idToken === "") {
    throw new Error(`Demo sign-in did not return idToken for ${email}: body=${JSON.stringify(payload)}`);
  }

  return payload.idToken;
}

async function listAllWorkspaces(idToken) {
  const workspaces = [];
  let nextCursor = null;

  do {
    const url = new URL(`${apiBaseUrl}/workspaces`);
    url.searchParams.set("limit", "100");
    if (nextCursor !== null) {
      url.searchParams.set("cursor", nextCursor);
    }

    const payload = await authenticatedJsonRequest(idToken, url.toString(), {
      method: "GET",
    });

    if (Array.isArray(payload.workspaces) === false) {
      throw new Error(`Workspace list payload is invalid: ${JSON.stringify(payload)}`);
    }

    workspaces.push(...payload.workspaces);
    nextCursor = typeof payload.nextCursor === "string" && payload.nextCursor !== "" ? payload.nextCursor : null;
  } while (nextCursor !== null);

  return workspaces;
}

function shouldDeleteWorkspace(workspace) {
  if (typeof workspace.name !== "string" || workspace.name.startsWith(workspacePrefix) === false) {
    return false;
  }

  if (typeof workspace.createdAt !== "string" || workspace.createdAt === "") {
    throw new Error(`Workspace ${JSON.stringify(workspace)} is missing createdAt`);
  }

  const createdAtMillis = Date.parse(workspace.createdAt);
  if (Number.isNaN(createdAtMillis)) {
    throw new Error(`Workspace ${workspace.name} has invalid createdAt=${workspace.createdAt}`);
  }

  const ageHours = (Date.now() - createdAtMillis) / (60 * 60 * 1000);
  return ageHours >= ttlHours;
}

async function deleteWorkspace(idToken, workspace) {
  if (typeof workspace.workspaceId !== "string" || workspace.workspaceId === "") {
    throw new Error(`Workspace ${JSON.stringify(workspace)} is missing workspaceId`);
  }

  const preview = await authenticatedJsonRequest(
    idToken,
    `${apiBaseUrl}/workspaces/${workspace.workspaceId}/delete-preview`,
    { method: "GET" },
  );

  if (typeof preview.confirmationText !== "string" || preview.confirmationText === "") {
    throw new Error(`Delete preview is missing confirmationText for workspace ${workspace.workspaceId}`);
  }

  await authenticatedJsonRequest(
    idToken,
    `${apiBaseUrl}/workspaces/${workspace.workspaceId}/delete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmationText: preview.confirmationText,
      }),
    },
  );

  console.log(`[cleanup] deleted workspace name=${workspace.name} id=${workspace.workspaceId}`);
}

async function authenticatedJsonRequest(idToken, url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${idToken}`,
    },
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`Request failed: url=${url} status=${response.status} body=${JSON.stringify(payload)}`);
  }

  return payload;
}

async function readJson(response) {
  const responseText = await response.text();
  if (responseText === "") {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Response is not valid JSON: status=${response.status} body=${responseText}`);
  }
}

await main();
