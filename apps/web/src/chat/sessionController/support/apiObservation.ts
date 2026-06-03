import { ApiContractError, ApiError } from "../../../api";

export type ChatApiObservationMetadata = Readonly<{
  requestId: string | null;
  statusCode: number | null;
  code: string | null;
}>;

export function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getChatApiObservationMetadata(error: Error): ChatApiObservationMetadata {
  if (error instanceof ApiError || error instanceof ApiContractError) {
    return {
      requestId: error.requestId,
      statusCode: error.statusCode,
      code: error.code,
    };
  }

  return {
    requestId: null,
    statusCode: null,
    code: null,
  };
}
