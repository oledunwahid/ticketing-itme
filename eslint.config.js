/* ESLint flat config — `npm run lint`.
   Backend is CommonJS on Node; public/app.js is a single browser script. */
const js = require("@eslint/js");
const globals = require("globals");

const shared = {
  "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["warn", { destructuring: "all" }],
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-eval": "error",
};

module.exports = [
  { ignores: ["node_modules/**", "uploads/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["public/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: shared,
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, Viz: "readonly" },
    },
    rules: shared,
  },
  {
    files: ["public/charts.js"],
    rules: { "no-redeclare": "off", "no-unused-vars": ["warn", { varsIgnorePattern: "^Viz$" }] },
  },
];
