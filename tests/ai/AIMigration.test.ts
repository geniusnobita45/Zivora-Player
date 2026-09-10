// @vitest-environment node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderAiMigration } from "@/database/migrations/build";

describe("AI migration", () => {
  it("contains only the five frozen AI-domain tables with owner RLS", async () => {
    const sql = await renderAiMigration(join(process.cwd(), "database"));
    expect(sql.match(/create table public\./g)).toHaveLength(5);
    for (const table of [
      "ai_conversations",
      "ai_messages",
      "ai_cache",
      "ai_usage",
      "ai_preferences",
    ]) {
      expect(sql).toContain(`public.${table}`);
      expect(sql).toContain(`alter table public.%I enable row level security`);
    }
    expect(sql).toContain("ai_usage_select_own");
    expect(sql).toContain("(select auth.uid()) = user_id");
  });
});
