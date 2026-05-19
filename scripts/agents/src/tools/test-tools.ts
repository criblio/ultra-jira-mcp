import {
  createTestTools as createTestToolsBase,
  type CreateTestToolsOptions,
} from 'ultra-mcp-toolkit/agent-tools';

/**
 * Test / build / lint runner tools backed by the toolkit.
 *
 * The toolkit exposes a fixed set of `npm` subcommands (test, type-check,
 * lint, install) with argv arrays — the model cannot pass arbitrary shell
 * commands. There is no `executeCommand` escape hatch by design; if you
 * find yourself wanting one, that's the smell v2.2.0 closed.
 */
export function createTestTools(workingDir: string, options: CreateTestToolsOptions = {}) {
  return createTestToolsBase(workingDir, options);
}
