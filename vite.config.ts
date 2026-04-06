import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeBasePath = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
};

const resolveGithubPagesBase = () => {
  const explicit = process.env.PAGES_BASE_PATH;
  if (!explicit) {
    return '/';
  }

  if (explicit !== 'auto') {
    return normalizeBasePath(explicit);
  }

  const repositorySlug = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repositorySlug) {
    return '/';
  }

  if (repositorySlug.toLowerCase().endsWith('.github.io')) {
    return '/';
  }

  return normalizeBasePath(repositorySlug);
};

export default defineConfig({
  base: resolveGithubPagesBase(),
  plugins: [react()],
});
