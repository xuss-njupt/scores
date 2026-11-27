import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // GitHub Pages project sites are served below /<repository-name>.
  // Keep local development at the origin root.
  basePath: process.env.GITHUB_PAGES === "true" ? "/scores" : "",
  trailingSlash: true,
  output: "export",
  images: {
    unoptimized: true
  }
};

export default nextConfig;
