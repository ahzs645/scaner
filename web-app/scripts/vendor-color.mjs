import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

/** All runtime code/data is bundled locally. No CDN fallback. */
export async function vendorColor(output='dist/vendor/color') {
  for(const [name,expected] of [['lcms-wasm','1.0.5'],['jpeg-js','0.4.4']]) {
    const pkg=JSON.parse(await readFile('node_modules/'+name+'/package.json','utf8'));
    if(pkg.version!==expected)throw Error('Color assets require '+name+'@'+expected);
  }
  await mkdir(join(output,'licenses'),{recursive:true});
  const assets=[
    ['node_modules/lcms-wasm/dist/lcms.js','lcms.js'],
    ['node_modules/lcms-wasm/dist/lcms.wasm','lcms.wasm'],
    ['node_modules/lcms-wasm/LICENSE.md','licenses/lcms-wasm-LICENSE.md'],
    ['node_modules/jpeg-js/LICENSE','licenses/jpeg-js-LICENSE'],
    ['third-party/color/Little-CMS-LICENSE','licenses/Little-CMS-LICENSE'],
    ['third-party/color/srgb.icc','srgb.icc'],
    ['third-party/color/provenance.json','provenance.json'],
  ];
  for(const [source,target] of assets)await copyFile(source,join(output,target));
  const decoderSource=await readFile('node_modules/jpeg-js/lib/decoder.js','utf8');
  const markerAnchor='      // find marker\n      bitsCount = 0;\n      marker = (data[offset] << 8) | data[offset + 1];';
  if(decoderSource.split(markerAnchor).length!==2)throw Error('Pinned JPEG restart-marker patch anchor changed');
  // JPEG permits repeated FF marker-fill bytes. The upstream scan reader stops
  // at FFFF rather than reaching RSTn, so Epson's valid interval padding exits
  // its entropy loop prematurely. Keep strict decoding and only skip fill.
  const patchedDecoder=decoderSource.replace(markerAnchor,
    '      // Scan Studio: skip legal marker-fill FF bytes at an interval boundary.\n'+
    '      while (offset + 1 < data.length && data[offset] === 0xFF && data[offset + 1] === 0xFF) offset++;\n'+
    '      if (offset + 1 >= data.length) throw new Error("Truncated JPEG marker");\n'+markerAnchor);
  await build({stdin:{contents:"export {default as decode} from 'jpeg-js/lib/decoder.js';",resolveDir:process.cwd(),sourcefile:'jpeg-decoder-entry.js'},
    bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:join(output,'jpeg-decoder.js'),minify:false,legalComments:'eof',
    plugins:[{name:'jpeg-restart-marker-fill',setup(builder){builder.onLoad({filter:/[\\/]jpeg-js[\\/]lib[\\/]decoder\.js$/},()=>({contents:patchedDecoder,loader:'js'}));}}]});
  const files=[];
  for(const target of [...assets.map(item=>item[1]),'jpeg-decoder.js']) {
    const bytes=await readFile(join(output,target));
    files.push({path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  await writeFile(join(output,'manifest.json'),JSON.stringify({packages:{'lcms-wasm':'1.0.5','jpeg-js':'0.4.4'},
    jpegDecoderPatch:{name:'legal-restart-marker-fill-v1',upstreamSHA256:createHash('sha256').update(decoderSource).digest('hex')},files},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await vendorColor(process.argv[2]);
