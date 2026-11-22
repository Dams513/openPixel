/**
 * MCP server over stdio. Configure it in Claude Desktop / Claude Code:
 *   { "command": "node", "args": ["/ruta/a/openPixel/packages/server/dist/mcp.js"] }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getBackend, shutdown } from './backend';
import { log } from './host';
import { INSTRUCTIONS, registerTools } from './tools';

const server = new McpServer({ name: 'openpixel', version: '0.1.0' }, { instructions: INSTRUCTIONS });
registerTools(server);

// Start (or connect to) the editor server right away so the user can open it.
getBackend().catch((e) => log('aviso:', (e as Error).message));

await server.connect(new StdioServerTransport());
log('servidor MCP listo (stdio)');

const stop = async () => {
  await shutdown().catch(() => {});
  process.exit(0);
};
process.stdin.on('close', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
