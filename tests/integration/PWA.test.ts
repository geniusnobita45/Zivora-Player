// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PWA cache boundary", () => {
  it("caches only the shell and excludes every media transport", async () => {
    const worker = await readFile("public/sw.js", "utf8");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/watch/")');
    expect(worker).toContain('["video", "audio", "track"]');
    for (const extension of ["m3u8", "mpd", "m4s", "mp4", "webm", "aac", "m4a", "vtt"])
      expect(worker).toContain(extension);
    expect(worker).not.toMatch(/cache\.addAll\([^)]*media/i);
  });
});
