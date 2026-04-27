// Consolidated tool: jira_server
//
// Replaces v1's jira_get_server_info.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const InfoSchema = z.object({});

export const jiraServer: ConsolidatedTool = {
  name: "jira_server",
  description: "Inspect the Jira server: version, build, deployment type.",
  actions: {
    info: { description: "Server info.", schema: InfoSchema, operation: "server.info" },
  },
};
