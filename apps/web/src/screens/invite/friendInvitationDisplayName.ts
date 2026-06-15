export const friendInvitationDisplayNameMaxLength = 30;

const displayNameControlCharacterPattern = /[\u0000-\u001F\u007F]/u;

export type FriendInvitationDisplayNameValidationMessages = Readonly<{
  required: string;
  singleLine: string;
  tooLong: string;
}>;

export function validateFriendInvitationDisplayName(
  value: string,
  messages: FriendInvitationDisplayNameValidationMessages,
): string {
  if (displayNameControlCharacterPattern.test(value)) {
    return messages.singleLine;
  }

  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    return messages.required;
  }

  if (Array.from(normalizedValue).length > friendInvitationDisplayNameMaxLength) {
    return messages.tooLong;
  }

  return "";
}
