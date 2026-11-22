import { build } from 'esbuild';

await build({
  entryPoints: ['src/mcp.ts', 'src/main.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['ws', '@modelcontextprotocol/sdk', 'zod', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
