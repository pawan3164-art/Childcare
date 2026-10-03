/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repo has its own project-root CLAUDE.md with real build conventions —
  // disable Next's auto-generated AGENTS.md/CLAUDE.md here so a future Claude
  // Code session doesn't pick up a nested, unrelated CLAUDE.md by accident.
  agentRules: false,
};

export default nextConfig;
