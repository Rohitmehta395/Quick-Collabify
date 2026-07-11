import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "error",
      "eqeqeq": ["error", "always"],
    },
  },
  {
    files: ["packages/**/*.js", "packages/**/*.jsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["apps/*", "*/apps/*", "../../apps/*", "../../../apps/*", "../../../../apps/*"],
              message: "Packages must not import from apps.",
            },
          ],
        },
      ],
    },
  },
];
