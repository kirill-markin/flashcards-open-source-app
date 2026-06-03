import { deleteDatabase } from "./database";

export async function clearWebSyncCache(): Promise<void> {
  await deleteDatabase();
}
