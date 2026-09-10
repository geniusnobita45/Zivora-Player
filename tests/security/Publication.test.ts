// @vitest-environment node
import { rm, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Publisher,
  loadPublicationPackage,
  samplePlayback,
  validateCloudPackage,
} from "@/pipeline/publish/Publisher";
import {
  R2Uploader,
  readPublicationFile,
  sha256,
  uploadHeaders,
} from "@/pipeline/publish/R2Uploader";
import { VersionManager } from "@/pipeline/publish/VersionManager";
import { parseMp4Boxes, validateFmp4 } from "@/pipeline/publish/Fmp4Validator";
import { parallelMap } from "@/lib/r2/ObjectStore";
import { parsePublishArguments } from "@/pipeline/publish/cli";
import {
  MemoryStore,
  publicationFixture,
  version,
  prefix,
  versionId,
  contentId,
  episodeId,
  initBytes,
  segmentBytes,
  box,
} from "./publicationFixture";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const { root } = await publicationFixture();
  temporary.push(root);
  const store = new MemoryStore();
  const uploader = new R2Uploader(store);
  const repository = {
    register: vi.fn(async () => {}),
    markReady: vi.fn(async () => {}),
    publish: vi.fn(async () => versionId),
    fail: vi.fn(async () => {}),
    rollback: vi.fn(async () => versionId),
  };
  const reserve = vi.fn(async () => version);
  const publisher = new Publisher(new VersionManager({ reserve }), repository, () => uploader);
  return {
    root,
    store,
    uploader,
    repository,
    publisher,
    reserve,
    request: { directory: root, contentId, episodeId },
  };
}

describe("publication", () => {
  it("uploads, verifies remote inventory and samples before register -> READY -> activation", async () => {
    const f = await fixture();
    expect(await f.publisher.publish(f.request)).toEqual(version);
    const payload = f.repository.register.mock.calls[0] as unknown as [
      string,
      {
        checksums: Record<string, string>;
        renditions: unknown[];
        audio_tracks: unknown[];
        thumbnails: unknown[];
      },
    ];
    expect(payload[1].renditions).toHaveLength(4);
    expect(payload[1].audio_tracks).toHaveLength(1);
    expect(payload[1].thumbnails).toHaveLength(1);
    expect(Object.keys(payload[1].checksums)).toHaveLength(f.store.objects.size);
    expect(f.repository.register.mock.invocationCallOrder[0]).toBeLessThan(
      f.repository.markReady.mock.invocationCallOrder[0],
    );
    expect(f.repository.markReady.mock.invocationCallOrder[0]).toBeLessThan(
      f.repository.publish.mock.invocationCallOrder[0],
    );
    for (const key of f.store.objects.keys())
      expect(f.store.operations.filter((op) => op === `head:${key}`)).toHaveLength(2);
    for (const quality of ["1080p", "720p", "480p", "360p"])
      for (const segment of ["000000", "000001"])
        expect(
          f.store.operations.filter(
            (op) => op === `get:${prefix}video/${quality}/segments/segment-${segment}.m4s`,
          ),
        ).toHaveLength(2);
    expect(f.repository.fail).not.toHaveBeenCalled();
  });
  it("never overwrites a used prefix, even for a retry", async () => {
    const f = await fixture();
    await f.publisher.publish(f.request);
    const original = [...f.store.objects.values()].map((o) => sha256(o.bytes));
    await expect(f.publisher.publish(f.request)).rejects.toThrow("prefix already exists");
    expect([...f.store.objects.values()].map((o) => sha256(o.bytes))).toEqual(original);
    expect(f.repository.publish).toHaveBeenCalledOnce();
  });
  it("refuses changed local bytes and leaves the active pointer untouched", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "master.m3u8"), "corrupt");
    await expect(f.publisher.publish(f.request)).rejects.toThrow("size changed");
    expect(f.repository.register).not.toHaveBeenCalled();
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(f.repository.fail).toHaveBeenCalledWith(versionId);
  });
  it("rejects failed local reports before allocating storage", async () => {
    const f = await fixture();
    const descriptor = JSON.parse(await readFile(join(f.root, "zivora-media.json"), "utf8"));
    descriptor.validation.checks[0].status = "failed";
    await writeFile(join(f.root, "zivora-media.json"), JSON.stringify(descriptor));
    await expect(f.publisher.publish(f.request)).rejects.toThrow("Local media validation");
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it("detects remote corruption even if metadata still claims the expected checksum", async () => {
    const f = await fixture();
    const originalGet = f.store.get.bind(f.store);
    vi.spyOn(f.store, "get").mockImplementation(async (key, max) => {
      const bytes = await originalGet(key, max);
      bytes[0] ^= 1;
      return bytes;
    });
    await expect(f.publisher.publish(f.request)).rejects.toThrow("checksum verification");
    expect(f.repository.register).not.toHaveBeenCalled();
  });
  it("re-parses remote playlists and refuses changed durations or absent assets", async () => {
    const f = await fixture();
    const { descriptor, assets } = await loadPublicationPackage(f.root);
    await f.uploader.upload(f.root, prefix, assets);
    const entry = f.store.objects.get(`${prefix}video/360p/index.m3u8`)!;
    entry.bytes = Buffer.from(new TextDecoder().decode(entry.bytes).replaceAll("4.000", "3.000"));
    const asset = assets.find((a) => a.path === "video/360p/index.m3u8")!;
    asset.sha256 = sha256(entry.bytes);
    entry.headers.sha256 = asset.sha256;
    await expect(validateCloudPackage(f.uploader, version, descriptor, assets)).rejects.toThrow(
      "duration mismatch",
    );
    f.store.objects.delete(`${prefix}video/720p/init.mp4`);
    await expect(validateCloudPackage(f.uploader, version, descriptor, assets)).rejects.toThrow(
      "Missing object",
    );
  });
  it("does not register files that pass checksums but fail fMP4 structure", async () => {
    const f = await fixture();
    const { descriptor, assets } = await loadPublicationPackage(f.root);
    await f.uploader.upload(f.root, prefix, assets);
    const cloud = await validateCloudPackage(f.uploader, version, descriptor, assets);
    f.store.objects.get(`${prefix}video/1080p/segments/segment-000001.m4s`)!.bytes =
      Buffer.from("not mp4");
    await expect(samplePlayback(f.uploader, version, cloud)).rejects.toThrow("fMP4");
  });
  it("does not publish when registration fails; rollback delegates to the atomic RPC", async () => {
    const f = await fixture();
    f.repository.register.mockRejectedValueOnce(new Error("database down"));
    await expect(f.publisher.publish(f.request)).rejects.toThrow("database down");
    expect(f.repository.markReady).not.toHaveBeenCalled();
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(await f.publisher.rollback(episodeId)).toBe(versionId);
    expect(f.repository.rollback).toHaveBeenCalledWith(episodeId);
  });
});

