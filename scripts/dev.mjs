// Modo desarrollo: compila el servidor, lo arranca y lanza Vite con recarga en caliente.
// Editor con HMR en http://localhost:5173 (el servidor sigue en :5577).
import { spawn, execSync } from 'node:child_process';

execSync('npm run build -w @openpixel/server', { stdio: 'inherit' });
const procs = [
  spawn('node', ['packages/server/dist/main.js'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', '@openpixel/web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
