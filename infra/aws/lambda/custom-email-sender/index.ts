import { CommitmentPolicy, buildClient, KmsKeyringNode } from "@aws-crypto/client-node";

type TriggerSource =
  | "CustomEmailSender_Authentication"
  | "CustomEmailSender_ForgotPassword"
  | "CustomEmailSender_ResendCode"
  | "CustomEmailSender_SignUp"
  | "CustomEmailSender_UpdateUserAttribute"
  | "CustomEmailSender_VerifyUserAttribute"
  | "CustomEmailSender_AdminCreateUser"
  | "CustomEmailSender_AccountTakeOverNotification";

type CustomEmailSenderEvent = Readonly<{
  request: Readonly<{
    code?: string;
    userAttributes: Readonly<Record<string, string | undefined>>;
  }>;
  triggerSource: string;
  userName?: string;
}>;

type CustomEmailSenderEnvironment = Readonly<{
  keyArn: string;
  keyId: string;
  resendApiKey: string;
  resendFromEmail: string;
  resendFromName: string;
}>;

type ResendEmailPayload = Readonly<{
  fromEmail: string;
  fromName: string;
  html: string;
  resendApiKey: string;
  subject: string;
  toEmail: string;
}>;

type CustomEmailSenderMessage = Readonly<{
  html: string;
  requiresCode: boolean;
  subject: string;
}>;

type FetchFunction = typeof fetch;

type DecryptCodeFunction = (encryptedCode: string, keyId: string, keyArn: string) => Promise<string>;

type HandlerDependencies = Readonly<{
  decryptCode: DecryptCodeFunction;
  fetchFn: FetchFunction;
}>;

const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);

function getRequiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function getEnvironment(): CustomEmailSenderEnvironment {
  return {
    keyArn: getRequiredEnvironmentValue("KEY_ARN"),
    keyId: getRequiredEnvironmentValue("KEY_ID"),
    resendApiKey: getRequiredEnvironmentValue("RESEND_API_KEY"),
    resendFromEmail: getRequiredEnvironmentValue("RESEND_FROM_EMAIL"),
    resendFromName: getRequiredEnvironmentValue("RESEND_FROM_NAME"),
  };
}

function maskEmail(email: string): string {
  const [localPart, domainPart] = email.split("@");
  if (localPart === undefined || domainPart === undefined) {
    return "***";
  }

  if (localPart.length <= 2) {
    return `${localPart[0] ?? "*"}*@${domainPart}`;
  }

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domainPart}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildOtpHtml(headline: string, code: string): string {
  const escapedCode = escapeHtml(code);
  const escapedHeadline = escapeHtml(headline);

  return [
    "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#111827\">",
    `<p>${escapedHeadline}</p>`,
    "<p style=\"margin:24px 0;font-size:32px;font-weight:700;letter-spacing:0.18em\">",
    escapedCode,
    "</p>",
    "<p>This code expires soon. If you did not request it, you can ignore this email.</p>",
    "</div>",
  ].join("");
}

function buildPlainHtml(message: string): string {
  return [
    "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#111827\">",
    `<p>${escapeHtml(message)}</p>`,
    "</div>",
  ].join("");
}

