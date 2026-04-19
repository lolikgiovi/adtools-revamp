import js from "@eslint/js";
import globals from "globals";

const recommendedRulesAsWarnings = Object.fromEntries(Object.keys(js.configs.recommended.rules).map((rule) => [rule, "warn"]));

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".vite/**",
      ".wrangler/**",
      "backend-workers/.wrangler/**",
      "tauri/target/**",
      "tauri/gen/**",
      "tauri/releases/**",
      "tauri/sidecar/build/**",
      "tauri/oracle-sidecar-*",
      "tauri/binaries/oracle-sidecar-*",
      "frontend/tools/html-editor/vendor/**",
      "frontend/public/web-build.json",
      "package-lock.json",
      "backend-workers/package-lock.json",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      ...recommendedRulesAsWarnings,
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.test.js", "vitest.setup.js"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
];
