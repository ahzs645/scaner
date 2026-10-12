import {copyFile} from 'node:fs/promises';
await copyFile('tests/browser-pipeline.html','dist/pipeline-check.html');
await copyFile('tests/browser-pipeline.js','dist/pipeline-check.js');
process.stdout.write('Open /pipeline-check.html on the development static host and click Run pixel checks.\n');
