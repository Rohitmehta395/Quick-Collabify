// -------------------------------------------------------------------------
// prettier.config.js
// Prettier is an opinionated code formatter. It automatically styles our code
// to be consistent across the entire project (tabs vs spaces, quotes, etc).
// -------------------------------------------------------------------------

export default {
  // Max characters per line. 100 provides a good balance for modern wide monitors.
  printWidth: 100,

  // We use 2 spaces for indentation.
  tabWidth: 2,
  useTabs: false,

  // Always require semicolons at the ends of statements.
  semi: true,

  // Use single quotes for strings ('hello') instead of double quotes ("hello").
  singleQuote: true,

  // Add trailing commas where valid in ES5 (objects, arrays, etc).
  // This makes git diffs much cleaner.
  trailingComma: 'all',

  // Print spaces between brackets in object literals. e.g. { foo: bar }
  bracketSpacing: true,

  // Always include parentheses around a sole arrow function parameter. e.g. (x) => x
  arrowParens: 'always',
};
