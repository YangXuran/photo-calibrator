/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  assetPrefix: ".",
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Force .worker.ts files to output as .js instead of .ts.
      // Module workers require a JavaScript MIME type; browsers reject
      // .ts files served as text/vnd.trolltech.linguist or video/mp2t.
      config.module.rules.unshift({
        test: /\.worker\.ts$/,
        type: "asset/resource",
        generator: {
          filename: "static/chunks/[name].[hash].js",
        },
      });
    }
    return config;
  },
};

export default nextConfig;
