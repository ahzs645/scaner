import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rename,rm,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PINNED_ELECTRON_VERSION = '44.7.0';
const execute = promisify(execFile);
const source = join(dirname(fileURLToPath(import.meta.url)), 'scan-studio-main.cc');

export function parseBuildUUIDs(output) {
  const result = new Map();
  for (const line of output.split('\n')) {
    const match = /^UUID: ([0-9A-Fa-f-]{36}) \(([^)]+)\) /.exec(line);
    if (match) {
      if (result.has(match[2])) throw Error('Duplicate build UUID architecture');
      result.set(match[2], match[1].toUpperCase());
    }
  }
  if (!result.size) throw Error('Main executable has no build UUID');
  return result;
}

/** Compile only the app main; installed Electron framework/helpers are inputs.
 * Fail before replacement on unsupported runtime or missing/unchanged UUID. */
export async function buildDistinctMain({bundle,arch,electronVersion}) {
  if (process.platform !== 'darwin') throw Error('Native desktop packaging requires macOS');
  if (electronVersion !== PINNED_ELECTRON_VERSION) throw Error('Native startup ABI requires Electron '+PINNED_ELECTRON_VERSION);
  if (!['arm64','x64'].includes(arch)) throw Error('Unsupported native desktop architecture');
  const targetArch = arch === 'x64' ? 'x86_64' : arch;
  const main = join(bundle,'Contents/MacOS/ScanStudio');
  const original = parseBuildUUIDs((await execute('/usr/bin/dwarfdump',['--uuid',main])).stdout);
  if (!original.has(targetArch)) throw Error('Packaged main architecture does not match the requested build');
  // Use the same filesystem as the target for atomic replacement.
  const buildDir = await mkdtemp(join(bundle,'Contents/MacOS/.scan-studio-build-'));
  try {
    const built = join(buildDir,'ScanStudio');
    await execute('/usr/bin/xcrun',['clang++','-std=c++17','-O2','-arch',targetArch,
      '-mmacosx-version-min=13.0',source,'-F',join(bundle,'Contents/Frameworks'),
      '-framework','Electron Framework','-Wl,-rpath,@executable_path/../Frameworks','-o',built]);
    const current = parseBuildUUIDs((await execute('/usr/bin/dwarfdump',['--uuid',built])).stdout);
    if (current.size !== 1 || !current.has(targetArch)) throw Error('Built main architecture does not match the requested build');
    if ([...original.values()].includes(current.get(targetArch))) throw Error('Source-built main must have a distinct build UUID');
    await chmod(built,0o755);
    await rename(built,main);
    return {electronVersion,architecture:targetArch,originalUUID:original.get(targetArch),uuid:current.get(targetArch)};
  } finally {await rm(buildDir,{recursive:true,force:true});}
}
