// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAudioExtractionCommand,
  extractAudioTracks,
  normalizeLanguageTag,
} from "@/pipeline/media/audio";
import {
  ABR_LADDER,
  buildLosslessMergeCommand,
  buildVideoEncodeCommand,
  encodeAbrLadder,
  losslessMerge,
} from "@/pipeline/media/encode";
import {
  buildFmp4PackageCommand,
  createMasterPlaylist,
  createSubtitlePlaylist,
  packageHlsCmaf,
} from "@/pipeline/media/package";
import { parseProbeResult, probeMedia, type ProbeStream } from "@/pipeline/media/probe";
import type { CommandSpec, ProcessRunner } from "@/pipeline/media/processRunner";
import {
  buildSubtitleConversionCommand,
  convertSubtitleFile,
  formatWebVttTimestamp,
  normalizeWebVtt,
  parseWebVtt,
} from "@/pipeline/media/subtitles";
import {
  buildThumbnailCommands,
  createThumbnailWebVtt,
  generateThumbnails,
} from "@/pipeline/media/thumbnails";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

const probeJson = {
  streams: [
    {
      index: 0,
      codec_name: "h264",
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
  ],
  format: {
    filename: "input.mp4",
    format_name: "mov,mp4",
    duration: "8.000",
    size: "1000",
    tags: {},
  },
};

describe("FFprobe boundary", () => {
  it("normalizes FFprobe numeric strings into a typed result", () => {
    const result = parseProbeResult(probeJson);
    expect(result).toMatchObject({
      format: { duration: 8, size: 1000 },
      streams: [{ width: 1920 }, { sample_rate: 48000 }],
    });
  });
  it("rejects missing streams, invalid duration, and non-JSON output", async () => {
    expect(() => parseProbeResult({ streams: [], format: probeJson.format })).toThrow();
    expect(() =>
      parseProbeResult({ ...probeJson, format: { ...probeJson.format, duration: "NaN" } }),
    ).toThrow();
    const runner: ProcessRunner = {
      run: vi.fn(async () => ({ stdout: "not-json", stderr: "", exitCode: 0 })),
    };
    await expect(probeMedia("input.mp4", runner)).rejects.toThrow("invalid JSON");
  });
  it("invokes FFprobe without a shell and parses stdout", async () => {
    const run = vi.fn(async () => ({ stdout: JSON.stringify(probeJson), stderr: "", exitCode: 0 }));
    await probeMedia("movie name.mp4", { run }, "/tools/ffprobe");
    expect(run).toHaveBeenCalledWith({
      command: "/tools/ffprobe",
      args: ["-v", "error", "-show_streams", "-show_format", "-of", "json", "movie name.mp4"],
    });
  });
});

describe("encoding commands", () => {
  it("defines the frozen H.264 ladder and aligned two-second keyframes", () => {
    expect(ABR_LADDER.map(({ id, width, height }) => ({ id, width, height }))).toEqual([
      { id: "1080p", width: 1920, height: 1080 },
      { id: "720p", width: 1280, height: 720 },
      { id: "480p", width: 854, height: 480 },
      { id: "360p", width: 640, height: 360 },
    ]);
    for (const rendition of ABR_LADDER) {
      const command = buildVideoEncodeCommand("input.mp4", `${rendition.id}.mp4`, rendition);
      expect(command.command).toBe("ffmpeg");
      expect(command.args).toEqual(
        expect.arrayContaining([
          "-c:v",
          "libx264",
          "-force_key_frames",
          "expr:gte(t,n_forced*2)",
          "-sc_threshold",
          "0",
          "-an",
        ]),
      );
      expect(command.args.join(" ")).toContain(`scale=${rendition.width}:${rendition.height}`);
    }
  });
  it("executes all four rendition commands in ladder order", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-encode-test-"));
    temporary.push(root);
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const outputs = await encodeAbrLadder("input.mp4", join(root, "video"), { run });

    expect(run).toHaveBeenCalledTimes(4);
    expect(outputs.map((output) => output.id)).toEqual(["1080p", "720p", "480p", "360p"]);
    expect(
      outputs.every((output) => output.codec === "h264" && output.keyframeIntervalSeconds === 2),
    ).toBe(true);
  });
  it("builds concat-demuxer stream-copy merging and safely quotes list paths", async () => {
    expect(buildLosslessMergeCommand("list.txt", "merged.mp4").args).toEqual(
      expect.arrayContaining(["-f", "concat", "-safe", "0", "-c", "copy"]),
    );
    const root = await mkdtemp(join(tmpdir(), "zivora-merge-test-"));
    temporary.push(root);
    let list = "";
    const runner: ProcessRunner = {
      run: vi.fn(async (spec: CommandSpec) => {
        list = await readFile(spec.args[spec.args.indexOf("-i") + 1], "utf8");
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    await losslessMerge(
      [join(root, "first clip.mp4"), join(root, "director's-cut.mp4")],
      join(root, "merged.mp4"),
      runner,
    );
    expect(list).toContain("file '");
    expect(list).toContain("director'\\''s-cut.mp4");
  });
});

describe("audio and subtitle commands", () => {
  it("normalizes language tags and tags each AAC extraction", () => {
    expect(normalizeLanguageTag("ENG", "und-x-audio-1")).toBe("en");
    expect(normalizeLanguageTag("pt_BR", "und-x-audio-1")).toBe("pt-br");
    expect(normalizeLanguageTag("???", "und-x-audio-2")).toBe("und-x-audio-2");
    const stream = parseProbeResult(probeJson).streams[1] as ProbeStream;
    const command = buildAudioExtractionCommand("input.mkv", "en.m4a", stream, "en");
    expect(command.args).toEqual(
      expect.arrayContaining([
        "-map",
        "0:1",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-metadata:s:a:0",
        "language=en",
      ]),
    );
  });
  it("extracts and describes every audio stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-audio-test-"));
    temporary.push(root);
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const tracks = await extractAudioTracks(
      "input.mkv",
      join(root, "audio"),
      parseProbeResult(probeJson),
      { run },
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(tracks).toMatchObject([
      { sourceStreamIndex: 1, language: "en", channels: 2, codec: "aac", bitrate: 192000 },
    ]);
  });
  it("builds SRT/ASS/WebVTT conversion and rejects unsupported external formats", () => {
    for (const extension of ["srt", "ass", "vtt"])
      expect(buildSubtitleConversionCommand(`input.${extension}`, "output.vtt").args).toContain(
        "webvtt",
      );
    expect(() => buildSubtitleConversionCommand("input.txt", "output.vtt")).toThrow("Unsupported");
    expect(buildSubtitleConversionCommand("input.mkv", "output.vtt", "ffmpeg", 5).args).toEqual(
      expect.arrayContaining(["-map", "0:5"]),
    );
  });
  it("normalizes SRT timing, sorts cues, clips duration, and rejects bad timing", () => {
    const source = `2\n00:00:05,000 --> 00:00:09,000\nSecond\n\n1\n00:01,250 --> 00:03,500\nFirst`;
    const normalized = normalizeWebVtt(source, 8);
    expect(normalized.text).toContain("00:00:01.250 --> 00:00:03.500");
    expect(normalized.text).toContain("00:00:05.000 --> 00:00:08.000");
    expect(parseWebVtt(normalized.text).map((cue) => cue.text)).toEqual(["First", "Second"]);
    expect(formatWebVttTimestamp(3661.002)).toBe("01:01:01.002");
    expect(() => parseWebVtt("WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nBad")).toThrow();
  });
  it("normalizes the FFmpeg subtitle output before publishing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-subtitle-test-"));
    temporary.push(root);
    const outputPath = join(root, "nested", "en.vtt");
    const run = vi.fn(async (spec: CommandSpec) => {
      await writeFile(
        spec.args.at(-1)!,
        "WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nHello\n",
        "utf8",
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const track = await convertSubtitleFile("input.srt", outputPath, 8, { run }, "ffmpeg", "eng");

    expect(track).toMatchObject({ language: "en", format: "webvtt", cueCount: 1 });
    expect(await readFile(outputPath, "utf8")).toContain("00:00:01.000 --> 00:00:08.000");
  });
});

describe("HLS/CMAF and thumbnail generation", () => {
  it("builds four-second fMP4 playlists with relative segment URIs", () => {
    const command = buildFmp4PackageCommand(
      "/work/720p.mp4",
      "/media/video/720p/index.m3u8",
      "/media/video/720p/segments/segment-%06d.m4s",
      "init.mp4",
      "video",
    );
    expect(command.cwd).toBe("/media/video/720p");
    expect(command.args).toEqual(
      expect.arrayContaining([
        "-c",
        "copy",
        "-hls_time",
        "4",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_segment_filename",
        "segments/segment-%06d.m4s",
        "index.m3u8",
      ]),
    );
  });
  it("writes master entries for renditions, per-language audio, and WebVTT subtitles", () => {
    const renditions = ABR_LADDER.map((rendition) => ({
      ...rendition,
      path: `${rendition.id}.mp4`,
      codec: "h264" as const,
      keyframeIntervalSeconds: 2 as const,
    }));
    const master = createMasterPlaylist(
      renditions,
      [{ id: "01-en", language: "en", label: "English", playlistUri: "audio/01-en/index.m3u8" }],
      [
        {
          id: "01-en",
          language: "en",
          label: "English",
          playlistUri: "subtitles/01-en/index.m3u8",
        },
      ],
    );
    expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(4);
    expect(master).toContain('TYPE=AUDIO,GROUP-ID="audio"');
    expect(master).toContain('TYPE=SUBTITLES,GROUP-ID="subtitles"');
    expect(createSubtitlePlaylist(8)).toContain("#EXTINF:8.000,\nsubtitles.vtt");
  });
  it("packages every rendition and language track without running a real encoder", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-package-test-"));
    temporary.push(root);
    const subtitleSource = join(root, "source-en.vtt");
    await writeFile(subtitleSource, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n", "utf8");
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const renditions = ABR_LADDER.map((rendition) => ({
      ...rendition,
      path: join(root, `${rendition.id}.mp4`),
      codec: "h264" as const,
      keyframeIntervalSeconds: 2 as const,
    }));
    const result = await packageHlsCmaf(
      root,
      {
        renditions,
        audioTracks: [
          {
            sourceStreamIndex: 1,
            language: "en",
            label: "English",
            channels: 2,
            path: join(root, "en.m4a"),
            codec: "aac",
            bitrate: 192000,
          },
        ],
        subtitleTracks: [
          {
            sourceStreamIndex: null,
            language: "en",
            label: "English",
            path: subtitleSource,
            format: "webvtt",
            cueCount: 1,
          },
        ],
      },
      8,
      { run },
    );

    expect(run).toHaveBeenCalledTimes(5);
    expect(result.playlists).toHaveLength(6);
    expect(await readFile(result.masterPlaylist, "utf8")).toContain("video/1080p/index.m3u8");
    expect(await readFile(join(root, "subtitles/01-en/index.m3u8"), "utf8")).toContain(
      "#EXT-X-PLAYLIST-TYPE:VOD",
    );
    expect(await readFile(join(root, "subtitles/01-en/subtitles.vtt"), "utf8")).toContain("Hello");
  });
  it("creates JPEG commands, 10x10 sprites, and five-second thumbnail cues", () => {
    const commands = buildThumbnailCommands("input.mp4", "/out/thumbnails");
    expect(commands[0].args.at(-1)).toContain("thumb-%06d.jpg");
    expect(commands[1].args.join(" ")).toContain("tile=10x10");
    const vtt = createThumbnailWebVtt(503);
    const cues = parseWebVtt(vtt);
    expect(cues).toHaveLength(101);
    expect(cues[0].text).toContain("#xywh=0,0,320,180");
    expect(cues[99].text).toContain("#xywh=2880,1620,320,180");
    expect(cues[100].text).toContain("sprite-0002.jpg#xywh=0,0,320,180");
    expect(cues.at(-1)?.end).toBe(503);
  });
  it("runs frame and sprite extraction and writes thumbnail metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-thumbnail-test-"));
    temporary.push(root);
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const output = await generateThumbnails("input.mp4", root, 8, { run });

    expect(run).toHaveBeenCalledTimes(2);
    expect(output).toMatchObject({ intervalSeconds: 5, frameCount: 2, spriteCount: 1 });
    expect(parseWebVtt(await readFile(output.vttPath, "utf8"))).toHaveLength(2);
  });
});
