import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile workspace packages — required for monorepo imports
  transpilePackages: ['@wearme/shared'],

  images: {
    remotePatterns: [
      // Allow images from local API in dev
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/api/v1/files/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/files/**',
      },
    ],
  },

  // Strict mode for catching issues early
  reactStrictMode: true,
};

export default nextConfig;
