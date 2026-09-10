import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZivoraPlayer, type ControllerFactory } from "@/components/player/ZivoraPlayer";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { contentId, episodeId, versionId } from "../security/publicationFixture";
const item = { contentId, episodeId, title: "The Quiet Horizon", description: "S1 · Episode 1" };
const grant = {
  contentId,
  episodeId,
  mediaVersionId: versionId,
  access: "public",
  token: null,
  expiresAt: null,
  manifestUrl: "https://media.test/media/v1/master.m3u8",
  objectBaseUrl: "https://media.test/media/v1/",
};
afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
});
function fixture() {
  const adapters: MockAdapter[] = [];
  const commands: string[] = [];
  const presentation = {
    toggleFullscreen: vi.fn(async () => {}),
    togglePictureInPicture: vi.fn(async () => {}),
  };
  const createController: ControllerFactory = (_video, _container, config) => {
    const adapter = new MockAdapter();
    adapters.push(adapter);
    const controller = new PlayerController(new PlayerEngine(adapter, config, { presentation }));
    controller.on("commandaudit", (event) => {
      if (event.status === "executed") commands.push(event.command!.type);
    });
    return controller;
  };
  return {
    adapters,
    commands,
    presentation,
    createController: vi.fn(createController),
    transport: vi.fn(async () => grant),
  };
}
describe("player controls", () => {
  it("allocates one controller in StrictMode and tears it down on unmount", async () => {
    const f = fixture();
    const view = render(
      <StrictMode>
        <ZivoraPlayer item={item} createController={f.createController} transport={f.transport} />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Pause" });
    expect(f.createController).toHaveBeenCalledOnce();
    view.rerender(
      <StrictMode>
        <ZivoraPlayer
          item={{ ...item }}
          createController={f.createController}
          transport={f.transport}
        />
      </StrictMode>,
    );
    await act(async () => {});
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.createController).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(f.adapters[0].destroyCalls).toBe(1));
  });
  it("routes playback, range, settings and presentation controls through audited commands", async () => {
    const f = fixture();
    render(
      <ZivoraPlayer item={item} createController={f.createController} transport={f.transport} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Play" });
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "120" } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek" }), { key: "Enter" });
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: ".4" } });
    fireEvent.click(screen.getByRole("button", { name: "Player settings" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Speed" }), { target: { value: "1.5" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Quality" }), {
      target: { value: "720" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Subtitles" }), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    fireEvent.click(screen.getByRole("button", { name: "Picture-in-picture" }));
    await waitFor(() =>
      expect(f.commands).toEqual(
        expect.arrayContaining([
          "TOGGLE_PLAY",
          "SEEK_TO",
          "SET_VOLUME",
          "SET_RATE",
          "SELECT_QUALITY",
          "SELECT_SUBTITLE",
          "TOGGLE_FULLSCREEN",
          "TOGGLE_PIP",
        ]),
      ),
    );
    expect(f.adapters[0].position).toBe(120);
    expect(f.presentation.toggleFullscreen).toHaveBeenCalledOnce();
  });
  it("offers a focused resume dialog with a start-over choice", async () => {
    localStorage.setItem(
      `zivora:progress:${contentId}:${episodeId}`,
      JSON.stringify({
        contentId: `${contentId}:${episodeId}`,
        position: 65,
        duration: 7200,
        updatedAt: new Date().toISOString(),
      }),
    );
    const f = fixture();
    render(
      <ZivoraPlayer item={item} createController={f.createController} transport={f.transport} />,
    );
    const resume = await screen.findByRole("button", { name: "Resume at 1:05" });
    expect(document.activeElement).toBe(resume);
    fireEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(f.adapters[0].position).toBe(0);
  });
});
