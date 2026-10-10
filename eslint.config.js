import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules",
      "**/dist",
      // Byte-for-byte nessa_ui at e02b577a. stand-in.test.ts is the check.
      "extensions/experiments/app/kit-stand-in/src/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/**/*.{ts,tsx}", "extensions/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // Ways Node code reaches a file without the module graph seeing it, so
    // without the boundary guard judging it (docs/adr/todo/1-extensions-repo.md).
    // Held here for every file in a unit: source, tests, and vite.config.ts.
    files: [
      "packages/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
      "extensions/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["module", "node:module"].map((name) => ({
            name,
            importNames: ["createRequire"],
            message: "createRequire loads a file the boundary guard never sees.",
          })),
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='getBuiltinModule']",
          message: "process.getBuiltinModule reaches Node past the boundary guard.",
        },
        {
          selector: "ImportDeclaration[source.value=/^data:/i]",
          message: "A data: import is code the boundary guard cannot place.",
        },
        {
          selector:
            ":matches(ExportAllDeclaration, ExportNamedDeclaration)[source.value=/^data:/i]",
          message: "A data: import is code the boundary guard cannot place.",
        },
        {
          selector: "ImportExpression[source.value=/^data:/i]",
          message: "A data: import is code the boundary guard cannot place.",
        },
        {
          selector:
            "ImportExpression > TemplateLiteral.source[quasis.0.value.raw=/^data:/i]",
          message: "A data: import is code the boundary guard cannot place.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // A verification script runs in Node and evaluates callbacks in the page.
    files: ["extensions/**/verification/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
)
