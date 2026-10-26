import { spawn } from 'node:child_process';

if (process.platform !== 'darwin') {
  throw new Error('A build macOS deve ser executada em um host macOS.');
}

const identity = (process.env.MORUBI_MAC_SIGNING_IDENTITY ?? process.env.CSC_NAME)?.trim();
if (!identity) {
  throw new Error(
    [
      'Uma identidade estável de assinatura é obrigatória para build:mac:test.',
      'Defina MORUBI_MAC_SIGNING_IDENTITY com uma identidade exibida por',
      '`security find-identity -v -p codesigning`.',
      'Use build:mac:test:adhoc somente quando aceitar explicitamente que o macOS',
      'trate o próximo bundle como outro aplicativo e exija novas permissões TCC.'
    ].join(' ')
  );
}

const child = spawn(
  'electron-builder',
  [
    '--mac',
    'dir',
    '--x64',
    `-c.mac.identity=${identity}`,
    '-c.mac.hardenedRuntime=false'
  ],
  { env: process.env, stdio: 'inherit' }
);

child.on('error', (error) => {
  console.error(`Não foi possível iniciar electron-builder: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
