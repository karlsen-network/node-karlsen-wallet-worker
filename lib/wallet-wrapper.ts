//const threads = require('worker_threads');

const Worker = require('web-worker');
import {Wallet, EventTargetImpl, helper, log} from 'kaspa-wallet';
import {UID, CBItem} from './rpc';

const Url = require('url');
const ISNODE = true;

let baseURL = Url.pathToFileURL(__dirname + '/');//TODO

import {
	Network, NetworkOptions, SelectedNetwork, WalletSave, Api, TxSend, TxResp,
	PendingTransactions, WalletCache, IRPC, RPC, WalletOptions,	WalletOpt
} from 'kaspa-wallet/types/custom-types';

class WalletWrapper extends EventTargetImpl{
	
	static networkTypes=Wallet.networkTypes;
	static fromMnemonic(seedPhrase: string, networkOptions: NetworkOptions, options: WalletOptions = {}): WalletWrapper {
		if (!networkOptions || !networkOptions.network)
			throw new Error(`fromMnemonic(seedPhrase,networkOptions): missing network argument`);
		const privKey = new Wallet.Mnemonic(seedPhrase.trim()).toHDPrivateKey().toString();
		const wallet = new this(privKey, seedPhrase, networkOptions, options);
		return wallet;
	}

	//@ts-ignore
	worker:Worker;
	isWorkerReady=false;
	rpc:IRPC|undefined;
	_pendingCB:Map<string, CBItem> = new Map();
	syncSignal:helper.DeferredPromise|undefined;
	workerReady:helper.DeferredPromise = helper.Deferred();

	constructor(privKey: string, seedPhrase: string, networkOptions: NetworkOptions, options: WalletOptions = {}){
		super();

		let {rpc} = networkOptions;
		if(rpc){
			this.rpc = rpc;
			/*
			console.log("#####rpc onConnect check#######")
			rpc.onConnect(()=>{
				console.log("#####rpc onConnect#######")
			})
			*/
		}
		delete networkOptions.rpc;
		this.initWorker();

		this.initWallet(privKey, seedPhrase, networkOptions, options);
	}

	async initWallet(privKey: string, seedPhrase: string, networkOptions: NetworkOptions, options: WalletOptions = {}){
		await this.workerReady;
		this.postMessage('wallet-init', {
			privKey,
			seedPhrase,
			networkOptions,
			options
		});
	}

	initWorker(){
		const url = new URL('./worker.js', baseURL);
		const worker = this.worker = new Worker(url, {type:'module'});
		worker.onmessage = (msg:{data:{op:string, data:any}})=>{
			const {op, data} = msg.data;
			log.info(`worker message: ${op}, ${JSON.stringify(data)}`)
			switch(op){
				case 'ready':
					return this.handleReady(data);
				case 'rpc-request':
					return this.handleRPCRequest(data);
				case 'wallet-responce':
					return this.handleResponce(data);
				case 'wallet-events':
					return this.handleEvents(data);
			}

		}
	}

	handleEvents(msg:{name:string, data:any}){
		this.emit(msg.name, msg.data);
	}
	handleReady(data:any=undefined){
		this.workerReady.resolve()
		this.emit("worker-ready");
	}

	async handleResponce(msg:{rid:string, error?:any, result?:any}){
		let {rid, error, result} = msg;
		let item:CBItem|undefined = this._pendingCB.get(rid);
		if(!item)
			return
		
		item.cb(error, result);
		this._pendingCB.delete(rid);
	}
	async handleRPCRequest(msg:{fn:string, args:any, rid?:string}){
		const {fn, args, rid} = msg;

		let directFns = [
			'onConnect', 'onDisconnect', 'onConnectFailure', 'onError', 'disconnect'
		];

		if(directFns.includes(fn)){
			if(rid){
				args.push((result:any)=>{
					this.postMessage("rpc-direct", {rid, result})
				})
			}
			//@ts-ignore
			this.rpc[fn](...args)
			return
		}


		if(fn=='request' && /^notify/.test(args[0])){
			args.push((result:any)=>{
				this.postMessage("rpc-publish", {method:args[0], rid, result})
			})
		}

		//@ts-ignore
		let p = this.rpc[fn](...args)
		let {uid:subUid} = p;
		let error;
		let result = await p
		.catch((err:any)=>{
			error = err;
		});

		this.postMessage("rpc-response", {rid, subUid, result, error})
	}

	postMessage(op:string, data:any){
		log.info(`postMessage:: ${op}, ${JSON.stringify(data)}`)
		//@ts-ignore
		this.worker.postMessage({op, data})
	}

	async request(fn:string, args:any[], callback:Function|undefined=undefined){
		await this.workerReady
		let rid = undefined;
		if(callback){
			rid = this.createPendingCall(callback)
		}
		log.info(`wallet-request: ${fn}, ${JSON.stringify(args)},  ${rid}`)
		this.worker.postMessage({op:"wallet-request", data:{fn, args, rid}})
	}

	createPendingCall(cb:Function):string{
		const uid = UID();
		this._pendingCB.set(uid, {uid, cb});
		return uid;
	}

	async sync(syncOnce:boolean|undefined = undefined){
		this.syncSignal = helper.Deferred();
		let args = [];
		if(syncOnce !== undefined)
			args.push(syncOnce);

		this.request("sync", args, ()=>{
			this.syncSignal?.resolve();
		})

		return this.syncSignal;
	}

	setLogLevel(level: string){
		this.request("setLogLevel", [level])
	}

	get(name:string, waitForSync:boolean=false){
		return new Promise(async(resolve, reject)=>{
			if(waitForSync)
				await this.syncSignal;
			this.request(name, [], (error:any, result:any)=>{
				if(error)
					return reject(error)

				resolve(result);
			})
		})
	}

	getAfterSync(name:string){
		return this.get(name, true)
	}

	get mnemonic(){
		return this.get("mnemonic")
	}
	get receiveAddress(){
		return this.getAfterSync("receiveAddress")
	}

	/**
	 * Send a transaction. Returns transaction id.
	 * @param txParams
	 * @param txParams.toAddr To address in cashaddr format (e.g. kaspatest:qq0d6h0prjm5mpdld5pncst3adu0yam6xch4tr69k2)
	 * @param txParams.amount Amount to send in yonis (100000000 (1e8) yonis in 1 KSP)
	 * @param txParams.fee Fee for miners in yonis
	 * @throws `FetchError` if endpoint is down. API error message if tx error. Error if amount is too large to be represented as a javascript number.
	 */
	submitTransaction(txParamsArg:TxSend, debug = false): Promise <TxResp|null> {
		return new Promise((resolve, reject)=>{
			this.request("submitTransaction", [txParamsArg, debug], (error:any, result:any)=>{
				if(error)
					return reject(error);
				resolve(result);
			})
		})
	}

	
}


export {WalletWrapper}