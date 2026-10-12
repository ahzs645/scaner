import {colorDeviceIdentity} from './color/identity.js';
import type {ColorDeviceIdentity} from './color/identity.js';
import {buildHeader, replyLength, tokens, compact, errorTokens, ImageBatch} from './protocol.js';
import type {Reply, CapturedImage} from './protocol.js';
import type {ScanOptions} from './planner.js';
import {matchesDevice} from './driver.js';
import type {DeviceSettings, ScannerDriver} from './driver.js';
import type {Capabilities} from './capabilities.js';
import {FF680W_PROFILE} from './profiles/ff680w.js';
import type {EscI2Profile} from './profiles/esci2.js';
export type {DeviceSettings} from './driver.js';
const encode = new TextEncoder();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export class Scanner implements ScannerDriver {
  deviceIdentity:ColorDeviceIdentity|undefined;
  private device?: USBDevice; private input = 0; private output = 0; private interfaceNumber = 0;
  private mechanicalActions: readonly string[] = []; private busy = false;
  private decodedCapabilities?: Capabilities;
  private listening = false;
  private readonly disconnectHandler = (event: USBConnectionEvent): void => {
    if(event.device === this.device) {
      this.device = undefined; this.deviceIdentity=undefined; this.decodedCapabilities = undefined; this.mechanicalActions = [];
      this.stopListening(); this.onDisconnect();
    }
  };
  constructor(private usb: USB, private log: (message:string)=>void = ()=>{}, private onDisconnect: ()=>void = ()=>{}, private transferTimeout = 20000,
    readonly profile: EscI2Profile = FF680W_PROFILE, private selectedDevice?: USBDevice) {}
  get connected(): boolean {return !!this.device;}
  get capabilities(): Capabilities | undefined {return this.decodedCapabilities;}
  validateOptions(options: ScanOptions): void {this.profile.buildScanPlan(options);}
  private async exclusive<T>(work:()=>Promise<T>): Promise<T> {
    if (this.busy) throw Error('Scanner is busy'); this.busy = true;
    try {return await work();} finally {this.busy = false;}
  }
  private startListening(): void {
    if(!this.listening) {this.usb.addEventListener('disconnect', this.disconnectHandler); this.listening = true;}
  }
  private stopListening(): void {
    if(this.listening) {this.usb.removeEventListener('disconnect', this.disconnectHandler); this.listening = false;}
  }
  private async clearConnection(): Promise<void> {const device = this.device; this.device = undefined; this.deviceIdentity=undefined; this.decodedCapabilities = undefined; this.mechanicalActions = []; this.stopListening(); if(device)try{await device.close();}catch{}}
  private async open(): Promise<DeviceSettings> {
    const device = this.device!; await device.open();
    const configurationValue = this.profile.usbInterface.configurationValue ?? device.configuration?.configurationValue ?? device.configurations?.[0]?.configurationValue;
    if (!device.configuration || (this.profile.usbInterface.configurationValue !== undefined && device.configuration.configurationValue !== configurationValue)) {
      if(configurationValue === undefined)throw Error('Scanner USB configuration not found');
      await device.selectConfiguration(configurationValue);
    }
    const intf = device.configuration!.interfaces.find(i => i.interfaceNumber === this.profile.usbInterface.number && i.alternates.some(a=>a.endpoints.some(e=>e.type==='bulk'&&e.direction==='in')&&a.endpoints.some(e=>e.type==='bulk'&&e.direction==='out')));
    if(!intf)throw Error('Scanner bulk interface not found');
    this.interfaceNumber = intf.interfaceNumber; await device.claimInterface(this.interfaceNumber);
    const alt = intf.alternates.find(a=>a.endpoints.some(e=>e.type==='bulk'&&e.direction==='in')&&a.endpoints.some(e=>e.type==='bulk'&&e.direction==='out'))!;
    if(intf.alternate.alternateSetting !== alt.alternateSetting)await device.selectAlternateInterface(this.interfaceNumber,alt.alternateSetting);
    this.input = alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='in')!.endpointNumber;
    this.output = alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='out')!.endpointNumber;
    this.mechanicalActions = []; this.decodedCapabilities = undefined; this.log(`Claimed interface ${this.interfaceNumber}, bulk IN ${this.input}, OUT ${this.output}`);
    return this.read();
  }
  async connect(): Promise<DeviceSettings> {
    return this.exclusive(async()=>{
      if (this.device) throw Error('Scanner is already connected');
      try {
        let selected = this.selectedDevice;
        if(!selected) {
          const paired = (await this.usb.getDevices()).filter(d=>matchesDevice(this.profile,d));
          selected = paired.length===1 ? paired[0] : await this.usb.requestDevice({filters:this.profile.devices.map(id=>({vendorId:id.vendorId,productId:id.productId}))});
        }
        if(!selected || !matchesDevice(this.profile,selected))throw Error('Unsupported scanner for selected profile');
        this.device = selected; this.startListening();
        return await this.open();
      }catch(e){await this.clearConnection(); throw e;}
    });
  }
  async disconnect(): Promise<void> {return this.exclusive(async()=>{await this.clearConnection();});}
  async reset(): Promise<DeviceSettings> {
    return this.exclusive(async()=>{
      if(!this.device)throw Error('Connect the scanner first'); const device = this.device;
      try {await device.releaseInterface(this.interfaceNumber); await device.reset(); await device.close(); this.device = device; this.startListening(); const settings = await this.open(); this.log('USB reset completed; settings read'); return settings;}
      catch(e){await this.clearConnection(); throw Error('USB reset failed: '+message(e));}
    });
  }
  async settings(): Promise<DeviceSettings> {return this.exclusive(()=>this.read());}
  private async read(): Promise<DeviceSettings> {
    let locked = false, failure: unknown;
    try {
      await this.control(); locked = true; const result: DeviceSettings = {};
      for(const command of this.profile.settingsCommands) {
        const reply = await this.query(command); result[command] = reply.items.map(compact);
      }
      this.deviceIdentity=colorDeviceIdentity(result);
      this.mechanicalActions = this.profile.mechanicalActions(result);
      this.decodedCapabilities = this.profile.decodeCapabilities(result.CAPA ?? []);
      this.log('INFO, CAPA, RESA and STAT read directly over WebUSB'); return result;
    }catch(e){failure=e; throw e;}
    finally {if(locked&&this.device)try{errorTokens((await this.query('FIN ')).items,'Settings finalization');}catch(e){if(failure)this.log('Settings finalization: '+message(e));else throw e;}}
  }
  private async transfer<T>(promise:Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void this.clearConnection(); reject(Error('USB transfer timed out; reconnect the scanner'));},this.transferTimeout);})]);}
    finally {clearTimeout(timer);}
  }
  private async send(data:Uint8Array): Promise<void> {
    if(!this.device)throw Error('Scanner disconnected');
    const result = await this.transfer(this.device.transferOut(this.output,Uint8Array.from(data)));
    if(result.status !== 'ok'||result.bytesWritten !== data.length)throw Error('Short or failed USB write');
  }
  private async receive(length:number): Promise<Uint8Array> {
    if(!this.device)throw Error('Scanner disconnected'); const result = await this.transfer(this.device.transferIn(this.input,length));
    if(result.status !== 'ok'||!result.data)throw Error('USB read failed');
    return new Uint8Array(result.data.buffer,result.data.byteOffset,result.data.byteLength).slice();
  }
  private async control(): Promise<void> {
    await this.send(Uint8Array.of(28,88)); const reply = await this.receive(64);
    if(reply[0]===6||new TextDecoder().decode(reply.slice(0,4))==='UNKN')return;
    throw Error('Scanner rejected USB lock');
  }
  private async query(command:string,payload:Uint8Array=new Uint8Array()): Promise<Reply> {
    await this.send(buildHeader(command,payload.length)); if(payload.length)await this.send(payload);
    const immediate = await this.receive(64); let head;
    try {head=replyLength(command,immediate);}catch(e){throw Error(command.trim()+': '+message(e));}
    const data = head.length ? await this.receive(head.length) : new Uint8Array();
    if(data.length!==head.length)throw Error('Short data block');
    return {header:head.header,data,items:[...tokens(immediate,12),...(command==='IMG '?[]:tokens(data))]};
  }
  async scan(options:ScanOptions, onImage:(image:CapturedImage)=>Promise<void>, signal?:AbortSignal): Promise<{sheets:number;images:number;warnings:string[]}> {
    // Build and validate before acquiring the scanner or feeding paper.
    const plan=this.profile.buildScanPlan(options);
    return this.exclusive(async()=>{
      if(!this.device)throw Error('Connect the scanner first');
      let locked=false, acquisitionAttempted=false, saved=0, failure:unknown;
      const batch=new ImageBatch(options), warnings:string[]=[];
      const checkStop=()=>{if(signal?.aborted)throw Error('Stopped');};
      try {
        checkStop(); await this.control(); locked=true;
        errorTokens((await this.query('STAT')).items,'Scanner status'); checkStop();
        for(const action of this.mechanicalActions)errorTokens((await this.query('MECH',encode.encode(action))).items,'Feeder load');
        const para=await this.query('PARA',plan.payload); errorTokens(para.items,'Parameters');
        if(!para.items.some(t=>t.name==='par'&&t.value==='OK  '))throw Error('Scanner did not accept parameters');
        checkStop(); acquisitionAttempted=true; errorTokens((await this.query('TRDT')).items,'Scan start');
        const deadline=Date.now()+300000;
        while(Date.now()<deadline) {
          checkStop(); const block=await this.query('IMG '); const completed=batch.accept(block);
          if(completed){await onImage(completed); saved++; this.log(`Saved ${completed.filename}: ${completed.image.length} bytes`);}
          if(batch.done)break;
          if(!block.data.length)await new Promise(resolve=>setTimeout(resolve,100));
        }
        batch.validate(); this.log('Job ended with lftd000');
      }catch(e){failure=e;}
      finally {
        if(locked&&this.device) {
          if(acquisitionAttempted&&!batch.done)try{errorTokens((await this.query('CAN ')).items,'Cancel');}catch(e){warnings.push('Cancel: '+message(e));}
          try{errorTokens((await this.query('FIN ')).items,'Finalize');}catch(e){warnings.push('Finalize: '+message(e));}
        }
        for(const warning of warnings)this.log(warning);
      }
      if(failure)throw Error(message(failure)+(saved?` · ${saved} completed images preserved`:'')+(warnings.length?' · Cleanup warning':''));
      return {sheets:batch.counts.front,images:saved,warnings};
    });
  }
}
