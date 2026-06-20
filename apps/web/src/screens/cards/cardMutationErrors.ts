const cardFrontTextRequiredMessage = "Card front text must not be empty";
const cardNotFoundMessagePrefix = "Card not found: ";
const workspaceUnavailableMessage = "Workspace is unavailable";

export function getExpectedCardMutationInlineErrorMessage(
  error: unknown,
  cardNotFoundMessage: string,
): string | null {
  if (error instanceof Error === false) {
    return null;
  }

  if (error.message === cardFrontTextRequiredMessage) {
    return error.message;
  }

  if (error.message === workspaceUnavailableMessage) {
    return error.message;
  }

  if (
    error.message.startsWith(cardNotFoundMessagePrefix)
    && error.message.slice(cardNotFoundMessagePrefix.length).trim() !== ""
  ) {
    return cardNotFoundMessage;
  }

  return null;
}
