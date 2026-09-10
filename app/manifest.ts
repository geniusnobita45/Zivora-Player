import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Zivora AI Player",
    short_name: "Zivora",
    description: "Spoiler-safe intelligent video playback.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#6d28d9",
    icons: [
      { src: "/icons/zivora-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { src: "/icons/zivora-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
  };
}
