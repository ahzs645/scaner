import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,cp,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildDistinctMain,parseBuildUUIDs,PINNED_ELECTRON_VERSION} from '../native/build-main.mjs';
const execute=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
const source=resolve(here,'../native/scan-studio-main.cc');
const native={skip:process.platform!=='darwin'};
const uuid='12345678-1234-1234-1234-123456789ABC';

test('build UUID parser validates missing and duplicate architecture identities',()=>{
  assert.deepEqual([...parseBuildUUIDs(`UUID: ${uuid.toLowerCase()} (arm64) app\nUUID: ABCDEF12-1234-1234-1234-123456789ABC (x86_64) app`)],
    [['arm64',uuid],['x86_64','ABCDEF12-1234-1234-1234-123456789ABC']]);
  assert.throws(()=>parseBuildUUIDs('no UUID'),/no build UUID/);
  assert.throws(()=>parseBuildUUIDs(`UUID: ${uuid} (arm64) a\nUUID: ${uuid} (arm64) b`),/Duplicate/);
});

test('startup ABI refuses unreviewed Electron or architecture before touching a bundle',native,async()=>{
  await assert.rejects(buildDistinctMain({bundle:'/nonexistent',arch:'arm64',electronVersion:'99.0.0'}),/requires Electron/);
  await assert.rejects(buildDistinctMain({bundle:'/nonexistent',arch:'universal',electronVersion:PINNED_ELECTRON_VERSION}),/architecture/);
});

test('compiled launcher preserves normal and fuse-gated Node startup plus argument forwarding',native,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'scan-studio-startup-test-'));
  try {
    const stub=join(dir,'entrypoints.cc'),binary=join(dir,'launcher');
    await writeFile(stub,`#include <cstdlib>
#include <cstring>
#include <sys/stat.h>
namespace electron::fuses { bool IsRunAsNodeEnabled(){ return std::getenv("TEST_FUSE_ENABLED") != nullptr; } }
static bool valid(int argc,char** argv){struct stat s;return argc==2 && std::strcmp(argv[1],"--probe")==0 && fstat(0,&s)==0 && fstat(1,&s)==0 && fstat(2,&s)==0;}
extern "C" int ElectronMain(int argc,char** argv){return valid(argc,argv)?43:51;}
extern "C" int ElectronInitializeICUandStartNode(int argc,char** argv){return valid(argc,argv)?44:52;}
`);
    await execute('/usr/bin/xcrun',['clang++','-std=c++17',source,stub,'-o',binary]);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.TEST_FUSE_ENABLED;
    const code=async(extra)=>{try{await execute(binary,['--probe'],{env:{...env,...extra}});return 0;}catch(error){return error.code;}};
    assert.equal(await code({}),43);
    assert.equal(await code({ELECTRON_RUN_AS_NODE:'1'}),43,'disabled fuse prevents Node branch');
    assert.equal(await code({TEST_FUSE_ENABLED:'1',ELECTRON_RUN_AS_NODE:''}),43,'empty indicator preserves normal startup');
    assert.equal(await code({TEST_FUSE_ENABLED:'1',ELECTRON_RUN_AS_NODE:'1'}),44);
    const repair=await execute('/usr/bin/python3',['-c',
      'import os,subprocess,sys\ndef close_stdio():\n for fd in (0,1,2): os.close(fd)\np=subprocess.run([sys.argv[1],"--probe"],preexec_fn=close_stdio,env={k:v for k,v in os.environ.items() if k not in ("ELECTRON_RUN_AS_NODE","TEST_FUSE_ENABLED")})\nprint(p.returncode)',binary]);
    assert.equal(repair.stdout.trim(),'43','closed standard descriptors are repaired before framework entry');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('real pinned framework links a distinct main without modifying stock Electron',native,async()=>{
  const originalBundle=resolve(here,'../../node_modules/electron/dist/Electron.app');
  const originalMain=join(originalBundle,'Contents/MacOS/Electron');
  const originalBytes=await readFile(originalMain);
  const dir=await mkdtemp(join(tmpdir(),'scan-studio-framework-test-'));
  try {
    const bundle=join(dir,'Scan Studio.app');
    await mkdir(join(bundle,'Contents/MacOS'),{recursive:true});
    await mkdir(join(bundle,'Contents/Frameworks'));
    await cp(originalMain,join(bundle,'Contents/MacOS/ScanStudio'));
    await symlink(join(originalBundle,'Contents/Frameworks/Electron Framework.framework'),join(bundle,'Contents/Frameworks/Electron Framework.framework'));
    const result=await buildDistinctMain({bundle,arch:process.arch,electronVersion:PINNED_ELECTRON_VERSION});
    assert.notEqual(result.uuid,result.originalUUID);
    assert.equal(result.architecture,process.arch==='x64'?'x86_64':process.arch);
    assert.deepEqual(await readFile(originalMain),originalBytes);
    assert.deepEqual(await readdir(join(bundle,'Contents/MacOS')),['ScanStudio'],'temporary build directory removed');
    const dependencies=(await execute('/usr/bin/otool',['-L',join(bundle,'Contents/MacOS/ScanStudio')])).stdout;
    assert.match(dependencies,/@rpath\/Electron Framework\.framework\/Electron Framework/);
    const loads=(await execute('/usr/bin/otool',['-l',join(bundle,'Contents/MacOS/ScanStudio')])).stdout;
    assert.match(loads,/@executable_path\/\.\.\/Frameworks/);
    const bytes=await readFile(join(bundle,'Contents/MacOS/ScanStudio'));
    assert.ok(bytes.includes(Buffer.from('local.scanstudio.desktop/main/v1/electron-44.7.0')),'app-specific identity survives optimized compilation');
  } finally {await rm(dir,{recursive:true,force:true});}
});
