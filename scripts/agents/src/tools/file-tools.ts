import {
  createFileTools as createFileToolsBase,
  type CreateFileToolsOptions,
} from 'ultra-mcp-toolkit/agent-tools';

/**
 * File tools for reading and writing files inside the working directory.
 *
 * Sourced from `ultra-mcp-toolkit/agent-tools` so the path-resolution,
 * symlink, and protected-path checks stay in lockstep with every other
 * server consuming the toolkit. Do not bypass the toolkit by going back to
 * raw `fs.readFile` / `fs.writeFile` — if you need something the toolkit
 * doesn't expose, add it there.
 *
 * The toolkit's protected-path defaults already cover the things we care
 * about (`.github/`, `scripts/`, `.env*`, lockfiles, key files, …) so no
 * extra options are wired here yet.
 */
export function createFileTools(workingDir: string, options: CreateFileToolsOptions = {}) {
  return createFileToolsBase(workingDir, options);
}
