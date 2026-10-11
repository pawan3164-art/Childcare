/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repo has its own project-root CLAUDE.md with real build conventions —
  // disable Next's auto-generated AGENTS.md/CLAUDE.md here so a future Claude
  // Code session doesn't pick up a nested, unrelated CLAUDE.md by accident.
  agentRules: false,
  // Development only (ignored by production builds): lets the dev server be opened on a stand-in custom domain,
  // for example kids.example.com mapped to 127.0.0.1, to try white label level 2 locally.
  allowedDevOrigins: ['kids.example.com'],
};

export default nextConfig;
