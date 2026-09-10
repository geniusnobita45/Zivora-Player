// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint();
describe("frozen playback import boundaries", () => {
  it.each([
    [
      "components/player/BoundaryProbe.tsx",
      'export { PlayerEngine } from "@/core/player/PlayerEngine";',
      true,
    ],
    [
      "features/ai/commands/BoundaryProbe.ts",
      'export const engine = () => import("@/core/player/PlayerEngine");',
      true,
    ],
    [
      "components/player/BoundaryProbe.tsx",
      'export { PlayerController } from "@/core/player/PlayerController";',
      false,
    ],
    [
      "tests/spoiler-guard/BoundaryProbe.ts",
      'export { filterSpoilers } from "@/features/ai/spoiler-guard";',
      false,
    ],
    ["components/player/BoundaryProbe.tsx", 'export { default as sdk } from "shaka-player";', true],
    [
      "features/ai/gateway/BoundaryProbe.ts",
      'export const sdk = () => import("shaka-player");',
      true,
    ],
    ["core/player/BoundaryProbe.ts", 'export { useState } from "react";', true],
    ["core/player/BoundaryProbe.ts", 'export const react = () => import("react");', true],
    ["components/player/BoundaryProbe.tsx", 'export { default as sdk } from "openai";', true],
    [
      "features/ai/orchestrator/BoundaryProbe.ts",
      'export const sdk = () => import("@ai-sdk/openai");',
      true,
    ],
    ["core/adapters/ShakaAdapter.ts", 'export const sdk = () => import("shaka-player");', false],
    ["core/adapters/ShakaAdapter.ts", 'export { default as sdk } from "openai";', true],
    ["features/ai/gateway/BoundaryProbe.ts", 'export { default as sdk } from "openai";', false],
  ])(
    "enforces %s (%s)",
    async (filePath, code, restricted) => {
      const results = await eslint.lintText(code, { filePath });
      const violations = results
        .flatMap((result) => result.messages)
        .filter((message) =>
          ["no-restricted-imports", "no-restricted-syntax"].includes(message.ruleId ?? ""),
        );
      expect(violations.length > 0).toBe(restricted);
    },
    30_000,
  );
});
