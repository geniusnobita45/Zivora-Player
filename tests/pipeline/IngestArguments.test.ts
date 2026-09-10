// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseIngestArguments } from "@/scripts/zivora-ingest";

const content = "11111111-1111-4111-8111-111111111111";
const episode = "22222222-2222-4222-8222-222222222222";

describe("zivora ingest arguments", () => {
  it("parses the documented positional workflow flags", () => {
    expect(
      parseIngestArguments([
        "movie.mp4",
        "--content",
        content,
        "--episode",
        episode,
        "--from",
        "SCENES",
        "--skip-ai",
        "--dry-run",
      ]),
    ).toMatchObject({
      input: "movie.mp4",
      contentId: content,
      episodeId: episode,
      from: "SCENES",
      skipAi: true,
      dryRun: true,
    });
  });

  it("accepts rollback without an input file", () => {
    expect(parseIngestArguments(["--rollback", "--content", content])).toMatchObject({
      rollback: true,
      contentId: content,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseIngestArguments(["movie.mp4", "--content", content, "--wat"])).toThrow(
      "Unknown option",
    );
  });
});
