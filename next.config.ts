import type { NextConfig } from "next";

/**
 * Doppel ships as an Electron application, so the web layer is exported to
 * static files and served over a private app:// protocol. That rules out
 * server-rendered dynamic segments — routine and run screens take their id
 * from the query string instead.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
