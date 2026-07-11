/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workspace/ui', '@workspace/config'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
