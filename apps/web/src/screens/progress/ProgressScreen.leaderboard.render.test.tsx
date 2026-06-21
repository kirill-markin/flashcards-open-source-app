// @vitest-environment jsdom
import type { ProgressLeaderboard, ProgressLeaderboardProfile, ProgressLeaderboardProfileReady } from "../../types";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  addFriendDisplayNameToRankingRows,
  addFriendDisplayNamesToRankingRows,
  createAppData,
  createLeaderboard,
  createLeaderboardRankingRows,
  createLeaderboardSourceState,
  createLeaderboardSourceStateFromLeaderboard,
  createLeaderboardWithViewerRanks,
  createLeaderboardWithWindowRankingRows,
  createLocalOnlyStreakLeaderboardSourceState,
  createProgressScreenRenderTestContext,
  createStreakLeaderboardSourceState,
  linkedCloudSettings,
  mockProgressSourceStateWithLeaderboards,
  mockProgressSourceStateWithLeaderboard,
  useAppDataMock,
} from "./ProgressScreenTestSupport";

const apiMocks = vi.hoisted(() => ({
  loadProgressLeaderboardProfileMock: vi.fn<(publicProfileId: string) => Promise<ProgressLeaderboardProfile>>(),
}));

vi.mock("../../api", async () => {
  const actualApi = await vi.importActual<typeof import("../../api")>("../../api");

  return {
    ...actualApi,
    loadProgressLeaderboardProfile: apiMocks.loadProgressLeaderboardProfileMock,
  };
});

function createProfileActivityDays(): ProgressLeaderboardProfileReady["reviewActivity"]["days"] {
  return Array.from({ length: 30 }, (_value, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    reviewCount: index % 5,
  }));
}

function createLeaderboardReadyProfile(
  publicProfileId: string,
  anonymousDisplayName: string,
  friendDisplayName: string | null,
): ProgressLeaderboardProfileReady {
  const profile: ProgressLeaderboardProfileReady = {
    status: "ready",
    publicProfileId,
    anonymousDisplayName,
    isFriend: friendDisplayName !== null,
    metrics: {
      currentStreakDays: 6,
      bestRatingPlacement: {
        windowKey: "last_24_hours",
        rank: 2,
      },
    },
    reviewActivity: {
      dateBasis: "profile_local_day_with_utc_fallback",
      days: createProfileActivityDays(),
    },
    stats: {
      joinedAt: "2026-04-01T08:00:00.000Z",
      totalCards: 42,
    },
    generatedAt: "2026-06-10T12:00:05.000Z",
  };

  return friendDisplayName === null ? profile : {
    ...profile,
    friendDisplayName,
  };
}

function createDeferredProfile(): Readonly<{
  promise: Promise<ProgressLeaderboardProfile>;
  resolve: (profile: ProgressLeaderboardProfile) => void;
}> {
  let resolvePromise: ((profile: ProgressLeaderboardProfile) => void) | null = null;
  const promise = new Promise<ProgressLeaderboardProfile>((resolve) => {
    resolvePromise = resolve;
  });

  if (resolvePromise === null) {
    throw new Error("Deferred leaderboard profile promise was not initialized");
  }

  return {
    promise,
    resolve: resolvePromise,
  };
}

function createLeaderboardWithSnapshotGeneratedAt(snapshotGeneratedAt: string): ProgressLeaderboard {
  const leaderboard = createLeaderboard("ready");

  return {
    ...leaderboard,
    windows: leaderboard.windows.map((window) => ({
      ...window,
      snapshotGeneratedAt,
    })),
  };
}

