/**
 * Map filename extension to a Shiki/markdown language tag.
 * Used when building the quote block in annotations.
 */

const EXT_MAP: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  vue: 'vue',
  svelte: 'svelte',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
};

export function detectLang(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('dockerfile') || lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower.endsWith('/makefile')) return 'makefile';
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = lower.slice(dot + 1);
  return EXT_MAP[ext] ?? '';
}
