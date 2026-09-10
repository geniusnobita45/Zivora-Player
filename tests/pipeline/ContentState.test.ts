import { describe, expect, it } from "vitest";
import { canTransition } from "@/pipeline/validation/ContentState";
describe("content lifecycle", () => {
  it("allows only forward validation", () => {
    expect(canTransition("VALIDATING", "READY")).toBe(true);
    expect(canTransition("READY", "PROCESSING")).toBe(false);
  });
});
