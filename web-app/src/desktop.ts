import type {Capabilities,DeviceSettings,ScanOptions,CapturedImage,ScanResult} from './driver.js';
export interface NetworkScannerTarget {
 id:string;label:string;model:string;host:string;port:number;serviceType:string;
 protocol:'epson-esci2-tcp';available?:boolean;
}
export interface DesktopBridge {
 discoverNetwork():Promise<NetworkScannerTarget[]>;
 scanNetwork(id:string,token:string,options:ScanOptions,onImage:(image:CapturedImage)=>Promise<void>):Promise<(ScanResult&{ok:true})|{ok:false;error:string}>;
 stopNetworkScan(token:string):Promise<void>;
 readNetworkSettings(id:string):Promise<{settings:DeviceSettings;capabilities:Capabilities;warnings:string[]}>;
}
declare global {interface Window {readonly scanStudioDesktop?:DesktopBridge}}
