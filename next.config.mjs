/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  outputFileTracingExcludes: { "*": ["sandbox/**", ".data/**", "proof/**"] },
};
export default nextConfig;
