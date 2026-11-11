import { defineProvider, oauth2 } from "apps";

export const provider = defineProvider({
  name: "Nibomo",
  hosts: ["mcp.nibomo.com"],
  auth: {
    oauth: oauth2({ discover: "https://mcp.nibomo.com/mcp" }),
  },
});
