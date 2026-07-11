// -------------------------------------------------------------------------
// commitlint.config.js
// Enforces that all our git commits follow the "Conventional Commits" standard.
// For example: "feat: added new feature", "fix: resolved crash", "chore: updated configs"
// -------------------------------------------------------------------------

export default {
  // We extend the standard community rules for conventional commits.
  extends: ['@commitlint/config-conventional'],
};
