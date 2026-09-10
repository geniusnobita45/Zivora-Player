import { SiteShell } from "@/components/shared/SiteShell";
import { SettingsPanel } from "@/components/shared/SettingsPanel";
export default function SettingsPage() {
  return (
    <SiteShell title="Settings">
      <h1 className="mb-8 text-4xl font-bold">Preferences</h1>
      <SettingsPanel />
    </SiteShell>
  );
}
