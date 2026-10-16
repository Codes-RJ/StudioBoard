import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2];
if (!['--experimental', '--release'].includes(mode) || process.argv.length !== 3) throw new Error('Choose --experimental or --release.');
const experimental = mode === '--experimental';
console.log(experimental ? 'Building an experimental fixture evaluation; do not publish this build.' : 'Building with experimental LLM generation disabled.');
// Flags live only in the child build. No operator env file or OS setting changes.
const env = { ...process.env, VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM: String(experimental), ...(experimental ? { VITE_ENABLE_SERVER_WORKSPACE: 'false' } : {}) };
const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/d', '/c', 'npm.cmd run build'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit', windowsHide: true })
  : spawn('npm', ['run', 'build'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
