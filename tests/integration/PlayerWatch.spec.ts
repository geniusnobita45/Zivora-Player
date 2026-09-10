import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import {
  mergeProgress,
  ProgressRecordSchema,
  type ProgressRecord,
  BookmarkSchema,
  type Bookmark,
} from "@/types/progress";

const contentId = "11111111-1111-4111-8111-111111111111";
const episodeId = "22222222-2222-4222-8222-222222222222";
const nextId = "55555555-5555-4555-8555-555555555555";
const mediaVersionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const mediaOrigin = "https://media.zivora.test";
const item = {
  contentId,
  episodeId,
  title: "The Quiet Horizon",
  description: "Season 1 · A new beginning",
};
const next = { ...item, episodeId: nextId, description: "Season 1 · Beyond the horizon" };
const root = resolve("tests/integration/fixtures/player");
const timeline = {
  chapters: [
    { id: "arrival", title: "Arrival", start: 0, end: 16 },
    { id: "beyond", title: "Beyond", start: 16, end: 32 },
  ],
  scenes: [
    { id: "light", title: "First light", start: 0, end: 16 },
    { id: "crossing", title: "Crossing", start: 16, end: 32 },
  ],
  bookmarks: [{ id: "saved", title: "Saved moment", start: 14 }],
  skipSegments: [{ id: "intro", title: "Opening", kind: "intro", start: 0, end: 3 }],
  thumbnails: [
    {
      start: 0,
      end: 16,
      url: `${mediaOrigin}/media/fixture/preview.svg`,
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    },
    {
      start: 16,
      end: 32,
      url: `${mediaOrigin}/media/fixture/preview.svg`,
      x: 320,
      y: 0,
      width: 320,
      height: 180,
    },
  ],
};

