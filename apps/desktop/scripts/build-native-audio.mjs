import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..');
const source = resolve(desktopDirectory, 'native/macos-audio-engine/main.swift');
const informationPropertyList = resolve(desktopDirectory, 'native/macos-audio-engine/Info.plist');
const outputDirectory = resolve(desktopDirectory, 'native/macos-audio-engine/build');
const output = resolve(outputDirectory, 'morubi-audio-engine');
const x64Output = `${output}.x64`;
const arm64Output = `${output}.arm64`;
const optimization = process.env.MORUBI_NATIVE_AUDIO_DEBUG === 'true' ? '-Onone' : '-O';

await mkdir(outputDirectory, { recursive: true });

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} foi encerrado pelo sinal ${signal}.`));
      else if (code === 0) resolvePromise();
      else reject(new Error(`${command} terminou com código ${code ?? 'desconhecido'}.`));
    });
  });
}

function compilerArguments(architecture, architectureOutput) {
  return [
    'swiftc',
    source,
    '-o',
    architectureOutput,
    optimization,
    '-parse-as-library',
    '-target',
    `${architecture}-apple-macos12.0`,
    '-Xlinker',
    '-sectcreate',
    '-Xlinker',
    '__TEXT',
    '-Xlinker',
    '__info_plist',
    '-Xlinker',
    informationPropertyList,
    '-framework',
    'ScreenCaptureKit',
    '-framework',
    'CoreMedia',
    '-framework',
    'AudioToolbox'
  ];
}

try {
  await run('xcrun', compilerArguments('x86_64', x64Output));
  await run('xcrun', compilerArguments('arm64', arm64Output));
  await run('xcrun', ['lipo', '-create', x64Output, arm64Output, '-output', output]);
} finally {
  await Promise.all([rm(x64Output, { force: true }), rm(arm64Output, { force: true })]);
}
