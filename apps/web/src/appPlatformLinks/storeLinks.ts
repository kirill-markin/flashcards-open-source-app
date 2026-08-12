import type { AppPlatformStoreLinks } from "./appPlatformOptions";

/**
 * Campaign-tagged store links, one set per surface that offers the app.
 * The campaign tags are a governed contract documented in `docs/marketing-links.md`,
 * so these URLs are the only thing that legitimately differs between surfaces.
 */

export const shareAppStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=share_app&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=share_app",
};

export const webReviewMobilePromptStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=web_review_mobile_prompt&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=web_review_mobile_prompt",
};

export const catalogImportStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=catalog_import&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=catalog_import",
};

export const friendInviteStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=friend_invite&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=friend_invite",
};
