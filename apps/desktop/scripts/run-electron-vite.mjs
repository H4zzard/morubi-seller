import { spawn } from 'node:child_process';

const mode = process.argv[2];
if (!['dev', 'preview'].includes(mode)) {
  throw new Error('Uso: node scripts/run-electron-vite.mjs <dev|preview>');
}

// VS Code and similar Electron hosts can inject this variable into integrated
// processes. If inherited by the Morubi executable, Electron starts as plain
// Node and exits before the application lifecycle is initialized.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const executable = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
const child = spawn(executable, [mode], {
  env: environment,
  stdio: 'inherit'
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(`Não foi possível iniciar electron-vite: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
