/* eslint-disable @typescript-eslint/no-var-requires */
// DEPRECATED: mdx — las páginas .mdx (docs/storybook) se movieron a _deprecated en la
// poda del CLI npx, así que sacamos @next/mdx y el pageExtension "mdx". Reversible:
// reponer `const withMDX = require("@next/mdx")();`, "mdx" en pageExtensions y envolver
// con withMDX(...). Ver _deprecated/README.md.
const pkg = require("./package.json");

// Para correr local con `next start` necesitamos un build normal (no standalone).
// FORK_LOCAL=1 → build normal; si no, se mantiene "standalone" (deploy Cloudflare upstream).
const OUTPUT_MODE = process.env.FORK_LOCAL === "1" ? undefined : "standalone";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: OUTPUT_MODE,
  reactStrictMode: false,
  pageExtensions: ["js", "jsx", "ts", "tsx"],
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

module.exports = { ...nextConfig, output: OUTPUT_MODE };
