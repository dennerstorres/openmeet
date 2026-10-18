// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const typeScriptAndJavaScript = [js.configs.recommended, tseslint.configs.recommended, prettier];

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/src-tauri/**", "coverage/**"],
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    extends: typeScriptAndJavaScript,
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["packages/media/**/*.ts"],
    extends: typeScriptAndJavaScript,
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["apps/server/**/*.ts", "packages/shared/**/*.ts", "apps/desktop/vite.config.ts", "apps/desktop/test/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    extends: typeScriptAndJavaScript,
    languageOptions: {
      globals: globals.node,
    },
  },
);
