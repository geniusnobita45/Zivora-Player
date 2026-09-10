// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseWebVtt,
  serializeWebVtt,
  cueIdentifier,
  plainCueText,
} from "@/features/subtitles/vtt";
import {
  correctSubtitleDrift,
  driftModel,
  validateSubtitleTiming,
} from "@/features/subtitles/timing";
import { detectSubtitleLanguage } from "@/features/subtitles/language";
import { enrichSubtitleTrack } from "@/pipeline/media/subtitles";
const vtt =
  "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nThe sun and the sky are with you.\n\n2\n00:00:03.000 --> 00:00:04.000\n<v Alice>Hello &amp; welcome</v>\n";
describe("offline subtitles", () => {
  it("parses BOM, CRLF, settings, voice labels, notes and overlapping cues", () => {
    const cues = parseWebVtt(
      "\uFEFFWEBVTT\r\n\r\nNOTE metadata\r\nignore\r\n\r\na\r\n01:00:01.000 --> 01:00:03.000 align:start\r\n<v Alex>Hi</v>\r\n\r\n01:00:02.000 --> 01:00:04.000\r\nAgain\r\n",
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start: 3601,
      end: 3603,
      speaker: "Alex",
      settings: "align:start",
    });
  });
  it.each([
    "garbage",
    "WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi",
    "WEBVTT\n\n00:60:01.000 --> 00:61:00.000\nHi",
    "WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nHi",
    "WEBVTT\n\nbad timing",
  ])("rejects malformed VTT: %s", (value) => expect(() => parseWebVtt(value)).toThrow());
  it("round trips optional speaker/hint metadata without rendering HTML", () => {
    const cues = parseWebVtt(vtt).map((c) => ({
      ...c,
      speaker: "Alice",
      hint: "An idiom, not a literal instruction.",
    }));
    const output = parseWebVtt(serializeWebVtt(cues));
    expect(output[0]).toMatchObject({ speaker: "Alice", hint: cues[0].hint });
    expect(plainCueText("<b>Hi</b> &lt;script&gt;")).toBe("Hi <script>");
    expect(() => cueIdentifier({ hint: "a".repeat(1001) })).toThrow();
  });
  it("corrects constant offset and linear drift across 24 hours", () => {
    const cue = { ...parseWebVtt(vtt)[0], start: 80000, end: 80002 };
    const anchors = [
      { source: 0, target: 2 },
      { source: 81000, target: 81083 },
    ];
    expect(driftModel(anchors).scale).toBeCloseTo(1.001, 10);
    expect(driftModel(anchors).offset).toBeCloseTo(2, 8);
    expect(correctSubtitleDrift([cue], anchors, 86400)[0]).toMatchObject({
      start: 80082,
      end: 80084.002,
    });
    expect(correctSubtitleDrift(parseWebVtt(vtt), [{ source: 0, target: 1 }], 10)[0].start).toBe(2);
  });
  it("rejects inconsistent anchors, inverted clocks and corrected out-of-bounds cues", () => {
    expect(() =>
      driftModel([
        { source: 1, target: 2 },
        { source: 1, target: 3 },
      ]),
    ).toThrow();
    expect(() =>
      driftModel([
        { source: 0, target: 0 },
        { source: 5, target: 9 },
        { source: 10, target: 10 },
      ]),
    ).toThrow();
    expect(() => correctSubtitleDrift(parseWebVtt(vtt), [{ source: 10, target: 0 }], 10)).toThrow();
    expect(validateSubtitleTiming(parseWebVtt(vtt), 3).valid).toBe(false);
    expect(validateSubtitleTiming(parseWebVtt(vtt).reverse(), 10).valid).toBe(false);
  });
  it("detects supported languages conservatively and preserves ambiguity", () => {
    expect(detectSubtitleLanguage("the sky and the sun are with you").language).toBe("en");
    expect(detectSubtitleLanguage("こんにちはひらがなです").language).toBe("ja");
    expect(detectSubtitleLanguage("OK")).toEqual({ language: "und", confidence: 0 });
  });
  it("writes immutable original/literal/natural tracks with transcript speakers and hints", async () => {
    const root = await mkdtemp(join(tmpdir(), "zivora-subtitles-"));
    try {
      const path = join(root, "source.vtt");
      await writeFile(path, vtt);
      const translate = vi.fn(async () => [
        { text: "Bonjour", hint: "A greeting" },
        { text: "Bienvenue" },
      ]);
      const request = {
        speakers: [{ id: "speaker-1", name: "Alex" }],
        transcript: [{ start: 0, end: 3, speakerId: "speaker-1" }],
        hints: { 0: "A greeting" },
        variants: [
          { language: "fr", kind: "literal" },
          { language: "fr", kind: "natural" },
        ],
      };
      const source = {
        sourceStreamIndex: null,
        language: "und",
        label: "Unknown",
        path,
        format: "webvtt" as const,
        cueCount: 2,
      };
      const tracks = await enrichSubtitleTrack(
        source,
        request,
        join(root, "enriched"),
        10,
        translate,
      );
      expect(tracks.map((t) => t.kind)).toEqual(["original", "literal", "natural"]);
      expect(translate).toHaveBeenCalledTimes(2);
      expect(tracks[0]).toMatchObject({
        language: "en",
        hasSpeakerNames: true,
        hasContextHints: true,
      });
      expect(parseWebVtt(await readFile(tracks[1].path, "utf8"))[0]).toMatchObject({
        text: "Bonjour",
        speaker: "Alex",
        hint: "A greeting",
      });
      await expect(
        enrichSubtitleTrack(source, request, join(root, "enriched"), 10, translate),
      ).rejects.toThrow();
      await expect(
        enrichSubtitleTrack(source, request, join(root, "missing-translator"), 10),
      ).rejects.toThrow("offline");
      await expect(
        enrichSubtitleTrack(source, request, join(root, "bad-translator"), 10, async () => []),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
