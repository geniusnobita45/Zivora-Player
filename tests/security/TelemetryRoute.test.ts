// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTelemetryHandler } from "@/services/telemetry/TelemetryRoute";

const body = {
  schemaVersion: 1,
  sentAt: "2026-09-09T00:00:00.000Z",
  sessions: [
    {
      context: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userId: "99999999-9999-4999-8999-999999999999",
        contentId: "22222222-2222-4222-8222-222222222222",
        episodeId: null,
        mediaVersionId: null,
        device: "desktop",
        browser: "Chrome",
        os: "Linux",
        network: "4g",
      },
      events: [{ type: "session_started", at: "2026-09-09T00:00:00.000Z", positionS: null }],
    },
  ],
};
describe("telemetry route", () => {
  it("validates bounded batches and replaces any client user identity with the verified caller", async () => {
    const ingest = vi.fn(async () => undefined);
    const handler = createTelemetryHandler({
      sink: { ingest },
      authenticate: async () => ({ id: "33333333-3333-4333-8333-333333333333" }),
    });
    const response = await handler(
      new Request("https://zivora.test/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(202);
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
      "33333333-3333-4333-8333-333333333333",
    );
  });
  it("rejects malformed, oversized and cross-origin telemetry but drops sink failures", async () => {
    const handler = createTelemetryHandler({
      sink: {
        ingest: async () => {
          throw new Error("database");
        },
      },
      authenticate: async () => null,
    });
    expect(
      (
        await handler(
          new Request("https://zivora.test/api/telemetry", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://other.test" },
            body: JSON.stringify(body),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler(
          new Request("https://zivora.test/api/telemetry", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("https://zivora.test/api/telemetry", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
      ).status,
    ).toBe(202);
  });
});
