import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [".output/*-chrome.zip"],
  },
};

export default withEve(nextConfig);
