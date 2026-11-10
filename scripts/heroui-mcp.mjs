import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';

// Documentation subprocess receives no application env or credentials.
const env = {};
for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[key]) env[key] = process.env[key];
}
const windows = process.platform === 'win32';
const transport = new StdioClientTransport({
  command: windows ? 'cmd.exe' : 'npx',
  args: windows ? ['/d', '/s', '/c', 'npx -y @heroui/react-mcp@latest'] : ['-y', '@heroui/react-mcp@latest'],
  env,
  stderr: 'ignore',
});
const client = new Client({ name: 'skladno-docs', version: '0.1.0' });
try {
  await client.connect(transport);
  const name = process.argv[2];
  if (name === 'interface') {
    const result = await client.callTool({ name: 'get_component_docs', arguments: { components: ['Modal', 'TextField', 'Input', 'Select', 'Switch', 'Checkbox', 'Table', 'Tabs'] } });
    if (result.isError) throw new Error('DOCS_UNAVAILABLE');
    const markdown = (result.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join('\n\n');
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
    await writeFile(new URL('../.local/heroui-interface.md', import.meta.url), markdown, 'utf8');
    console.log('HeroUI MCP: Modal/TextField/Input/Select/Switch/Checkbox/Table/Tabs documentation retrieved.');
    console.log('Reference saved locally to .local/heroui-interface.md (ignored by Git).');
  } else if (name === 'foundation') {
    await client.callTool({ name: 'list_components', arguments: {} });
    const results = await Promise.all([
      client.callTool({ name: 'get_docs', arguments: { path: '/docs/react/getting-started/quick-start' } }),
      client.callTool({ name: 'get_component_docs', arguments: { components: ['Button', 'Chip', 'Spinner', 'Surface'] } }),
    ]);
    if (results.some((result) => result.isError)) throw new Error('DOCS_UNAVAILABLE');
    const markdown = results.flatMap((result) => result.content ?? [])
      .filter((item) => item.type === 'text').map((item) => item.text).join('\n\n');
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
    await writeFile(new URL('../.local/heroui-foundation.md', import.meta.url), markdown, 'utf8');
    console.log('HeroUI MCP: component list, quick-start and Button/Chip/Spinner/Surface documentation retrieved.');
    console.log('Reference saved locally to .local/heroui-foundation.md (ignored by Git).');
  } else if (!name || name === 'list') {
    const { tools } = await client.listTools();
    console.log(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), null, 2));
  } else {
    const args = JSON.parse(process.argv[3] ?? '{}');
    const result = await client.callTool({ name, arguments: args });
    for (const item of result.content ?? []) {
      if (item.type === 'text') console.log(item.text);
    }
  }
} catch {
  console.error('HEROUI_MCP_REQUEST_FAILED');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