export function buildMessage(triggerSource: string, code: string | null): CustomEmailSenderMessage {
  if (triggerSource === "CustomEmailSender_Authentication") {
    if (code === null) {
      throw new Error("Authentication email requires a decrypted code");
    }

    return {
      subject: "Your Flashcards sign-in code",
      html: buildOtpHtml("Use this sign-in code to continue in Flashcards Open Source App:", code),
      requiresCode: true,
    };
  }

  if (triggerSource === "CustomEmailSender_ForgotPassword") {
    if (code === null) {
      throw new Error("Forgot password email requires a decrypted code");
    }

    return {
      subject: "Your Flashcards password reset code",
      html: buildOtpHtml("Use this password reset code for Flashcards Open Source App:", code),
      requiresCode: true,
    };
  }

  if (
    triggerSource === "CustomEmailSender_ResendCode"
    || triggerSource === "CustomEmailSender_SignUp"
    || triggerSource === "CustomEmailSender_UpdateUserAttribute"
    || triggerSource === "CustomEmailSender_VerifyUserAttribute"
  ) {
    if (code === null) {
      throw new Error(`${triggerSource} email requires a decrypted code`);
    }

    return {
      subject: "Your Flashcards verification code",
      html: buildOtpHtml("Use this verification code for Flashcards Open Source App:", code),
      requiresCode: true,
    };
  }

  if (triggerSource === "CustomEmailSender_AdminCreateUser") {
    if (code === null) {
      throw new Error("Admin create user email requires a decrypted code");
    }

    return {
      subject: "Your Flashcards temporary password",
      html: buildPlainHtml(`Your temporary password for Flashcards Open Source App is: ${code}`),
      requiresCode: true,
    };
  }

  if (triggerSource === "CustomEmailSender_AccountTakeOverNotification") {
    return {
      subject: "Flashcards security notice",
      html: buildPlainHtml(
        "Flashcards Open Source App detected suspicious activity on your account. Review your recent sign-in attempts.",
      ),
      requiresCode: false,
    };
  }

  throw new Error(`Unsupported Cognito custom email trigger source: ${triggerSource}`);
}

export async function decryptSecretCode(
  encryptedCode: string,
  keyId: string,
  keyArn: string,
): Promise<string> {
  const keyring = new KmsKeyringNode({
    generatorKeyId: keyId,
    keyIds: [keyArn],
  });
  const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, "base64"));
  return Buffer.from(plaintext).toString("utf-8");
}

export async function sendResendEmail(
  payload: ResendEmailPayload,
  fetchFn: FetchFunction,
): Promise<void> {
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${payload.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${payload.fromName} <${payload.fromEmail}>`,
      to: [payload.toEmail],
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (response.ok) {
    const responseBody = await response.json() as Readonly<{ id?: string }>;
    console.log(JSON.stringify({
      domain: "auth",
      action: "custom_email_sender_send",
      maskedEmail: maskEmail(payload.toEmail),
      resendEmailId: responseBody.id ?? null,
      statusCode: response.status,
      subject: payload.subject,
    }));
    return;
  }

  const responseText = await response.text();
  console.error(JSON.stringify({
    domain: "auth",
    action: "custom_email_sender_send_error",
    maskedEmail: maskEmail(payload.toEmail),
    resendErrorBody: responseText,
    statusCode: response.status,
    subject: payload.subject,
  }));
  throw new Error(`Resend email send failed with status ${response.status}: ${responseText}`);
}

export async function handleCustomEmailSenderEvent(
  event: CustomEmailSenderEvent,
  environment: CustomEmailSenderEnvironment,
  dependencies: HandlerDependencies,
): Promise<CustomEmailSenderEvent> {
  const email = event.request.userAttributes.email;
  if (email === undefined || email.trim() === "") {
    throw new Error("Custom email sender event is missing request.userAttributes.email");
  }

  const message = buildMessage(event.triggerSource, event.request.code === undefined ? null : "");
  const decryptedCode = message.requiresCode
    ? await dependencies.decryptCode(
      event.request.code ?? "",
      environment.keyId,
      environment.keyArn,
    )
    : null;
  const resolvedMessage = buildMessage(event.triggerSource, decryptedCode);

  await sendResendEmail({
    fromEmail: environment.resendFromEmail,
    fromName: environment.resendFromName,
    html: resolvedMessage.html,
    resendApiKey: environment.resendApiKey,
    subject: resolvedMessage.subject,
    toEmail: email,
  }, dependencies.fetchFn);

  return event;
}

export async function handler(event: CustomEmailSenderEvent): Promise<CustomEmailSenderEvent> {
  return handleCustomEmailSenderEvent(event, getEnvironment(), {
    decryptCode: decryptSecretCode,
    fetchFn: fetch,
  });
}
