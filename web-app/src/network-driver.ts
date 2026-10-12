import {colorDeviceIdentity} from './color/identity.js';
import type {ColorDeviceIdentity} from './color/identity.js';
import type {ScannerDriver,Capabilities,DeviceSettings,ScanOptions,CapturedImage,ScanResult} from './driver.js';
import type {DesktopBridge,NetworkScannerTarget} from './desktop.js';
import {FF680W_PROFILE} from './profiles/ff680w.js';
export class NetworkScannerDriver implements ScannerDriver {
 readonly transport='network' as const;
 readonly profile=FF680W_PROFILE;
 deviceIdentity:ColorDeviceIdentity|undefined;
 connected=false;
 capabilities:Capabilities|undefined;
 constructor(private bridge:DesktopBridge,readonly target:NetworkScannerTarget) {
  if(target.model!=='FF-680W'||target.protocol!=='epson-esci2-tcp')throw Error('Unsupported network scanner');
 }
 validateOptions(options:ScanOptions):void {this.profile.buildScanPlan(options);}
 async connect():Promise<DeviceSettings>{const result=await this.bridge.readNetworkSettings(this.target.id);this.capabilities=result.capabilities;this.deviceIdentity=colorDeviceIdentity(result.settings);this.connected=true;return result.settings;}
 async settings():Promise<DeviceSettings>{if(!this.connected)throw Error('Network scanner is disconnected');return this.connect();}
 async reset():Promise<DeviceSettings>{return this.settings();}
 async disconnect():Promise<void>{this.connected=false;this.capabilities=undefined;this.deviceIdentity=undefined;}
 async scan(options:ScanOptions,onImage:(image:CapturedImage)=>Promise<void>,signal?:AbortSignal):Promise<ScanResult>{
  this.validateOptions(options);if(!this.connected)throw Error('Network scanner is disconnected');if(signal?.aborted)throw Error('Network scan stopped');
  const token=crypto.randomUUID();const stop=()=>{void this.bridge.stopNetworkScan(token).catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  try {const result=await this.bridge.scanNetwork(this.target.id,token,options,onImage);if(!result.ok)throw Error(result.error);return result;}
  finally{signal?.removeEventListener('abort',stop);}
 }
}
