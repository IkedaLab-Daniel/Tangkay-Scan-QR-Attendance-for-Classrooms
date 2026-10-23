/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/welcome',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
