/**
 * Generic loader that validates environment variables against a provided Zod schema.
 * Throws a formatted error immediately if validation fails, implementing our "fail-fast" principle.
 */
export function loadConfig(schema, env = process.env) {
  const result = schema.safeParse(env);

  if (!result.success) {
    const errors = result.error.format();
    console.error('❌ Environment Variable Validation Failed:');

    for (const [key, value] of Object.entries(errors)) {
      if (key !== '_errors' && value && value._errors) {
        console.error(`  - ${key}: ${value._errors.join(', ')}`);
      }
    }

    // Hard exit to prevent the app from starting in a broken state
    process.exit(1);
  }

  return result.data;
}
