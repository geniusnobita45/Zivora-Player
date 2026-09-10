// @vitest-environment node
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseProbeResult, type ProbeResult } from "@/pipeline/media/probe";
import {
  MediaValidator,
  ZivoraMediaDescriptorSchema,
  writeMediaDescriptor,
  type MediaValidationInput,
} from "@/pipeline/validation/MediaValidator";

const fixtureRoot = fileURLToPath(new URL("./fixtures/valid", import.meta.url));
const temporary: string[] = [];

afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

function validProbe(codec = "h264", duration = 8): ProbeResult {
  return parseProbeResult({
    streams: [
      {
        index: 0,
        codec_name: codec,
        codec_type: "video",
        width: 1920,
        height: 1080,
        tags: {},
        disposition: {},
      },
      {
        index: 1,
        codec_name: "aac",
        codec_type: "audio",
        sample_rate: "48000",
        channels: 2,
        tags: { language: "eng" },
        disposition: { default: 1 },
      },
      {
        index: 2,
        codec_name: "webvtt",
        codec_type: "subtitle",
        tags: { language: "eng" },
        disposition: {},
      },
    ],
    format: {
      filename: "master.m3u8",
      format_name: "hls",
      duration: String(duration),
      size: "4096",
      tags: {},
    },
  });
}

function validationInput(root: string): MediaValidationInput {
  return {
    mediaRoot: root,
    masterPlaylist: "master.m3u8",
    probeTarget: "probe-target.mp4",
    thumbnailVtt: "thumbnails/thumbnails.vtt",
    expectedDuration: 8,
  };
}

async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zivora-media-validator-"));
  temporary.push(root);
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

describe("MediaValidator", () => {
  it("runs the complete validation chain in its frozen order", async () => {
    const report = await new MediaValidator({
      probe: async () => validProbe(),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    }).validate(validationInput(fixtureRoot));

    expect(report.valid).toBe(true);
    expect(report.checkedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(report.checks.map((check) => check.name)).toEqual([
      "ffprobe",
      "codec",
      "duration",
      "segment-existence",
      "segment-duration-sum",
      "audio-track",
      "subtitle",
      "thumbnail",
    ]);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("returns structured failures without aborting later checks", async () => {
    const report = await new MediaValidator({ probe: async () => validProbe("hevc") }).validate(
      validationInput(fixtureRoot),
    );

    expect(report.valid).toBe(false);
    expect(report.checks).toHaveLength(8);
    expect(report.checks.find((check) => check.name === "codec")).toMatchObject({
      status: "failed",
      message: "All packaged video streams must use H.264",
      details: {},
    });
    expect(report.checks.find((check) => check.name === "thumbnail")?.status).toBe("passed");
  });

  it("fails segment existence when a referenced asset is absent", async () => {
    const root = await fixtureCopy();
    await rm(join(root, "video/480p/segments/segment-000001.m4s"));
    const report = await new MediaValidator({ probe: async () => validProbe() }).validate(
      validationInput(root),
    );

    expect(report.checks.find((check) => check.name === "segment-existence")).toMatchObject({
      status: "failed",
    });
    expect(report.checks.find((check) => check.name === "segment-duration-sum")).toMatchObject({
      status: "passed",
    });
  });

  it("enforces the one-percent segment duration tolerance", async () => {
    const root = await fixtureCopy();
    const playlistPath = join(root, "video/360p/index.m3u8");
    const playlist = await readFile(playlistPath, "utf8");
    await writeFile(playlistPath, playlist.replace("#EXTINF:4.000,", "#EXTINF:3.500,"), "utf8");
    const report = await new MediaValidator({ probe: async () => validProbe() }).validate(
      validationInput(root),
    );

    expect(report.checks.find((check) => check.name === "segment-existence")?.status).toBe(
      "passed",
    );
    expect(report.checks.find((check) => check.name === "segment-duration-sum")).toMatchObject({
      status: "failed",
    });
  });

  it("writes one immutable descriptor with sorted SHA-256 asset checksums", async () => {
    const root = await fixtureCopy();
    const input = validationInput(root);
    const probe = async () => validProbe();
    const validator = new MediaValidator({
      probe,
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    const report = await validator.validate(input);
    const descriptor = await writeMediaDescriptor(input, report, { probe });
    const stored = ZivoraMediaDescriptorSchema.parse(
      JSON.parse(await readFile(join(root, "zivora-media.json"), "utf8")),
    );

    expect(stored).toEqual(descriptor);
    expect(descriptor.renditions.map((rendition) => rendition.id)).toEqual([
      "1080p",
      "720p",
      "480p",
      "360p",
    ]);
    expect(descriptor.audioTracks).toMatchObject([
      { language: "en", playlist: "audio/01-en/index.m3u8" },
    ]);
    expect(descriptor.subtitleTracks).toMatchObject([
      { language: "en", playlist: "subtitles/01-en/index.m3u8" },
    ]);
    expect(descriptor.assets.map((asset) => asset.path)).toEqual(
      [...descriptor.assets.map((asset) => asset.path)].sort(),
    );
    const master = await readFile(join(root, "master.m3u8"));
    expect(descriptor.assets.find((asset) => asset.path === "master.m3u8")?.sha256).toBe(
      createHash("sha256").update(master).digest("hex"),
    );
    expect(descriptor.assets.some((asset) => asset.path === "zivora-media.json")).toBe(false);
    await expect(writeMediaDescriptor(input, report, { probe })).rejects.toThrow();
  });

  it("rejects validation paths outside the media root at the input boundary", async () => {
    await expect(
      new MediaValidator({ probe: async () => validProbe() }).validate({
        ...validationInput(fixtureRoot),
        masterPlaylist: "../master.m3u8",
      }),
    ).rejects.toThrow("escapes media root");
  });
});
