import {copyFile,readFile,writeFile} from 'node:fs/promises';
await copyFile('tests/browser-pipeline.html','dist/pipeline-check.html');
await copyFile('tests/browser-pipeline.js','dist/pipeline-check.js');
await copyFile('tests/browser-shortcuts.html','dist/shortcuts-check.html');
await copyFile('tests/browser-shortcuts.js','dist/shortcuts-check.js');
await writeFile('dist/append-check.html',(await readFile('src/index.html','utf8')).replace('./main.js','./append-check.js'));
await copyFile('tests/browser-append.js','dist/append-check.js');
process.stdout.write('Open /pipeline-check.html on the development static host and click Run pixel checks.\n');
