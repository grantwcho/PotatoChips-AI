import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