describe("ProgressScreen leaderboard", () => {
  const progressScreen = createProgressScreenRenderTestContext();

  it("renders the leaderboard guest placeholder with a sign-in link for unlinked accounts", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const guestPlaceholder = container.querySelector("[data-testid='progress-leaderboard-guest']");
    if (!(guestPlaceholder instanceof HTMLElement)) {
      throw new Error("Leaderboard guest placeholder was not found");
    }

    expect(guestPlaceholder.textContent).toContain("Sign in to see how your review ratings rank alongside other learners.");
    const signInLink = guestPlaceholder.querySelector("a");
    if (!(signInLink instanceof HTMLAnchorElement)) {
      throw new Error("Leaderboard guest sign-in link was not found");
    }
    expect(signInLink.textContent).toBe("Sign in");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).toBeNull();
  });

  it("renders the invite sign-in prompt for unlinked accounts", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const inviteOpenButton = container.querySelector("[data-testid='progress-leaderboard-invite-open']");
    if (!(inviteOpenButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite button was not found");
    }

    await act(async () => {
      inviteOpenButton.click();
    });

    const signInPrompt = document.body.querySelector("[data-testid='progress-leaderboard-invite-sign-in']");
    if (!(signInPrompt instanceof HTMLElement)) {
      throw new Error("Leaderboard invite sign-in prompt was not found");
    }

    expect(signInPrompt.querySelector("a")).not.toBeNull();
  });

  it("requires a friend name before creating a leaderboard invite", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const inviteOpenButton = container.querySelector("[data-testid='progress-leaderboard-invite-open']");
    if (!(inviteOpenButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite button was not found");
    }

    await act(async () => {
      inviteOpenButton.click();
    });

    const createButton = document.body.querySelector("[data-testid='progress-leaderboard-invite-create']");
    if (!(createButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite create button was not found");
    }

    await act(async () => {
      createButton.click();
    });

    expect(document.body.querySelector("[data-testid='progress-leaderboard-invite-name-error']")?.textContent).not.toBe("");
  });

  it("renders the leaderboard participation-disabled placeholder with a settings link", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("participation_disabled", null));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const participationPlaceholder = container.querySelector("[data-testid='progress-leaderboard-participation-disabled']");
    if (!(participationPlaceholder instanceof HTMLElement)) {
      throw new Error("Leaderboard participation-disabled placeholder was not found");
    }

    expect(participationPlaceholder.textContent).toContain("Rankings are hidden while leaderboard participation is off.");
    const settingsLink = participationPlaceholder.querySelector("a");
    if (!(settingsLink instanceof HTMLAnchorElement)) {
      throw new Error("Leaderboard participation settings link was not found");
    }
    expect(settingsLink.getAttribute("href")).toBe("/settings/leaderboard-participation");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).toBeNull();
  });

  it("renders the ready leaderboard compact rows in server order with the top three before the gap", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const leaderboardCard = container.querySelector("[data-testid='progress-leaderboard-card']");
    if (!(leaderboardCard instanceof HTMLElement)) {
      throw new Error("Leaderboard card was not found");
    }
    expect(leaderboardCard.textContent).toContain("Rating leaderboard");

    const headerActions = leaderboardCard.querySelector(".progress-leaderboard-head-actions");
    if (!(headerActions instanceof HTMLElement)) {
      throw new Error("Leaderboard header actions were not found");
    }
    expect(headerActions.querySelector("[data-testid='progress-leaderboard-invite-open']")).toBeNull();

    const inviteOpenButton = leaderboardCard.querySelector("[data-testid='progress-leaderboard-invite-open']");
    if (!(inviteOpenButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite button was not found");
    }
    expect(inviteOpenButton.textContent).toBe("Invite friend");
    expect(inviteOpenButton.className).toContain("primary-btn");

    const periodSelector = leaderboardCard.querySelector(".progress-leaderboard-periods");
    if (!(periodSelector instanceof HTMLElement)) {
      throw new Error("Leaderboard period selector was not found");
    }
    expect(inviteOpenButton.compareDocumentPosition(periodSelector) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const rows = [...container.querySelectorAll(".progress-leaderboard-row")];
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
      "top",
      "top",
      "top",
      "gap",
      "neighbor",
      "viewer",
      "neighbor",
      "gap",
      "neighbor",
    ]);

    const rowTexts = rows.map((row) => row.textContent);
    expect(rowTexts[0]).toContain("Silver Bright Harbor");
    expect(rowTexts[0]).toContain("#1");
    expect(rowTexts[1]).toContain("Amber Calm Meadow");
    expect(rowTexts[2]).toContain("Coral Keen Valley");
    expect(rowTexts[4]).toContain("Jade Swift River");
    expect(rowTexts[5]).toContain("You");
    expect(rowTexts[5]).toContain("#42");
    expect(rowTexts[6]).toContain("Bold Cedar Crest");
    expect(rowTexts[8]).toContain("Blue Final Harbor");
    expect(rowTexts[8]).toContain("#128");
    expect(rowTexts[8]).toContain("0");

    const topGapRow = rows[3];
    const bottomGapRow = rows[7];
    if (topGapRow === undefined || bottomGapRow === undefined) {
      throw new Error("Leaderboard gap rows were not found");
    }
    expect(topGapRow.querySelector("button")).toBeNull();
    expect(topGapRow.querySelector("a")).toBeNull();
    expect(bottomGapRow.querySelector("button")).toBeNull();
    expect(bottomGapRow.querySelector("a")).toBeNull();
  });

  it("opens and caches a rating leaderboard profile from a participant row", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));
    const deferredProfile = createDeferredProfile();
    apiMocks.loadProgressLeaderboardProfileMock.mockReturnValueOnce(deferredProfile.promise);

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();
    const openButton = container.querySelector("[data-testid='progress-leaderboard-row-top-button']");
    if (!(openButton instanceof HTMLButtonElement)) {
      throw new Error("Rating leaderboard profile button was not found");
    }

    await act(async () => {
      openButton.click();
    });

    const loadingDialog = document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']");
    if (!(loadingDialog instanceof HTMLElement)) {
      throw new Error("Leaderboard profile dialog was not opened");
    }
    expect(loadingDialog.textContent).toContain("Silver Bright Harbor");
    expect(loadingDialog.querySelector("[data-testid='progress-leaderboard-profile-loading']")).not.toBeNull();
    expect(apiMocks.loadProgressLeaderboardProfileMock).toHaveBeenCalledWith("profile-1");

    await act(async () => {
      deferredProfile.resolve(createLeaderboardReadyProfile("profile-1", "Silver Bright Harbor", "Mina"));
      await deferredProfile.promise;
    });

    const loadedDialog = document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']");
    if (!(loadedDialog instanceof HTMLElement)) {
      throw new Error("Loaded leaderboard profile dialog was not found");
    }
    expect(loadedDialog.textContent).toContain("Mina");
    expect(loadedDialog.textContent).toContain("Friend");
    expect(loadedDialog.textContent).toContain("Silver Bright Harbor");
    expect(loadedDialog.querySelector("[data-testid='progress-leaderboard-profile-best-rating']")?.textContent).toBe("#2 in 24h");
    expect(loadedDialog.querySelectorAll("[data-testid='progress-leaderboard-profile-activity-day']")).toHaveLength(30);
    expect(loadedDialog.querySelector("[data-testid='progress-leaderboard-profile-total-cards']")?.textContent).toBe("42");

    const closeButton = document.body.querySelector("[data-testid='progress-leaderboard-profile-close']");
    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard profile close button was not found");
    }

    await act(async () => {
      closeButton.click();
    });
    await act(async () => {
      openButton.click();
    });

    expect(apiMocks.loadProgressLeaderboardProfileMock).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']")?.textContent).toContain("Mina");
  });

  it("keeps the viewer title and shows the anonymous name for the rating leaderboard profile", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));
    const deferredProfile = createDeferredProfile();
    apiMocks.loadProgressLeaderboardProfileMock.mockReturnValueOnce(deferredProfile.promise);

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();
    const openButton = container.querySelector("[data-testid='progress-leaderboard-row-viewer-button']");
    if (!(openButton instanceof HTMLButtonElement)) {
      throw new Error("Rating leaderboard viewer profile button was not found");
    }

    await act(async () => {
      openButton.click();
    });

    const loadingDialog = document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']");
    if (!(loadingDialog instanceof HTMLElement)) {
      throw new Error("Leaderboard viewer profile dialog was not opened");
    }
    expect(apiMocks.loadProgressLeaderboardProfileMock).toHaveBeenCalledWith("viewer-profile");
    expect(loadingDialog.querySelector("[data-testid='progress-leaderboard-profile-title']")?.textContent).toBe("You");
    expect(loadingDialog.querySelector(".progress-leaderboard-profile-anonymous-name")?.textContent).toBe("Quiet Maple Grove");

    await act(async () => {
      deferredProfile.resolve(createLeaderboardReadyProfile("viewer-profile", "Quiet Maple Grove", null));
      await deferredProfile.promise;
    });

    const loadedDialog = document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']");
    if (!(loadedDialog instanceof HTMLElement)) {
      throw new Error("Loaded leaderboard viewer profile dialog was not found");
    }
    expect(loadedDialog.querySelector("[data-testid='progress-leaderboard-profile-title']")?.textContent).toBe("You");
    expect(loadedDialog.querySelector(".progress-leaderboard-profile-anonymous-name")?.textContent).toBe("Quiet Maple Grove");
    expect(loadedDialog.querySelector(".progress-leaderboard-profile-friend-label")).toBeNull();
  });

  it("renders separate rating and streak leaderboard cards with streak day values", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboards(
      createLeaderboardSourceState("ready", null),
      createStreakLeaderboardSourceState("ready"),
    );

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const ratingCard = container.querySelector("[data-testid='progress-leaderboard-card']");
    if (!(ratingCard instanceof HTMLElement)) {
      throw new Error("Rating leaderboard card was not found");
    }
    const streakCard = container.querySelector("[data-testid='progress-streak-leaderboard-card']");
    if (!(streakCard instanceof HTMLElement)) {
      throw new Error("Streak leaderboard card was not found");
    }

    expect(ratingCard.compareDocumentPosition(streakCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(ratingCard.textContent).toContain("Rating leaderboard");
    expect(streakCard.textContent).toContain("Streak leaderboard");

    expect(ratingCard.querySelector("[data-testid='progress-leaderboard-invite-open']")).not.toBeNull();
    expect(ratingCard.querySelector("[data-testid='progress-leaderboard-period-last_24_hours']")).not.toBeNull();
    expect(streakCard.querySelector("[data-testid='progress-leaderboard-invite-open']")).toBeNull();
    expect(streakCard.querySelector(".progress-leaderboard-periods")).toBeNull();
    expect(streakCard.querySelectorAll("[data-testid^='progress-leaderboard-period-']")).toHaveLength(0);

    expect(streakCard.querySelector("[data-testid='progress-streak-leaderboard-streak-days-top']")?.textContent).toBe("8 days");
    expect(streakCard.querySelector("[data-testid='progress-streak-leaderboard-streak-days-viewer']")?.textContent).toBe("2 days");
    expect(streakCard.querySelector("[data-testid='progress-streak-leaderboard-row-viewer']")?.textContent).toContain("You");
  });

  it("opens the same profile dialog from a streak leaderboard row", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboards(
      createLeaderboardSourceState("ready", null),
      createStreakLeaderboardSourceState("ready"),
    );
    apiMocks.loadProgressLeaderboardProfileMock.mockResolvedValueOnce(
      createLeaderboardReadyProfile("streak-profile-1", "Solar Clear Summit", null),
    );

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();
    const openButton = container.querySelector("[data-testid='progress-streak-leaderboard-row-top-button']");
    if (!(openButton instanceof HTMLButtonElement)) {
      throw new Error("Streak leaderboard profile button was not found");
    }

    await act(async () => {
      openButton.click();
    });

    expect(apiMocks.loadProgressLeaderboardProfileMock).toHaveBeenCalledWith("streak-profile-1");
    const dialog = document.body.querySelector("[data-testid='progress-leaderboard-profile-dialog']");
    if (!(dialog instanceof HTMLElement)) {
      throw new Error("Leaderboard profile dialog was not opened from the streak leaderboard");
    }
    expect(dialog.textContent).toContain("Solar Clear Summit");
    expect(dialog.querySelector("[data-testid='progress-leaderboard-profile-current-streak']")?.textContent).toBe("6 days");
  });

  it("renders the local viewer-only streak leaderboard row when the server snapshot is unavailable", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboards(
      createLeaderboardSourceState("ready", null),
      createLocalOnlyStreakLeaderboardSourceState(),
    );

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const streakCard = container.querySelector("[data-testid='progress-streak-leaderboard-card']");
    if (!(streakCard instanceof HTMLElement)) {
      throw new Error("Streak leaderboard card was not found");
    }

    const rows = [...streakCard.querySelectorAll(".progress-leaderboard-row:not(.progress-leaderboard-row-padding)")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-kind")).toBe("viewer");
    expect(rows[0]?.textContent).toContain("#1");
    expect(rows[0]?.textContent).toContain("You");
    expect(streakCard.querySelector("[data-testid='progress-streak-leaderboard-row-viewer-button']")).toBeNull();
    expect(rows[0]?.querySelector("button")).toBeNull();
    if (!(rows[0] instanceof HTMLElement)) {
      throw new Error("Local-only streak leaderboard row was not an element");
    }
    rows[0].click();
    expect(apiMocks.loadProgressLeaderboardProfileMock).not.toHaveBeenCalled();
    expect(streakCard.querySelector("[data-testid='progress-streak-leaderboard-streak-days-viewer']")?.textContent).toBe("2 days");
  });

  it("renders friend rows from ranking rows and dedupes already visible friends", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    const friendRankingRows = addFriendDisplayNamesToRankingRows(
      createLeaderboardRankingRows(),
      new Map([
        [2, "Mina"],
        [12, "Ari"],
        [41, "Kai"],
      ]),
    );
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithWindowRankingRows("last_24_hours", friendRankingRows),
      null,
    ));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const rows = [...container.querySelectorAll(".progress-leaderboard-row:not(.progress-leaderboard-row-padding)")];
    const rowTexts = rows.map((row) => row.textContent ?? "");

    expect(rowTexts.filter((text) => text.includes("Mina"))).toHaveLength(1);
    expect(rowTexts.filter((text) => text.includes("Kai"))).toHaveLength(1);
    expect(rowTexts).toEqual(expect.arrayContaining([
      expect.stringContaining("Ari"),
    ]));
    expect(container.textContent).not.toContain("Hidden Rank 12");
    expect(rowTexts.findIndex((text) => text.includes("#12"))).toBeLessThan(
      rowTexts.findIndex((text) => text.includes("#41")),
    );
  });

  it("pads the selected leaderboard period to the largest friend-expanded row count", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    const allTimeFriendRows = addFriendDisplayNameToRankingRows(
      addFriendDisplayNameToRankingRows(createLeaderboardRankingRows(), 12, "Ari"),
      20,
      "Noor",
    );
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithWindowRankingRows("all_time", allTimeFriendRows),
      null,
    ));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    expect(container.querySelectorAll("[data-testid='progress-leaderboard-row-padding']")).toHaveLength(4);
    expect(container.textContent).not.toContain("Ari");
    expect(container.textContent).not.toContain("Noor");
  });

  it("reveals the leaderboard info text explaining that Again reviews are excluded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:35:05.000Z"));
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    expect(container.querySelector("[data-testid='progress-leaderboard-info']")).toBeNull();
    expect(container.querySelector("[data-testid='progress-leaderboard-freshness']")).toBeNull();

    const infoToggle = container.querySelector("[data-testid='progress-leaderboard-info-toggle']");
    if (!(infoToggle instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard info toggle was not found");
    }

    await act(async () => {
      infoToggle.click();
    });

    const infoText = container.querySelector("[data-testid='progress-leaderboard-info']");
    if (!(infoText instanceof HTMLParagraphElement)) {
      throw new Error("Leaderboard info text was not found");
    }
    expect(infoText.textContent).toContain("Hard, Good, or Easy count");
    expect(infoText.textContent).toContain("Again reviews are not counted.");
    expect(infoText.textContent).toContain("Updated 35 minutes ago");
    expect(container.querySelector("[data-testid='progress-leaderboard-freshness']")).toBeNull();
  });

  it("formats leaderboard info freshness with hours and minutes after one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:35:05.000Z"));
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithSnapshotGeneratedAt("2026-04-21T03:55:05.000Z"),
      null,
    ));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const infoToggle = container.querySelector("[data-testid='progress-leaderboard-info-toggle']");
    if (!(infoToggle instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard info toggle was not found");
    }

    await act(async () => {
      infoToggle.click();
    });

    const infoText = container.querySelector("[data-testid='progress-leaderboard-info']");
    if (!(infoText instanceof HTMLParagraphElement)) {
      throw new Error("Leaderboard info text was not found");
    }
    expect(infoText.textContent).toContain("Updated 6 hours and 40 minutes ago");
  });

  it("reveals the streak leaderboard info text with snapshot freshness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:35:05.000Z"));
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboards(
      createLeaderboardSourceState("ready", null),
      createStreakLeaderboardSourceState("ready"),
    );

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const infoToggle = container.querySelector("[data-testid='progress-streak-leaderboard-info-toggle']");
    if (!(infoToggle instanceof HTMLButtonElement)) {
      throw new Error("Streak leaderboard info toggle was not found");
    }

    await act(async () => {
      infoToggle.click();
    });

    const infoText = container.querySelector("[data-testid='progress-streak-leaderboard-info']");
    if (!(infoText instanceof HTMLParagraphElement)) {
      throw new Error("Streak leaderboard info text was not found");
    }
    expect(infoText.textContent).toContain("Current streak days determine your rank.");
    expect(infoText.textContent).toContain("A streak day is any local day with at least one card review rated Again, Hard, Good, or Easy.");
    expect(infoText.textContent).toContain("Updated 50 minutes ago");
  });

  it("reranks the viewer and renders new neighbors when the local qualified review count moves higher", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", {
      last_24_hours: 9,
      last_3_days: 9,
      last_7_days: 9,
      last_30_days: 9,
      all_time: 9,
    }));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const viewerRow = container.querySelector("[data-testid='progress-leaderboard-row-viewer']");
    if (!(viewerRow instanceof HTMLElement)) {
      throw new Error("Leaderboard viewer row was not found");
    }

    expect(viewerRow.querySelector("[data-testid='progress-leaderboard-count-viewer']")?.textContent).toBe("9");
    expect(viewerRow.textContent).toContain("#41");

    const rows = [...container.querySelectorAll(".progress-leaderboard-row")];
    const rowTexts = rows.map((row) => row.textContent);
    expect(rowTexts[4]).toContain("Hidden Rank 40");
    expect(rowTexts[4]).toContain("#40");
    expect(rowTexts[5]).toContain("You");
    expect(rowTexts[5]).toContain("#41");
    expect(rowTexts[6]).toContain("Jade Swift River");
    expect(rowTexts[6]).toContain("#42");
    expect(container.textContent).not.toContain("Bold Cedar Crest");

    const neighborCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-neighbor']")]
      .map((count) => count.textContent);
    expect(neighborCounts).toEqual(["10", "8", "0"]);

    const topCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-top']")]
      .map((count) => count.textContent);
    expect(topCounts).toEqual(["51", "44", "30"]);
  });

  it("auto-selects the leaderboard window where the viewer has the best rank", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithViewerRanks({
        last_24_hours: 9,
        last_3_days: 8,
        last_7_days: 3,
        last_30_days: 11,
        all_time: 4,
      }),
      null,
    ));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const bestPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_7_days']");
    if (!(bestPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Best leaderboard period button was not found");
    }
    const fallbackPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_24_hours']");
    if (!(fallbackPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Fallback leaderboard period button was not found");
    }

    expect(bestPeriodButton.getAttribute("aria-pressed")).toBe("true");
    expect(fallbackPeriodButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the visible leaderboard window with the period control", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const defaultPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_24_hours']");
    if (!(defaultPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Default leaderboard period button was not found");
    }
    expect(defaultPeriodButton.getAttribute("aria-pressed")).toBe("true");

    const allTimePeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-all_time']");
    if (!(allTimePeriodButton instanceof HTMLButtonElement)) {
      throw new Error("All-time leaderboard period button was not found");
    }

    await act(async () => {
      allTimePeriodButton.click();
    });

    expect(allTimePeriodButton.getAttribute("aria-pressed")).toBe("true");
    expect(defaultPeriodButton.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).not.toBeNull();
  });
});