describe("publication helpers", () => {
  it("validates reservation ownership and immutable prefixes", async () => {
    await expect(
      new VersionManager({
        reserve: async () => ({ ...version, prefix: prefix.replace("v1", "v2") }),
      }).allocate({ contentId, episodeId }),
    ).rejects.toThrow("inconsistent");
    await expect(
      new VersionManager({ reserve: async () => ({ ...version, episodeId: null }) }).allocate({
        contentId,
        episodeId,
      }),
    ).rejects.toThrow("inconsistent");
  });
  it("rejects symlinks, path traversal and unsupported uploads", async () => {
    const f = await fixture();
    const bytes = await readFile(join(f.root, "master.m3u8"));
    await symlink(join(f.root, "master.m3u8"), join(f.root, "linked.m3u8"));
    await expect(
      readPublicationFile(f.root, {
        path: "linked.m3u8",
        size: bytes.length,
        sha256: sha256(bytes),
      }),
    ).rejects.toThrow("symbolic link");
    await expect(
      readPublicationFile(f.root, { path: "../secret", size: 1, sha256: "a".repeat(64) }),
    ).rejects.toThrow();
    expect(() => uploadHeaders({ path: "script.js", size: 1, sha256: "a".repeat(64) })).toThrow(
      "Unsupported",
    );
  });
  it("uses short manifest caching and immutable segments with appropriate content types", () => {
    const asset = { size: 1, sha256: "a".repeat(64) };
    expect(uploadHeaders({ ...asset, path: "master.m3u8" })).toMatchObject({
      contentType: "application/vnd.apple.mpegurl",
      cacheControl: "public, max-age=60, must-revalidate",
    });
    expect(uploadHeaders({ ...asset, path: "audio/en/segment.m4s" })).toMatchObject({
      contentType: "audio/mp4",
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(uploadHeaders({ ...asset, path: "subtitle.vtt" }).contentType).toBe(
      "text/vtt; charset=utf-8",
    );
  });
  it("bounds concurrency, preserves ordering and drains work after failure", async () => {
    let inFlight = 0;
    let peak = 0;
    const values = await parallelMap([0, 1, 2, 3, 4], 2, async (v) => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return v * 2;
    });
    expect(peak).toBe(2);
    expect(values).toEqual([0, 2, 4, 6, 8]);
    let finished = false;
    await expect(
      parallelMap([0, 1, 2], 2, async (v) => {
        if (v === 0) throw new Error("stop");
        await Promise.resolve();
        finished = true;
      }),
    ).rejects.toThrow("stop");
    expect(finished).toBe(true);
  });
  it("parses bounded fMP4 boxes including extended and zero-length headers", () => {
    expect(() => validateFmp4(initBytes(), "init")).not.toThrow();
    expect(() => validateFmp4(segmentBytes(), "segment")).not.toThrow();
    const extended = Buffer.alloc(16);
    extended.writeUInt32BE(1);
    extended.write("free", 4);
    extended.writeBigUInt64BE(16n, 8);
    expect(parseMp4Boxes(extended)[0].size).toBe(16);
    const zero = box("free", Buffer.from([0]));
    zero.writeUInt32BE(0);
    expect(parseMp4Boxes(zero)[0].size).toBe(9);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(7),
      Buffer.from([0, 0, 0, 5, 102, 114, 101, 101]),
      extended.subarray(0, 10),
    ])
      expect(() => parseMp4Boxes(bytes)).toThrow();
    expect(() => validateFmp4(box("moov", box("trak")), "init")).toThrow();
    expect(() => validateFmp4(box("mdat", Buffer.from([1])), "segment")).toThrow();
  });
  it("parses publish/rollback commands and rejects extra, missing and duplicate flags", () => {
    expect(
      parsePublishArguments(["publish", "--directory", "/tmp/package", "--content-id", contentId]),
    ).toMatchObject({ command: "publish" });
    expect(parsePublishArguments(["rollback", "--id", episodeId])).toEqual({
      command: "rollback",
      "--id": episodeId,
    });
    for (const args of [
      [],
      ["delete"],
      ["rollback", "--id"],
      ["rollback", "--id", episodeId, "--id", episodeId],
      ["rollback", "--id", episodeId, "--extra", "1"],
    ])
      expect(() => parsePublishArguments(args)).toThrow();
  });
});
