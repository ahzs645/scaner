import test from 'node:test';import assert from 'node:assert/strict';
import {isAppURL,isPrivateIPv4,APP_ORIGIN,assertMainFrameSender} from '../security.mjs';
test('desktop URL authorization checks scheme and authority without trusting custom URL.origin',()=>{
 assert.equal(isAppURL(APP_ORIGIN+'/index.html'),true);
 for(const url of ['https://app/index.html','scan-studio://evil/index.html','scan-studio://app:123/index.html','scan-studio://user@app/index.html','about:blank','blob:scan-studio://app/id','file:///tmp/a'])assert.equal(isAppURL(url),false);
});
test('only private LAN IPv4 targets are allowed, excluding public and loopback',()=>{
 for(const ip of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.73','169.254.1.2'])assert.equal(isPrivateIPv4(ip),true);
 for(const ip of ['127.0.0.1','8.8.8.8','172.15.0.1','172.32.0.1','192.169.1.1','::1','router.local','192.168.1.999'])assert.equal(isPrivateIPv4(ip),false);
});
test('IPC must come from the actual trusted main frame and trusted serialized Chromium origin',()=>{
 const frame={origin:APP_ORIGIN,url:APP_ORIGIN+'/index.html'},contents={mainFrame:frame};
 assert.doesNotThrow(()=>assertMainFrameSender({sender:contents,senderFrame:frame},contents));
 assert.throws(()=>assertMainFrameSender({sender:{},senderFrame:frame},contents));
 assert.throws(()=>assertMainFrameSender({sender:contents,senderFrame:{...frame}},contents));
 frame.origin='null';assert.throws(()=>assertMainFrameSender({sender:contents,senderFrame:frame},contents));
 frame.origin=APP_ORIGIN;frame.url='about:blank';assert.throws(()=>assertMainFrameSender({sender:contents,senderFrame:frame},contents));
});
