const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform === 'darwin') {
  const source = path.join(__dirname, 'input-macos.swift');
  const directory = path.join(__dirname, 'bin');
  const executable = path.join(directory, 'input-macos');
  fs.mkdirSync(directory, { recursive: true });
  const slices = ['arm64', 'x86_64'].map((arch) => path.join(directory, `input-macos-${arch}`));
  try {
    for (const [index, arch] of ['arm64', 'x86_64'].entries()) {
      execFileSync('/usr/bin/xcrun', [
        'swiftc', source, '-O', '-target', `${arch}-apple-macosx12.0`,
        '-module-cache-path', path.join(directory, 'module-cache'), '-o', slices[index]
      ], { stdio: 'inherit' });
    }
    execFileSync('/usr/bin/lipo', ['-create', ...slices, '-output', executable], { stdio: 'inherit' });
    fs.chmodSync(executable, 0o755);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', executable], { stdio: 'inherit' });
    console.log('macOS input helper built (Apple Silicon + Intel).');
  } finally {
    for (const slice of slices) fs.rmSync(slice, { force: true });
  }
}
