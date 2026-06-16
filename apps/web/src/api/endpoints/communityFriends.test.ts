// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { createJsonResponse } from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import { acceptFriendInvitation, createFriendInvitation, previewFriendInvitation } from "./communityFriends";
import { loadProgressLeaderboard } from "./progress";

describe("community friend API endpoints", () => {
  it("decodes friend invitation create, preview, and accept responses", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
        expiresAt: "2026-04-22T10:00:00.000Z",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        status: "active",
        expiresAt: "2026-04-22T10:00:00.000Z",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        status: "already_friends",
        existingFriendDisplayName: "Alex",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createFriendInvitation({
      inviteeDisplayName: "Priya",
    })).resolves.toEqual({
      inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    await expect(previewFriendInvitation("raw-token")).resolves.toEqual({
      status: "active",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    await expect(acceptFriendInvitation("raw-token", {
      inviterDisplayName: "Alex",
    })).resolves.toEqual({
      status: "already_friends",
      existingFriendDisplayName: "Alex",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/v1/me/community/friend-invitations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ inviteeDisplayName: "Priya" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/v1/community/friend-invitations/raw-token",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8080/v1/me/community/friend-invitations/raw-token/accept",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ inviterDisplayName: "Alex" }),
      }),
    );
  });

  it("decodes optional friend display names on leaderboard rows", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        status: "ready",
        metric: {
          metricVersion: "qualified_reviews_v1",
          title: "Qualified reviews",
          description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
        },
        defaultWindowKey: "last_24_hours",
        windows: [{
          windowKey: "last_24_hours",
          snapshotId: "0cc86d10-18cb-4d64-a2f2-a5fd960b45b2",
          snapshotGeneratedAt: "2026-04-21T10:00:05.000Z",
          asOfServerHour: "2026-04-21T10:00:00.000Z",
          nextRefreshAfter: "2026-04-21T11:00:00.000Z",
          participantCount: 2,
          viewer: {
            publicProfileId: "viewer-profile",
            displayName: "You",
            rank: 2,
            qualifiedReviewCount: 7,
          },
          rows: [
            {
              kind: "top",
              publicProfileId: "friend-profile",
              anonymousDisplayName: "Silver Bright Harbor",
              friendDisplayName: "Mina",
              qualifiedReviewCount: 8,
              rank: 1,
            },
            {
              kind: "viewer",
              publicProfileId: "viewer-profile",
              anonymousDisplayName: "Quiet Maple Grove",
              qualifiedReviewCount: 7,
              rank: 2,
            },
          ],
          rankingRows: [
            {
              kind: "participant",
              publicProfileId: "friend-profile",
              anonymousDisplayName: "Silver Bright Harbor",
              friendDisplayName: "Mina",
              qualifiedReviewCount: 8,
              rank: 1,
            },
            {
              kind: "viewer",
              publicProfileId: "viewer-profile",
              anonymousDisplayName: "Quiet Maple Grove",
              qualifiedReviewCount: 7,
              rank: 2,
            },
          ],
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const leaderboard = await loadProgressLeaderboard();

    expect(leaderboard.windows[0]?.rows[0]?.friendDisplayName).toBe("Mina");
    expect(leaderboard.windows[0]?.rows[1]?.friendDisplayName).toBeUndefined();
    expect(leaderboard.windows[0]?.rankingRows[0]?.friendDisplayName).toBe("Mina");
    expect(leaderboard.windows[0]?.rankingRows[1]?.friendDisplayName).toBeUndefined();
  });
});
