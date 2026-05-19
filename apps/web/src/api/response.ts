import {
  ApiContractError,
  enrichApiContractError,
} from "../apiContracts/core";
import { ApiError, type ApiResponseBodyKind } from "./errors";

type JsonObject = Readonly<{
  readonly [key: string]: unknown;
}>;

const staleSessionCsrfTokenErrorCode = "SESSION_CSRF_TOKEN_INVALID";
const staleSessionCsrfTokenErrorMessage = "Invalid X-CSRF-Token header";

export type ParsedResponsePayload = Readonly<{
  value: unknown;
  bodyKind: ApiResponseBodyKind;
  requestId: string | null;
  statusCode: number;
  code: string | null;
}>;

export type ContractResponseParser<ParsedValue> = (value: unknown, endpoint: string) => ParsedValue;

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return true;
}

export function getJsonErrorMessage(value: unknown, fallbackMessage: string): string {
  if (isJsonObject(value) === false) {
    return fallbackMessage;
  }

  const errorValue = value.error;
  return typeof errorValue === "string" && errorValue !== "" ? errorValue : fallbackMessage;
}

function getJsonErrorCode(value: unknown): string | null {
  if (isJsonObject(value) === false) {
    return null;
  }

  return typeof value.code === "string" && value.code !== "" ? value.code : null;
}

export function isRecoverableSessionCsrfPayload(value: unknown): boolean {
  if (isJsonObject(value) === false) {
    return value === staleSessionCsrfTokenErrorMessage;
  }

  return value.code === staleSessionCsrfTokenErrorCode
    || value.error === staleSessionCsrfTokenErrorMessage;
}

function getJsonRequestId(value: unknown): string | null {
  if (isJsonObject(value) === false) {
    return null;
  }

  const requestId = value.requestId;
  return typeof requestId === "string" && requestId.trim() !== "" ? requestId : null;
}

function getHeaderRequestId(response: Response): string | null {
  const requestId = response.headers.get("X-Request-Id")
    ?? response.headers.get("X-Amzn-RequestId")
    ?? response.headers.get("X-Amz-Apigw-Id");
  return requestId === null || requestId.trim() === "" ? null : requestId;
}

function resolveResponseBodyKind(response: Response): ApiResponseBodyKind {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.toLowerCase().includes("json") ? "invalid_json" : "text";
}

export async function readJsonResponse(response: Response): Promise<ParsedResponsePayload> {
  const text = await response.text();
  const headerRequestId = getHeaderRequestId(response);
  if (text === "") {
    return {
      value: null,
      bodyKind: "empty",
      requestId: headerRequestId,
      statusCode: response.status,
      code: null,
    };
  }

  try {
    const value = JSON.parse(text) as unknown;
    return {
      value,
      bodyKind: "json",
      requestId: headerRequestId ?? getJsonRequestId(value),
      statusCode: response.status,
      code: getJsonErrorCode(value),
    };
  } catch {
    return {
      value: text,
      bodyKind: resolveResponseBodyKind(response),
      requestId: headerRequestId,
      statusCode: response.status,
      code: null,
    };
  }
}

export async function parseJsonPayload(response: Response, endpoint: string): Promise<ParsedResponsePayload> {
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const fallbackMessage = typeof payload.value === "string" ? payload.value : `Request failed with status ${response.status}`;
    throw new ApiError({
      statusCode: response.status,
      message: getJsonErrorMessage(payload.value, fallbackMessage),
      code: payload.code,
      requestId: payload.requestId,
      endpoint,
      responseBodyKind: payload.bodyKind,
    });
  }

  return payload;
}

export async function isRecoverableSessionCsrfResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  return isRecoverableSessionCsrfPayload((await readJsonResponse(response.clone())).value);
}

export function parseContractResponse<ParsedValue>(
  payload: ParsedResponsePayload,
  endpoint: string,
  parsePayload: ContractResponseParser<ParsedValue>,
): ParsedValue {
  try {
    return parsePayload(payload.value, endpoint);
  } catch (error) {
    if (error instanceof ApiContractError) {
      throw enrichApiContractError(error, {
        requestId: payload.requestId,
        statusCode: payload.statusCode,
        code: payload.code,
        responseBodyKind: payload.bodyKind,
      });
    }

    throw error;
  }
}
