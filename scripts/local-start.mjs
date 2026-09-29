import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.EMAILSENDER_DATA_DIR || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'EmailSender', 'data')
    : path.join(os.homedir(), 'Library', 'Application Support', 'EmailSender', 'data')
);
const launchFile = path.join(dataDir, 'launch.json');
try { await rm(launchFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env: process.env, stdio: 'inherit' });
let exited = false;
server.on('exit', code => { exited = true; process.exit(code ?? 1); });
let opened = false;
for (let attempt = 0; attempt < 50; attempt++) {
  if (exited) break;
  try {
    const { url } = JSON.parse(await readFile(launchFile, 'utf8'));
    if (url) {
      if (!process.env.EMAILSENDER_NO_OPEN) {
        if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      }
      opened = true;
      break;
    }
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!opened && !exited) {
  console.error('The local service did not provide a private launch link.');
  server.kill('SIGTERM');
}
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
