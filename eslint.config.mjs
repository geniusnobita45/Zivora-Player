import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL(".", import.meta.url)) });
const shaka = {
  group: ["shaka-player", "shaka-player/**"],
  message: "Shaka belongs exclusively in core/adapters/ShakaAdapter.ts.",
};
const ai = {
  regex:
    "^(?:ai(?:/|$)|@ai-sdk/|openai(?:/|$)|@anthropic-ai/|@google/(?:generative-ai|genai)(?:/|$)|cohere-ai(?:/|$)|@mistralai/|@aws-sdk/client-bedrock-runtime(?:/|$))",
  message: "AI SDKs belong exclusively in features/ai/gateway.",
};
const react = {
  group: [
    "react",
    "react/**",
    "react-dom",
    "react-dom/**",
    "next",
    "next/**",
    "@/components/**",
    "@/stores/**",
    "@/features/**",
    "@/services/**",
  ],
  message: "core must be independent of React, application features, and optional services.",
};
const syntax = (pattern, message) => [
  { selector: `ImportExpression[source.value=/${pattern}/]`, message },
  {
    selector: `CallExpression[callee.name='require'] > Literal.arguments[value=/${pattern}/]`,
    message,
  },
];
const shakaSyntax = syntax("^shaka-player", shaka.message);
const controllerBoundary = {
  regex: "(?:^|/)(?:PlayerEngine|ShakaAdapter|MockAdapter|PlaybackAdapter)(?:\\.ts)?$",
  allowTypeImports: true,
  message:
    "Application actions must use PlayerController; engine and adapters are internal to core.",
};
const controllerSyntax = syntax(
  "(PlayerEngine|ShakaAdapter|MockAdapter|PlaybackAdapter)",
  controllerBoundary.message,
);
const aiSyntax = syntax(
  "^(ai$|@ai-sdk|openai|@anthropic-ai|@google.generative-ai|@google.genai|cohere-ai|@mistralai|@aws-sdk.client-bedrock-runtime)",
  ai.message,
);

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "next-env.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [shaka, ai] }],
      "no-restricted-syntax": ["error", ...shakaSyntax, ...aiSyntax],
    },
  },
  {
    files: ["core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [shaka, ai, react] }],
      "no-restricted-syntax": [
        "error",
        ...shakaSyntax,
        ...aiSyntax,
        ...syntax("^(react|next$)", react.message),
      ],
    },
  },
  {
    files: ["core/adapters/ShakaAdapter.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ai, react] }],
      "no-restricted-syntax": ["error", ...aiSyntax, ...syntax("^(react|next$)", react.message)],
    },
  },
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "features/**/*.{ts,tsx}",
      "stores/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [shaka, ai, controllerBoundary] }],
      "no-restricted-syntax": ["error", ...shakaSyntax, ...aiSyntax, ...controllerSyntax],
    },
  },
  {
    files: ["features/ai/gateway/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [shaka, controllerBoundary] }],
      "no-restricted-syntax": ["error", ...shakaSyntax, ...controllerSyntax],
    },
  },
];
export default config;
