/* eslint-disable @typescript-eslint/no-var-requires */
const withMDX = require("@next/mdx")();
const pkg = require("./package.json");

// Para correr local con `next start` necesitamos un build normal (no standalone).
// FORK_LOCAL=1 → build normal; si no, se mantiene "standalone" (deploy Cloudflare upstream).
const OUTPUT_MODE = process.env.FORK_LOCAL === "1" ? undefined : "standalone";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: OUTPUT_MODE,
  reactStrictMode: false,
  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],
  env: {
    NEXT_PUBLIC_STUDIO_VERSION: pkg.version,
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.NEXT_PUBLIC_OB_API ?? "https://app.dev.outerbase.com/api/v1"}/:path*`,
      },
    ];
  },
};

module.exports = { ...withMDX(nextConfig), output: OUTPUT_MODE };
