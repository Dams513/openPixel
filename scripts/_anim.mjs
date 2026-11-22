import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
const SP = process.argv[2];
const client = new Client({ name: 'anim', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['packages/server/dist/mcp.js'], env: { ...process.env, OPENPIXEL_NO_BROWSER: '1' }, stderr: 'ignore' }));
const t = async (name, args = {}, save) => {
  const r = await client.callTool({ name, arguments: args });
  for (const c of r.content) {
    if (c.type === 'text') console.log(name, '→', c.text.slice(0, 100));
    if (c.type === 'image' && save) writeFileSync(`${SP}/${save}.png`, Buffer.from(c.data, 'base64'));
  }
};
await t('new_canvas', { width: 24, height: 32, name: 'Héroe' });
await t('draw_grid', { x: 7, y: 12, rows: [
  '..hhhhh...', '.hhhhhhh..', '.hssssss..', '.ssksksk..', '.ssssss...', '..sssss...', '.bbbbbbb..', 'sbbbbbbbs.',
  'sbbbbbbbs.', '.bbbbbbb..', '.pppppp...', '.pp..pp...', '.pp..pp...', '.pp..pp...', '.oo..oo...',
], legend: { h: '#7a4a1e', s: '#f4c79b', k: '#1d1d2b', b: '#2b8fbf', p: '#3b3b54', o: '#4a3020' } });
for (const p of (process.argv[3] ?? 'walk,run,jump').split(',')) { await t('animate_sprite', { preset: p }, p); await t('undo'); }
await client.close();
