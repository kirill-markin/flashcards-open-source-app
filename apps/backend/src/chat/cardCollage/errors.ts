import { HttpError } from "../../shared/errors";

export type CardCollageErrorCode =
  | "card_not_found"
  | "image_not_on_card_side"
  | "image_not_ready"
  | "image_unavailable"
  | "image_too_large"
  | "image_not_supported";

const statusCodeByCardCollageErrorCode: Readonly<Record<CardCollageErrorCode, number>> = {
  card_not_found: 404,
  image_not_on_card_side: 400,
  image_not_ready: 409,
  image_unavailable: 404,
  image_too_large: 413,
  image_not_supported: 415,
};

/** An expected refusal whose message alone tells the model what to do next. */
export class CardCollageError extends HttpError {
  readonly collageCode: CardCollageErrorCode;

  constructor(code: CardCollageErrorCode, message: string) {
    super(statusCodeByCardCollageErrorCode[code], message, code);
    this.name = "CardCollageError";
    this.collageCode = code;
  }
}
