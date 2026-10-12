import {copyFile,unlink,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Validation pages are generated only on demand and excluded from deploy builds.
for(const name of ['pipeline-check.html','pipeline-check.js','color-check.html','color-check.js','color-fixture.js','color-ui-check.html','color-ui-check.js','color-reference.js','shortcuts-check.html','shortcuts-check.js'])try{await unlink('dist/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}
for (const name of ['index.html','style.css']) await copyFile('src/'+name,'dist/'+name);
for (const name of ['COPYING','NOTICE']) await copyFile(name,'dist/'+name);
const assetRoot='dist/vendor/ocr';
for(const directory of ['', '/core','/lang','/licenses'])await mkdir(assetRoot+directory,{recursive:true});
const assets=[
 ['node_modules/tesseract.js/dist/tesseract.esm.min.js','tesseract.esm.min.js'],
 ['node_modules/tesseract.js/dist/worker.min.js','worker.min.js'],
 ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt','licenses/worker.min.js.LICENSE.txt'],
 ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt','licenses/tesseract.min.js.LICENSE.txt'],
 ['node_modules/tesseract.js/LICENSE.md','licenses/tesseract.js-LICENSE.md'],
 ['node_modules/tesseract.js-core/LICENSE','licenses/tesseract-core-LICENSE'],
 ['third-party/tessdata-LICENSE','licenses/tessdata-LICENSE'],
 ['node_modules/@tesseract.js-data/osd/4.0.0/osd.traineddata.gz','lang/osd.traineddata.gz'],
];
for(const suffix of ['','-simd','-relaxedsimd'])for(const extension of ['wasm.js','wasm'])assets.push([`node_modules/tesseract.js-core/tesseract-core${suffix}.${extension}`,`core/tesseract-core${suffix}.${extension}`]);
const files=[];
for(const [source,target] of assets){const data=await readFile(source);await copyFile(source,assetRoot+'/'+target);files.push({path:target,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
await writeFile(assetRoot+'/manifest.json',JSON.stringify({packages:{'tesseract.js':'7.0.0','tesseract.js-core':'7.0.0','@tesseract.js-data/osd':'1.0.0'},files},null,2)+'\n');

const {vendorColor}=await import('./vendor-color.mjs');await vendorColor();