async function fixture(page: Page, failFirst = false) {
  let activeMediaVersionId = mediaVersionId;
  const sync = {
    offline: false,
    progress: new Map<string, ProgressRecord>(),
    bookmarks: new Map<string, Bookmark>(),
    writes: 0,
  };
  await page.route(/\/api\/progress(?:\?|$)/, async (route) => {
    if (sync.offline) {
      await route.fulfill({ status: 503, json: { error: "Offline fixture" } });
      return;
    }
    const request = route.request();
    if (request.method() === "POST") {
      const value = ProgressRecordSchema.parse(request.postDataJSON());
      const key = `${value.contentId}:${value.episodeId}`;
      const merged = mergeProgress(sync.progress.get(key) ?? null, value);
      sync.progress.set(key, merged);
      sync.writes++;
      await route.fulfill({ json: { progress: merged } });
    } else {
      const params = new URL(request.url()).searchParams;
      await route.fulfill({
        json: {
          progress:
            sync.progress.get(`${params.get("contentId")}:${params.get("episodeId")}`) ?? null,
        },
      });
    }
  });
  await page.route(/\/api\/bookmarks(?:\?|$)/, async (route) => {
    if (sync.offline) {
      await route.fulfill({ status: 503, json: { error: "Offline fixture" } });
      return;
    }
    if (route.request().method() === "POST") {
      const value = BookmarkSchema.parse(route.request().postDataJSON());
      const old = sync.bookmarks.get(value.id);
      const saved = old && old.updatedAt > value.updatedAt ? old : value;
      sync.bookmarks.set(value.id, saved);
      await route.fulfill({ json: { bookmark: saved } });
    } else {
      const params = new URL(route.request().url()).searchParams;
      await route.fulfill({
        json: {
          bookmarks: [...sync.bookmarks.values()].filter(
            (v) =>
              v.contentId === params.get("contentId") && v.episodeId === params.get("episodeId"),
          ),
        },
      });
    }
  });
  const errors: string[] = [];
  const mediaRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let rejected = false;
  await page.route("**/api/playback", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "catalog") {
      await route.fulfill({
        json:
          body.episodeId === nextId
            ? { current: next, next: null, timeline, userId }
            : { current: item, next, timeline, userId },
      });
      return;
    }
    if (failFirst && !rejected) {
      rejected = true;
      await route.fulfill({ status: 503, json: { error: "Service unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        contentId,
        episodeId: body.episodeId,
        mediaVersionId: activeMediaVersionId,
        access: "public",
        token: null,
        expiresAt: null,
        manifestUrl: `${mediaOrigin}/media/fixture/master.m3u8`,
        objectBaseUrl: `${mediaOrigin}/media/fixture/`,
      },
    });
  });
  await page.route(`${mediaOrigin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/media/fixture/", "");
    if (!/^(?:[a-z0-9-]+\/)*[a-z0-9.-]+$/i.test(path)) {
      await route.abort();
      return;
    }
    mediaRequests.push(path);
    const contentType = (
      {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".mp4": "video/mp4",
        ".m4s": "video/iso.segment",
        ".vtt": "text/vtt",
        ".svg": "image/svg+xml",
      } as Record<string, string>
    )[extname(path)];
    await route.fulfill({
      body: await readFile(resolve(root, path)),
      contentType,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  return {
    errors,
    mediaRequests,
    sync,
    setActiveMediaVersion(value: string) {
      activeMediaVersionId = value;
    },
  };
}
async function start(page: Page) {
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("slider", { name: "Seek" })).toBeEnabled({ timeout: 30000 });
  // Wait for autoplay to settle before clicking the toggle; otherwise a late
  // autoplay success can turn a pending Play click into an unintended pause.
  await expect
    .poll(async () => {
      if (!(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused)))
        return "playing";
      return (await page.getByText("Press Play to start the video.", { exact: true }).isVisible())
        ? "blocked"
        : "starting";
    })
    .not.toBe("starting");
  if (await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused)) {
    await page.getByRole("button", { name: "Play", exact: true }).click();
  }
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
}
async function seek(page: Page, seconds: number) {
  const slider = page.getByRole("slider", { name: "Seek" });
  const box = (await slider.boundingBox())!;
  const duration = Number(await slider.getAttribute("max"));
  await slider.click({
    position: { x: 7 + ((box.width - 14) * seconds) / duration, y: box.height / 2 },
  });
}
test("offline progress and bookmarks survive reload and replay after online recovery", async ({
  page,
}, info) => {
  const f = await fixture(page);
  f.sync.offline = true;
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await seek(page, 12);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const checkpointKey = `zivora:progress:user:${userId}:${contentId}:${episodeId}`;
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.furthestPosition ?? 0,
        checkpointKey,
      ),
    )
    .toBeGreaterThan(10);
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  await page.getByLabel("Bookmark name").fill("Night sky");
  await page.getByRole("button", { name: "Bookmark this moment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Jump to Night sky" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("offline-bookmarks.png") });
  await page.reload();
  await page.getByRole("button", { name: /^Resume at / }).click();
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(10);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Jump to Night sky" })).toBeVisible();
  f.sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => f.sync.writes).toBeGreaterThan(0);
  await expect.poll(() => [...f.sync.bookmarks.values()].filter((b) => !b.deleted).length).toBe(1);
  await page.getByRole("button", { name: "Remove Night sky" }).click();
  await expect(page.getByRole("button", { name: "Jump to Night sky" })).toHaveCount(0);
  await expect.poll(() => [...f.sync.bookmarks.values()].every((b) => b.deleted)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("phone bookmarks support keyboard add, jump and remove with reduced motion", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await seek(page, 12);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  const name = page.getByLabel("Bookmark name");
  await name.fill("A long saved moment beneath the night sky");
  await name.press("Tab");
  await page.keyboard.press("Enter");
  const jump = page.getByRole("button", {
    name: "Jump to A long saved moment beneath the night sky",
  });
  await expect(jump).toBeVisible();
  await jump.press("Enter");
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(10);
  await page.screenshot({ path: info.outputPath("phone-bookmarks.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await jump.press("Tab");
  await page.keyboard.press("Enter");
  await expect(jump).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("desktop: real HLS, controls, captions, fullscreen, auto-hide and next episode", async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Quality", exact: true }).locator("option"),
  ).toHaveCount(3);
  await page.getByRole("combobox", { name: "Speed", exact: true }).selectOption("1.5");
  await page.getByRole("combobox", { name: "Subtitles", exact: true }).selectOption("en");
  await page.getByRole("combobox", { name: "Caption size", exact: true }).selectOption("large");
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.playbackRate))
    .toBe(1.5);
  await expect(page.getByRole("combobox", { name: "Audio", exact: true })).toHaveValue("en");
  await page.screenshot({ path: info.outputPath("desktop-settings.png") });
  await page.getByRole("combobox", { name: "Speed", exact: true }).press("Escape");
  await expect(page.getByRole("button", { name: "Player settings", exact: true })).toBeFocused();
  await expect(page.locator(".zivora-custom-subtitles")).toBeVisible();
  await expect(page.locator(".zivora-custom-subtitles")).toContainText(
    "Zivora playback verification",
  );
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) =>
          Array.from(video.textTracks).some((track) => track.mode === "showing"),
        ),
    )
    .toBe(false);
  await page.screenshot({ path: info.outputPath("desktop-captions.png") });
  await seek(page, 12);
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(11.9);
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .locator("video")
    .evaluate((video) => (video.ownerDocument.activeElement as HTMLElement)?.blur());
  await page.mouse.move(1, 1);
  await expect(page.locator(".zivora-chrome")).toHaveAttribute("data-visible", "false", {
    timeout: 6000,
  });
  await page.mouse.move(300, 200);
  await page.getByRole("button", { name: "Next episode", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`episode=${nextId}`));
  await expect(page.getByText(next.description, { exact: true })).toBeVisible();
  expect(f.mediaRequests.some((path) => path.endsWith(".m4s"))).toBe(true);
  expect(f.errors).toEqual([]);
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
]) {
  test(`responsive ${viewport.width}x${viewport.height}: resume, keyboard focus and layout`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const f = await fixture(page);
    await page.addInitScript(
      ({ contentId, episodeId, userId }) => {
        const key = `${contentId}:${episodeId}`;
        localStorage.setItem(
          `zivora:progress:user:${userId}:${key}`,
          JSON.stringify({
            contentId: key,
            position: 8,
            duration: 32,
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      { contentId, episodeId, userId },
    );
    await page.goto(`/watch/${contentId}`);
    const resume = page.getByRole("button", { name: "Resume at 0:08", exact: true });
    await expect(resume).toBeFocused({ timeout: 60000 });
    await resume.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Start from beginning" })).toBeFocused();
    await page.screenshot({ path: info.outputPath("resume.png") });
    await resume.click();
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThanOrEqual(8);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Player settings", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Speed", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const controls = await page.locator(".zivora-controls").boundingBox();
    expect(controls!.x).toBeGreaterThanOrEqual(0);
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(viewport.width);
    const settings = (await page
      .getByRole("group", { name: "Player settings", exact: true })
      .boundingBox())!;
    expect(settings.x).toBeGreaterThanOrEqual(0);
    expect(settings.x + settings.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator("body").evaluate((body) => getComputedStyle(body).margin)).toBe(
      "0px",
    );
    await page.screenshot({ path: info.outputPath("responsive-settings.png") });
    expect(f.errors).toEqual([]);
  });
}
test("authorization failure offers retry and preserves the watch route", async ({ page }, info) => {
  const f = await fixture(page, true);
  await page.goto(`/watch/${contentId}`);
  const retry = page.getByRole("button", { name: "Retry playback" });
  await expect(retry).toBeFocused({ timeout: 60000 });
  await page.screenshot({ path: info.outputPath("error.png") });
  await retry.click();
  await start(page);
  expect(f.errors).toEqual([]);
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("tap, double-tap, temporary 2x and swipe volume operate the real video", async ({
    page,
    context,
  }) => {
    const f = await fixture(page);
    await page.goto(`/watch/${contentId}`);
    await start(page);
    const surface = page.getByTestId("gesture-surface");
    await surface.tap({ position: { x: 195, y: 250 } });
    await expect(page.locator(".zivora-chrome")).toHaveAttribute("data-visible", "false");
    await surface.tap({ position: { x: 195, y: 250 } });
    await expect(page.locator(".zivora-chrome")).toHaveAttribute("data-visible", "true");
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 300, y = 250) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
      });
    await touch("touchStart");
    await touch("touchEnd");
    await touch("touchStart");
    await touch("touchEnd");
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThanOrEqual(10);
    await touch("touchStart", 100, 250);
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.playbackRate))
      .toBe(2);
    await touch("touchEnd");
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.playbackRate))
      .toBe(1);
    await touch("touchStart", 100, 300);
    await touch("touchMove", 100, 550);
    await touch("touchEnd");
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.volume))
      .toBeLessThan(0.9);
    await cdp.detach();
    expect(f.errors).toEqual([]);
  });
});

test("ended media offers a cancellable next-episode countdown", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await seek(page, 31.5);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Cancel countdown" }).click();
  await expect(page.getByText("Autoplay cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play next episode", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`episode=${nextId}`));
  expect(f.errors).toEqual([]);
});

test("precision timeline zooms at the pointer and commits only on release", async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Seek" });
  const box = (await slider.boundingBox())!;
  const initial = await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".zivora-precision-timeline")).toHaveAttribute("data-zoom", "HOUR");
  await expect(page.locator(".zivora-timeline-preview [role=img]")).toBeVisible();
  await expect(page.locator(".zivora-scene-labels")).toContainText("First light");
  await page.mouse.down();
  await expect(page.locator(".zivora-precision-timeline")).toHaveAttribute("data-zoom", "MINUTES");
  expect(
    await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime),
  ).toBeCloseTo(initial, 1);
  await page.screenshot({ path: info.outputPath("precision-timeline.png") });
  await page.mouse.up();
  await expect(page.locator(".zivora-precision-timeline")).toHaveAttribute("data-zoom", "GLOBAL");
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(10);
  await slider.press("+");
  await slider.press("Escape");
  await expect(page.locator(".zivora-precision-timeline")).toHaveAttribute("data-zoom", "GLOBAL");
  expect(f.errors).toEqual([]);
});

test("timeline supports keyboard seeking at GLOBAL, HOUR, MINUTES, and SECONDS", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Seek" });
  const timelineElement = page.locator(".zivora-precision-timeline");
  await expect(timelineElement).toHaveAttribute("data-zoom", "GLOBAL");
  await slider.press("ArrowRight");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const level of ["HOUR", "MINUTES", "SECONDS"] as const) {
    await page.mouse.wheel(0, -100);
    await expect(timelineElement).toHaveAttribute("data-zoom", level);
    await slider.press("ArrowRight");
  }
  await slider.press("Escape");
  await expect(timelineElement).toHaveAttribute("data-zoom", "GLOBAL");
  expect(f.errors).toEqual([]);
});

test("AI, Supabase sync, and telemetry outages do not interrupt active playback", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route("**/api/ai/**", (route) =>
    route.fulfill({ status: 503, json: { error: "AI down" } }),
  );
  await page.route("**/api/telemetry", (route) => route.abort("failed"));
  await page.goto(`/watch/${contentId}`);
  await start(page);
  f.sync.offline = true;
  const before = await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(before + 0.2);
  expect(f.errors).toEqual([]);
});

test("media rollback leaves the current immutable version playing and affects only the next load", async ({
  page,
}) => {
  const previousVersionId = "77777777-7777-4777-8777-777777777777";
  const grants: string[] = [];
  const f = await fixture(page);
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/playback") && response.request().method() === "POST") {
      const body = await response.json().catch(() => null);
      if (body?.mediaVersionId) grants.push(body.mediaVersionId);
    }
  });
  await page.goto(`/watch/${contentId}`);
  await start(page);
  const before = await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  f.setActiveMediaVersion(previousVersionId);
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(before + 0.2);
  expect(grants.at(-1)).toBe(mediaVersionId);
  await page.reload();
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible({ timeout: 60000 });
  await expect.poll(() => grants.at(-1)).toBe(previousVersionId);
  expect(f.errors).toEqual([]);
});

test("custom subtitles select offline variants and restore user preferences", async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Subtitles", exact: true }).selectOption("fr");
  await expect(page.getByRole("combobox", { name: "Translation style" })).toHaveValue("literal");
  await page.getByRole("combobox", { name: "Translation style" }).selectOption("natural");
  await page.getByRole("checkbox", { name: "Speaker names" }).check();
  await page.getByRole("checkbox", { name: "Context hints" }).check();
  await page.getByRole("combobox", { name: "Caption position" }).selectOption("top");
  await page.getByRole("combobox", { name: "Caption size" }).selectOption("large");
  await page.getByRole("button", { name: "Close settings" }).click();
  const captions = page.locator(".zivora-custom-subtitles");
  await expect(captions).toContainText("Voici les sous-titres");
  await expect(captions).toContainText("Narrator:");
  await expect(captions).toContainText("Synthetic subtitle fixture");
  await expect(captions).toHaveAttribute("data-position", "top");
  await page.screenshot({ path: info.outputPath("custom-subtitles.png") });
  const stored = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`zivora:subtitle-preferences:v1:${id}`)!),
    userId,
  );
  expect(stored).toMatchObject({
    language: "fr",
    kind: "natural",
    speakerNames: true,
    contextHints: true,
    size: "large",
    position: "top",
  });
  await page.reload();
  await start(page);
  await expect(captions).toContainText("Voici les sous-titres");
  await expect(captions).toHaveAttribute("data-position", "top");
  expect(f.errors).toEqual([]);
});

test("native caption fallback preserves playback after a renderer input failure", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route(`${mediaOrigin}/media/fixture/captions.vtt`, (route) =>
    route.fulfill({
      contentType: "text/vtt",
      headers: { "access-control-allow-origin": "*" },
      body: "WEBVTT\n\nzivora:invalid-metadata\n00:00:00.000 --> 00:00:32.000\nNative fallback caption\n",
    }),
  );
  await page.goto(`/watch/${contentId}`);
  await start(page);
  await page.getByRole("button", { name: "Player settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Subtitles", exact: true }).selectOption("en");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) =>
          Array.from(video.textTracks).some(
            (track) =>
              track.mode === "showing" &&
              Array.from(track.activeCues ?? []).some((cue) =>
                (cue as VTTCue).text.includes("Native fallback"),
              ),
          ),
        ),
    )
    .toBe(true);
  const time = await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(time + 0.2);
  expect(f.errors).toEqual([]);
});
