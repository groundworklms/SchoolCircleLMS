/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist loads its worker from disk at runtime; bundling breaks that.
  serverExternalPackages: ['pdfjs-dist'],
};
export default nextConfig;
