/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel/Next lint is nice locally, but can block deploys on demo.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
