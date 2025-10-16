import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const baseConfig = {
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    globals: {
      ...globals.browser
    }
  },
  plugins: {
    react: reactPlugin
  },
  rules: {
    ...reactPlugin.configs.recommended.rules,
    "react/react-in-jsx-scope": "off"
  },
  settings: {
    react: {
      version: "detect"
    }
  }
};

export default [
  js.configs.recommended,
  {
    ...baseConfig,
    files: ["**/*.{js,jsx}"]
  },
  {
    ...baseConfig,
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ...baseConfig.languageOptions,
      parser: tsParser,
      parserOptions: {
        ...baseConfig.languageOptions.parserOptions,
        project: ["./tsconfig.json"]
      }
    },
    plugins: {
      ...baseConfig.plugins,
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...baseConfig.rules,
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
];
