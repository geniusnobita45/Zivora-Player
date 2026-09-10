// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { readPublicSupabaseEnv } from "@/lib/supabase/env";

const supabaseRoot = join(process.cwd(), "lib", "supabase");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase client boundaries", () => {
  it("validates public Supabase environment values", () => {
    expect(
      readPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(() =>
      readPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toThrow();
  });

  it("creates a Database-typed singleton browser client", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const first = createBrowserSupabaseClient();
    const second = createBrowserSupabaseClient();
    expect(first).toBe(second);
    expect(first.from("public_catalog")).toBeDefined();
  });

  it("keeps the service-role key out of browser and user-session helpers", async () => {
    const browser = await readFile(`${supabaseRoot}/browser.ts`, "utf8");
    const server = await readFile(`${supabaseRoot}/server.ts`, "utf8");
    const service = await readFile(`${supabaseRoot}/service.ts`, "utf8");

    expect(browser).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(server).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(service).toContain('import "server-only"');
    expect(service).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(service).toContain("persistSession: false");
  });
});
