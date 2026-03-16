import { closeDatabaseAfterWrite, runReadwrite } from "./core";

export async function clearWebSyncCache(): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(
      database,
      ["cards", "cardTags", "decks", "reviewEvents", "workspaceSettings", "workspaceSyncState", "outbox", "meta"],
      (transaction) => {
        transaction.objectStore("cards").clear();
        transaction.objectStore("cardTags").clear();
        transaction.objectStore("decks").clear();
        transaction.objectStore("reviewEvents").clear();
        transaction.objectStore("workspaceSettings").clear();
        transaction.objectStore("workspaceSyncState").clear();
        transaction.objectStore("outbox").clear();
        transaction.objectStore("meta").clear();
        return null;
      },
    );
  });
}
