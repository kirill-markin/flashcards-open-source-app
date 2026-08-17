import { HttpError } from "../shared/errors";

const maximumCardsQueryPageSize = 100;

export function createCardQueryError(message: string): HttpError {
  return new HttpError(400, message);
}

export function normalizeCardsQueryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumCardsQueryPageSize) {
    throw createCardQueryError(
      `limit must be an integer between 1 and ${maximumCardsQueryPageSize}`,
    );
  }

  return limit;
}
