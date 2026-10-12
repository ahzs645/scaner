// Development static file host. No scanner access, APIs, file upload or job service.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const root=resolve('dist'),port=Number(process.env.SCANNER_WEB_PORT||8765);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm'};
createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  try {
    const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep))throw Error('Invalid path');
    const data=await readFile(file),extension=file.slice(file.lastIndexOf('.'));
    // The OCR worker can fetch only its local runtime/language assets. The app
    // document retains connect-src 'none'; scan data is passed as in-memory bytes.
    const csp=['/processing/worker.js','/color/worker.js','/color/validate-worker.js'].includes(path)
      ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src http://127.0.0.1:${port}/vendor/color/; object-src 'none'`
      : path==='/vendor/ocr/worker.min.js'
      ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src http://127.0.0.1:${port}/vendor/ocr/; object-src 'none'`
      : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    res.writeHead(200,{'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>process.stdout.write(`Static browser app: http://127.0.0.1:${port}/\n`));
