import {cp,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {packager} from '@electron/packager';
import {buildDistinctMain,PINNED_ELECTRON_VERSION} from '../desktop/native/build-main.mjs';
const packageInfo=JSON.parse(await readFile('package.json','utf8'));
if(packageInfo.devDependencies.electron!==PINNED_ELECTRON_VERSION)throw Error('Native desktop main requires pinned Electron '+PINNED_ELECTRON_VERSION);
const staging=await mkdtemp(join(tmpdir(),'scan-studio-package-'));
try{
  for(const directory of ['dist','desktop','src','scripts','third-party'])await cp(directory,join(staging,directory),{recursive:true});
  for(const file of ['COPYING','NOTICE','package-lock.json','tsconfig.json','README.md'])await cp(file,join(staging,file));
  await mkdir(join(staging,'build-inputs'));
  for(const file of ['package.json','package-lock.json'])await cp(file,join(staging,'build-inputs',file));
  await writeFile(join(staging,'package.json'),JSON.stringify({name:'scan-studio',productName:'Scan Studio',version:packageInfo.version,type:'module',main:'desktop/main.mjs',license:packageInfo.license},null,2));
  const paths=await packager({dir:staging,out:resolve('desktop-output'),name:'Scan Studio',executableName:'ScanStudio',appBundleId:'local.scanstudio.desktop',platform:'darwin',arch:process.arch,electronVersion:packageInfo.devDependencies.electron,asar:false,overwrite:true,prune:false,
    extendInfo:{NSLocalNetworkUsageDescription:'Scan Studio finds your Epson scanner and scans documents over your local network.',NSBonjourServices:['_scanner._tcp']},
  });
  for(const path of paths){
    const bundle=join(path,'Scan Studio.app');
    const nativeBuild=await buildDistinctMain({bundle,arch:process.arch,electronVersion:packageInfo.devDependencies.electron});
    await writeFile(join(bundle,'Contents/Resources/app/build-inputs/native-main.json'),JSON.stringify(nativeBuild,null,2)+'\n');
    await cp('package-lock.json',join(bundle,'Contents/Resources/app/build-inputs/package-lock.json'));
    await promisify(execFile)('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);
    await promisify(execFile)('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
    console.log('Desktop main UUID: '+nativeBuild.uuid+' (original '+nativeBuild.originalUUID+')');
    console.log('Desktop app: '+bundle);
  }
}finally{await rm(staging,{recursive:true,force:true});}
