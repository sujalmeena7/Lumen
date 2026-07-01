import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@router/db', '@router/core'],
};

export default nextConfig;
