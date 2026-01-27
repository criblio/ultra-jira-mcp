// Sample file with intentional issues for PR review testing

export function processUserInput(input: string) {
  // Missing input validation - should check for null/undefined
  const trimmed = input.trim();

  // SQL injection vulnerability - using string concatenation
  const query = "SELECT * FROM users WHERE name = '" + trimmed + "'";

  // Missing error handling
  const result = executeQuery(query);

  return result;
}

export function calculateDiscount(price: number, percent: number) {
  // No validation of input ranges
  return price - (price * percent);
}

function executeQuery(query: string) {
  // Stub function
  return [];
}
