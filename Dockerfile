# Runs the MCP server in a container, so `npm ci` and dependency install
# scripts never execute on the host.
#
#   docker build -t ultra-jira-mcp .
#
# See "Docker" in README.md for the MCP client config.
FROM node:22-slim

WORKDIR /app
COPY . .
# `prepare` runs `tsc`, so `npm ci` installs and builds in one step. Pruning
# afterwards keeps dev-only packages (vitest, tsx, typescript) out of the image.
RUN npm ci && npm prune --omit=dev

USER node
ENTRYPOINT ["node", "build/index.js"]
