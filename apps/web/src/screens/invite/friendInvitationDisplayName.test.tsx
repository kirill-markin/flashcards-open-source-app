import { describe, expect, it } from "vitest";
import { validateFriendInvitationDisplayName } from "./friendInvitationDisplayName";

const messages = {
  required: "required",
  singleLine: "singleLine",
  tooLong: "tooLong",
};

describe("validateFriendInvitationDisplayName", () => {
  it("counts emoji by Unicode code point instead of UTF-16 code unit length", () => {
    expect(validateFriendInvitationDisplayName("😀".repeat(30), messages)).toBe("");
    expect(validateFriendInvitationDisplayName("😀".repeat(31), messages)).toBe("tooLong");
  });
});
