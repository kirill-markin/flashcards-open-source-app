import { deleteDatabase } from "./core";

export async function clearWebSyncCache(): Promise<void> {
  await deleteDatabase();
}
