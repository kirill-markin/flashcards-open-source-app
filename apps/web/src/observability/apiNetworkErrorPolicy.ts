import { ApiNetworkError } from "../api";

export function isBrowserApiNetworkError(error: Error): error is ApiNetworkError {
  return error instanceof ApiNetworkError;
}
