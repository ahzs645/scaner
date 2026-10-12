import type {DeviceSettings} from '../driver.js';
export interface ColorDeviceIdentity {model:string;serial:string;firmware:string}
/** INFO identity is shared by USB and TCP; network addresses are not color identity. */
export function colorDeviceIdentity(settings:DeviceSettings):ColorDeviceIdentity|undefined {
 const value=(name:string)=>{const items=(settings.INFO??[]).filter((item):item is {name:string;value:string}=>'name' in item&&item.name===name&&'value' in item&&typeof item.value==='string');if(items.length!==1)return undefined;return items[0]!.value.replace(/^h[0-9a-f]{3}/i,'').trim();};
 const model=value('PRD'),serial=value('S/N'),firmware=value('VER');if(!model||!serial||!firmware)return undefined;return {model,serial,firmware};
}
