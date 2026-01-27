
/**
 * Test file with security issue
 */

export function executeCode(code: string): unknown {
  // Security issue: eval is dangerous
  return eval(code);
}

export function buildQuery(userInput: string): string {
  // SQL injection vulnerability
  return `SELECT * FROM users WHERE name = '${userInput}'`;
}
