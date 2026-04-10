import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  // Sparticuz loads brotli binaries from package bin/ via import.meta path; NFT does not trace them.
  outputFileTracingIncludes: {
    "/api/convert": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
