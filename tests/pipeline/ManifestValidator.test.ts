// @vitest-environment node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ManifestValidator,
  parseAttributeList,
  parseManifest,
  resolveManifestPath,
} from "@/pipeline/validation/ManifestValidator";

const fixtureRoot = fileURLToPath(new URL("./fixtures/valid", import.meta.url));
const masterPath = join(fixtureRoot, "master.m3u8");

describe("ManifestValidator", () => {
  it("parses quoted attributes containing commas", () => {
    expect(parseAttributeList('BANDWIDTH=1000,CODECS="avc1.640028,mp4a.40.2"')).toEqual({
      BANDWIDTH: "1000",
      CODECS: "avc1.640028,mp4a.40.2",
    });
  });

  it("parses the fixture master and every child playlist", async () => {
    const tree = await new ManifestValidator().parseTree(masterPath);

    expect(tree.master.variants).toHaveLength(4);
    expect(tree.master.variants[0]).toMatchObject({
      bandwidth: 5_542_000,
      resolution: { width: 1920, height: 1080 },
      codecs: ["avc1.640028", "mp4a.40.2"],
    });
    expect(tree.children.map((child) => child.kind)).toEqual([
      "video",
      "video",
      "video",
      "video",
      "audio",
      "subtitle",
    ]);
    expect(tree.children.every((child) => child.playlist.endList)).toBe(true);
    expect(
      tree.children
        .filter((child) => child.kind !== "subtitle")
        .every((child) => child.playlist.initSegmentUri === "init.mp4"),
    ).toBe(true);
  });

  it("parses child segment metadata", async () => {
    const playlist = parseManifest(
      await readFile(join(fixtureRoot, "video/720p/index.m3u8"), "utf8"),
    );

    expect(playlist).toMatchObject({
      kind: "media",
      targetDuration: 4,
      playlistType: "VOD",
      initSegmentUri: "init.mp4",
      segments: [
        { duration: 4, uri: "segments/segment-000000.m4s" },
        { duration: 4, uri: "segments/segment-000001.m4s" },
      ],
    });
  });

  it("rejects malformed playlists and missing rendition groups", () => {
    expect(() => parseManifest("not an hls playlist")).toThrow("#EXTM3U");
    expect(() =>
      parseManifest(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,CODECS="avc1.4d401e",AUDIO=missing\nvideo.m3u8\n',
      ),
    ).toThrow("missing audio group");
    expect(() => parseManifest("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n")).toThrow(
      "final segment URI",
    );
    expect(() =>
      parseManifest("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:5,\nsegment.m4s\n#EXT-X-ENDLIST\n"),
    ).toThrow("exceeds EXT-X-TARGETDURATION");
  });

  it("allows only local references contained by the media root", () => {
    const child = join(fixtureRoot, "video/720p/index.m3u8");
    expect(resolveManifestPath(fixtureRoot, child, "segments/segment-000000.m4s")).toBe(
      join(dirname(child), "segments/segment-000000.m4s"),
    );
    expect(() => resolveManifestPath(fixtureRoot, child, "../../../outside.m4s")).toThrow(
      "escapes media root",
    );
    expect(() =>
      resolveManifestPath(fixtureRoot, child, "https://media.example/segment.m4s"),
    ).toThrow("non-local URI");
    expect(() => resolveManifestPath(fixtureRoot, child, "segment.m4s?token=secret")).toThrow(
      "non-local URI",
    );
  });
});
