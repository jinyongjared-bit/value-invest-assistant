#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');
const stagingDirectory = path.join(projectRoot, '.asar-staging');
const outputAsar = path.join(outputDirectory, 'app.asar');
const includedPaths = [
  'main.js', 'preload.js', 'stock-tracker.html', 'preview.html',
  'manifest.json', 'sw.js', 'lib', 'assets', 'icons'
];

async function main() {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
  fs.mkdirSync(stagingDirectory, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const relativePath of includedPaths) {
    const source = path.join(projectRoot, relativePath);
    const destination = path.join(stagingDirectory, relativePath);
    if (!fs.existsSync(source)) throw new Error(`Missing application file: ${relativePath}`);
    fs.cpSync(source, destination, { recursive: true });
  }
  fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(stagingDirectory, 'package.json'));

  await asar.createPackage(stagingDirectory, outputAsar);
  fs.rmSync(stagingDirectory, { recursive: true, force: true });

  const archive = fs.readFileSync(outputAsar);
  console.log(JSON.stringify({
    outputAsar,
    size: archive.length,
    sha256: crypto.createHash('sha256').update(archive).digest('hex')
  }, null, 2));
}

main().catch((error) => {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

