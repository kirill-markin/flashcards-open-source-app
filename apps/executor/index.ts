import { accountRouter, defineApp, toolAnnotations, withApprovals } from "apps";
import { mcpRouter } from "apps/mcp";
import { always } from "apps/operations/approval";
import { provider } from "./provider.ts";

export default defineApp(
  { accounts: { nibomo: provider.many() } },
  async ({ accounts, signal, cache }) => ({
    tools: await accountRouter(
      accounts.nibomo,
      async (account) =>
        withApprovals(
          await mcpRouter({
            url: "https://mcp.nibomo.com/mcp",
            account,
            cache,
            headers: { Authorization: "Bearer " + account.fields.access_token },
            signal,
          }),
          (tool) =>
            toolAnnotations(tool)?.destructiveHint === true ? always() : undefined,
        ),
      { signal },
    ),
  }),
);
