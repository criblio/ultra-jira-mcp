import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { VulnerabilityReport } from '../agents/types.js';

const execFileAsync = promisify(execFile);

/**
 * NPM tools for package management and security scanning.
 *
 * Every `npm` invocation uses `execFile("npm", [...])` — argv array, no
 * shell. Package names, versions, and flags are NEVER concatenated into a
 * command string; an attacker-controlled `packageName` (or one inside an
 * untrusted issue body the agent has been pointed at) cannot escape via
 * `$()`, backticks, or `;`.
 *
 * Package names are also format-validated against the npm name grammar
 * before being shelled out, to keep the model from accidentally passing
 * a flag (e.g. `--registry=evil.example.com`) as a "package name".
 */
export function createNpmTools(workingDir: string) {
  async function npm(
    args: string[],
    timeoutMs = 120_000,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('npm', args, {
      cwd: workingDir,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  /** npm package name grammar (scoped or unscoped). Rejects flag-shaped strings. */
  function isValidPackageName(name: string): boolean {
    if (!name || name.startsWith('-')) return false;
    return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name);
  }

  /** Loose semver-ish check that rejects shell metacharacters and flags. */
  function isValidVersionSpec(v: string): boolean {
    if (!v || v.startsWith('-')) return false;
    return /^[A-Za-z0-9.+\-^~*<>=|x ]+$/.test(v);
  }

  return {
    npmAudit: tool({
      description: 'Run npm audit to check for security vulnerabilities in dependencies',
      inputSchema: z.object({
        auditLevel: z
          .enum(['low', 'moderate', 'high', 'critical'])
          .default('moderate')
          .describe('Minimum severity level to report'),
      }),
      execute: async ({ auditLevel }: { auditLevel: 'low' | 'moderate' | 'high' | 'critical' }) => {
        let auditJson: string;
        try {
          const { stdout } = await npm(['audit', '--json', `--audit-level=${auditLevel}`]);
          auditJson = stdout;
        } catch (error: unknown) {
          // npm audit returns non-zero when vulnerabilities exist.
          if (error && typeof error === 'object' && 'stdout' in error) {
            auditJson = (error as { stdout: string }).stdout;
          } else {
            return {
              success: false,
              error: `Failed to run npm audit: ${error instanceof Error ? error.message : 'Unknown error'}`,
              vulnerabilities: [],
            };
          }
        }

        try {
          const audit = JSON.parse(auditJson);
          const vulnerabilities: VulnerabilityReport[] = [];

          if (audit.vulnerabilities) {
            for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities)) {
              const v = vuln as {
                severity: string;
                via: Array<{ title?: string; url?: string; source?: number } | string>;
                fixAvailable: boolean | { name: string; version: string };
              };

              const viaInfo = v.via[0];
              const title =
                typeof viaInfo === 'object' && viaInfo.title
                  ? viaInfo.title
                  : `Vulnerability in ${pkgName}`;

              vulnerabilities.push({
                id:
                  typeof viaInfo === 'object' && viaInfo.source
                    ? String(viaInfo.source)
                    : pkgName,
                package: pkgName,
                severity: v.severity as VulnerabilityReport['severity'],
                title,
                description: title,
                fixAvailable: !!v.fixAvailable,
                fixedIn:
                  typeof v.fixAvailable === 'object'
                    ? v.fixAvailable.version
                    : undefined,
              });
            }
          }

          return {
            success: true,
            vulnerabilities,
            totalVulnerabilities: vulnerabilities.length,
            metadata: audit.metadata,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to parse npm audit output: ${error instanceof Error ? error.message : 'Unknown error'}`,
            vulnerabilities: [],
          };
        }
      },
    }),

    npmAuditFix: tool({
      description: 'Run npm audit fix to automatically fix vulnerabilities',
      inputSchema: z.object({
        force: z.boolean().default(false).describe('Force fix (may include breaking changes)'),
        dryRun: z.boolean().default(false).describe('Show what would be changed without making changes'),
      }),
      execute: async ({ force, dryRun }: { force: boolean; dryRun: boolean }) => {
        const args = ['audit', 'fix'];
        if (force) args.push('--force');
        if (dryRun) args.push('--dry-run');
        try {
          const { stdout } = await npm(args, 300_000);
          return { success: true, output: stdout, dryRun, force };
        } catch (error) {
          return {
            success: false,
            error: `Failed to run npm audit fix: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    }),

    npmUpdate: tool({
      description: 'Update a specific npm package (name validated against npm package-name grammar)',
      inputSchema: z.object({
        packageName: z.string().describe('Name of the package to update'),
        version: z.string().optional().describe('Specific version or range to update to'),
      }),
      execute: async ({ packageName, version }: { packageName: string; version?: string }) => {
        if (!isValidPackageName(packageName)) {
          return { success: false, error: `Invalid package name: ${packageName}` };
        }
        if (version !== undefined && !isValidVersionSpec(version)) {
          return { success: false, error: `Invalid version spec: ${version}` };
        }
        try {
          const args = version
            ? ['install', `${packageName}@${version}`]
            : ['update', packageName];
          const { stdout } = await npm(args, 120_000);
          return { success: true, package: packageName, version, output: stdout };
        } catch (error) {
          return {
            success: false,
            error: `Failed to update package: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    }),

    npmOutdated: tool({
      description: 'List outdated packages in the project',
      inputSchema: z.object({}),
      execute: async () => {
        let outdatedJson: string;
        try {
          const { stdout } = await npm(['outdated', '--json']);
          outdatedJson = stdout || '{}';
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'stdout' in error) {
            outdatedJson = (error as { stdout: string }).stdout || '{}';
          } else {
            outdatedJson = '{}';
          }
        }

        try {
          const outdated = JSON.parse(outdatedJson);
          const packages = Object.entries(outdated).map(([name, info]) => {
            const i = info as { current: string; wanted: string; latest: string };
            return { name, current: i.current, wanted: i.wanted, latest: i.latest };
          });
          return { success: true, packages, count: packages.length };
        } catch (error) {
          return {
            success: false,
            error: `Failed to check outdated packages: ${error instanceof Error ? error.message : 'Unknown error'}`,
            packages: [],
          };
        }
      },
    }),

    readPackageJson: tool({
      description: 'Read the package.json file (fixed path; no traversal accepted)',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const content = await readFile(join(workingDir, 'package.json'), 'utf-8');
          const pkg = JSON.parse(content);
          return {
            success: true,
            name: pkg.name,
            version: pkg.version,
            dependencies: pkg.dependencies || {},
            devDependencies: pkg.devDependencies || {},
            scripts: pkg.scripts || {},
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to read package.json: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    }),

    npmInstall: tool({
      description: 'Run npm install / npm ci to install dependencies',
      inputSchema: z.object({
        clean: z.boolean().default(false).describe('Run npm ci instead of npm install'),
      }),
      execute: async ({ clean }: { clean: boolean }) => {
        try {
          const args = clean ? ['ci'] : ['install'];
          const { stdout } = await npm(args, 300_000);
          return { success: true, output: stdout, command: clean ? 'npm ci' : 'npm install' };
        } catch (error) {
          return {
            success: false,
            error: `Failed to install dependencies: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    }),
  };
}
