// Smoke test: launches the MCP server over stdio and draws something.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'smoke.png';
const transport = new StdioClientTransport({
  command: 'node',
  args: ['packages/server/dist/mcp.js'],
  env: { ...process.env, OPENPIXEL_NO_BROWSER: '1' },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(transport);
const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const t = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  for (const c of r.content) if (c.type === 'text') console.log(`${name} →`, c.text.slice(0, 300));
  return r;
};
await t('new_canvas', { width: 16, height: 16 });
await t('draw_rect', { x: 0, y: 0, width: 16, height: 16, color: '#1d1d2b', filled: true });
await t('layer', { action: 'add', name: 'Corazón' });
await t('draw_grid', { x: 4, y: 5, rows: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], legend: { r: '#e03050' } });
await t('draw_grid', { x: 4, y: 5, rows: ['.......', '.w.....'], legend: { w: '#ffffff' } });
await t('read_pixels', { x: 4, y: 5, width: 7, height: 6 });
await t('batch', { ops: [{ type: 'pixels', pixels: [[0, 0, '#fff']] }, { type: 'bogus' }] });
const v = await t('view_canvas', {});
const img = v.content.find((c) => c.type === 'image');
writeFileSync(out, Buffer.from(img.data, 'base64'));
await t('frame', { action: 'duplicate' });
await t('transform_layer', { action: 'shift', dy: -1 });
await t('export_file', { path: out.replace(/\.png$/, '.gif'), scale: 8 });
await t('undo', { steps: 2 });
await client.close();
