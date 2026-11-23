import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "query", key: "view", value: "overview" }],
        destination: "/",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "query", key: "view", value: "(?<section>.*)" }],
        destination: "/:section",
        permanent: false,
      },
    ];
  },
};

export default config;
