import type { Handler } from "aws-lambda";
import { runMigrations } from "./migrationRunner";

export const handler: Handler = async () => {
  const result = await runMigrations();
  return result;
};
