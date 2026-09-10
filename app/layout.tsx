import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "@/components/shared/PWARegister";
export const metadata: Metadata = {
  title: { default: "Zivora", template: "%s | Zivora" },
  description: "Spoiler-safe intelligent video playback.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#6d28d9" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white">
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
