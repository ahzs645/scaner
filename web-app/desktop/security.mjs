import {isIP} from 'node:net';
export const APP_SCHEME='scan-studio',APP_HOST='app',APP_ORIGIN=APP_SCHEME+'://'+APP_HOST;
export function isAppURL(value){try{const url=new URL(value);return url.protocol===APP_SCHEME+':'&&url.hostname===APP_HOST&&!url.port&&!url.username&&!url.password;}catch{return false;}}
export function isPrivateIPv4(value){if(isIP(value)!==4)return false;const [a,b]=value.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);}
export function assertMainFrameSender(event,webContents){
  const frame=event.senderFrame;
  if(event.sender!==webContents||!frame||frame!==webContents.mainFrame||frame.origin!==APP_ORIGIN||!isAppURL(frame.url))throw Error('Untrusted desktop request');
}
