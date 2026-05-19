import { parseQueryCardsPageResponse } from "../apiContracts/cards";
import type {
  QueryCardsInput,
  QueryCardsPage,
} from "../types";
import { parseContractResponse } from "./response";
import { allowAuthRecovery, requestJson } from "./transport";

export async function queryCards(
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/cards/query`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/cards/query`, parseQueryCardsPageResponse);
}
