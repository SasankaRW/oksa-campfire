/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['three'],
  async headers() {
    return [
      {
        // sky, moon and grass images never change: let browsers and Vercel's CDN keep them
        source: '/textures/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // memory photos have a content hash in their names, so they never change
        source: '/memories/:file(m-.*\\.webp)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/memories/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=600' }],
      },
    ];
  },
};
export default nextConfig;
