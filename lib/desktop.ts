"use client";

import { useEffect, useState } from "react";

/**
 * Whether we're running inside the Electron shell. Resolved after mount so the
 * static export and the desktop render identically on the first paint.
 *
 * The `window.doppel` bridge itself is declared in lib/store.ts, which owns it.
 */
export function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  const [platform, setPlatform] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined" && window.doppel?.isDesktop) {
      setDesktop(true);
      setPlatform(window.doppel.platform);
    }
  }, []);

  return { desktop, platform, mac: platform === "darwin" };
}
