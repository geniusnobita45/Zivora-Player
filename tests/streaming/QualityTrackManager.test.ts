// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { QualityManager } from "@/core/streaming/QualityManager";
import { TrackManager } from "@/core/streaming/TrackManager";
const rendition = (id: string) => ({
  id,
  width: 1280,
  height: 720,
  bandwidth: 1000000,
  codecs: "avc1",
  active: false,
});
const audio = (id: string, language: string, active = false) => ({
  id,
  language,
  label: language,
  roles: [],
  active,
});
const text = (id: string, language: string) => ({
  id,
  language,
  label: language,
  kind: "subtitles",
  active: false,
});
describe("quality manager", () => {
  it("tracks manual/auto choices and keeps a bounded deduplicated change log", () => {
    let now = 10;
    const manager = new QualityManager(() => now, 2);
    manager.setRenditions([rendition("a"), rendition("b")]);
    manager.recordChange({ quality: rendition("a"), automatic: true });
    now++;
    manager.recordChange({ quality: rendition("b"), automatic: false });
    manager.recordChange({ quality: rendition("b"), automatic: false });
    expect(manager.getSnapshot().changes).toHaveLength(2);
    now++;
    manager.recordChange({ quality: rendition("b"), automatic: true });
    expect(manager.getSnapshot()).toMatchObject({
      automatic: true,
      selectedId: "b",
      changes: [
        { at: 11, automatic: false },
        { at: 12, automatic: true },
      ],
    });
    manager.getSnapshot().renditions[0].id = "changed";
    expect(manager.resolve("a")?.id).toBe("a");
    manager.setRenditions([rendition("a")]);
    expect(manager.getSnapshot()).toMatchObject({ automatic: true, selectedId: null });
    manager.reset();
    expect(manager.getSnapshot().changes).toHaveLength(0);
  });
  it("rejects duplicate IDs and malformed renditions atomically", () => {
    const manager = new QualityManager();
    manager.setRenditions([rendition("a")]);
    expect(() => manager.setRenditions([rendition("b"), rendition("b")])).toThrow();
    expect(() => manager.setRenditions([{ ...rendition("b"), bandwidth: NaN }])).toThrow();
    expect(manager.resolve("a")).not.toBeNull();
  });
});
describe("track preferences", () => {
  it("resolves exact languages first, then a deterministic base-language fallback", () => {
    const manager = new TrackManager(null);
    manager.setTracks(
      [audio("us", "en-US"), audio("gb", "en-GB", true), audio("fr", "fr")],
      [text("en", "en")],
    );
    expect(manager.resolveAudio("EN-us")?.id).toBe("us");
    expect(manager.resolveAudio("en-AU")?.id).toBe("gb");
    expect(manager.resolveAudio("ja")).toBeNull();
    expect(manager.resolveSubtitle("en-US")?.id).toBe("en");
  });
  it("persists language preferences and explicit subtitle-off across instances", () => {
    const storage = new Map<string, string>();
    const port = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const manager = new TrackManager(port);
    manager.preferAudio("fr");
    manager.preferSubtitle("en");
    expect(new TrackManager(port).getSnapshot().preferences).toMatchObject({
      audioLang: "fr",
      subtitleLang: "en",
    });
    manager.preferSubtitle(null);
    expect(new TrackManager(port).getSnapshot().preferences.subtitleLang).toBeNull();
  });
  it("ignores corrupt storage and keeps preferences usable when reads/writes fail", () => {
    for (const stored of ["bad JSON", JSON.stringify({ version: 2, audioLang: "en" })]) {
      const manager = new TrackManager({ getItem: () => stored, setItem: vi.fn() });
      expect(manager.getSnapshot().preferences.audioLang).toBeNull();
    }
    const manager = new TrackManager({
      getItem: () => {
        throw new Error("Storage disabled");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    });
    expect(() => manager.preferAudio("en")).not.toThrow();
    expect(manager.getSnapshot().preferences.audioLang).toBe("en");
  });
  it("does not expose mutable internal tracks or replace them on validation failure", () => {
    const manager = new TrackManager(null);
    manager.setTracks([audio("en", "en")], []);
    manager.getSnapshot().audio[0].id = "mutated";
    expect(manager.resolveAudio("en")?.id).toBe("en");
    expect(() => manager.setTracks([audio("dup", "en"), audio("dup", "en")], [])).toThrow();
    expect(manager.resolveAudio("en")?.id).toBe("en");
  });
});
