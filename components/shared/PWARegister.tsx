"use client";
import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let active = true;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      if (!active) return;
      // Installation is optional and never affects playback.
    });
    return () => {
      active = false;
    };
  }, []);
  return null;
}
