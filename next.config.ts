import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 3D 打印模型附件可能较大；proxy 会缓冲请求体，默认 10MB 会截断
    proxyClientMaxBodySize: "30mb",
  },
};

export default nextConfig;
