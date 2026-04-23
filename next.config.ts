import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "pdf-parse"],
  async rewrites() {
    return [
      { source: "/widget/v1/widget.js", destination: "/widget.js" },
    ];
  },
};

export default nextConfig;
