//@ts-ignore
const IS_NODE_CLI = typeof window == 'undefined';
import {workerLog} from './logger';
import {Wallet, EventTargetImpl, helper} from 'kaspa-wallet';

export {workerLog};

let Worker_ = IS_NODE_CLI?require('web-worker'):Worker;
workerLog.info("Worker:", (Worker_+"").substr(0, 32)+"....")


import {UID, CBItem} from './rpc';


let worker:Worker, workerReady:helper.DeferredPromise = helper.Deferred();


let onWorkerMessage = (op:string, data:any)=>{
	workerLog.info("abstract onWorkerMessage")
}

export const initKaspaFramework = (opt:{workerPath?:string}={})=>{
	return new Promise<void>((resolve, reject)=>{
		helper.dpc(2000, ()=>{
			
			
			let url, baseURL;
			if(IS_NODE_CLI){
				baseURL = 'file://'+__dirname+'/'
				url = new URL('worker.js', baseURL)
			}
			else{
				baseURL = window.location.origin;
				let {
					workerPath="/node_modules/kaspa-wallet-worker/worker.js"
				} = opt
				url = new URL(workerPath, baseURL);
			}
			workerLog.info("initKaspaFramework", url, baseURL)

			try{
				worker = new Worker_(url, {type:'module'});
			}catch(e){
				workerLog.info("Worker error", e)
			}

			workerLog.info("worker instance created", worker+"")

			worker.onmessage = (msg:{data:{op:string, data:any}})=>{
				const {op, data} = msg.data;
				if(op=='ready'){
					workerLog.info("worker.onmessage", op, data)
					workerReady.resolve();
					resolve();
					return
				}
				onWorkerMessage(op, data);
			}
		})
	})
}


import {
	Network, NetworkOptions, SelectedNetwork, WalletSave, Api, TxSend, TxResp,
	PendingTransactions, WalletCache, IRPC, RPC, WalletOptions,	WalletOpt, TxInfo
} from 'kaspa-wallet/types/custom-types';

class WalletWrapper extends EventTargetImpl{

	static networkTypes=Wallet.networkTypes;
	static KSP=Wallet.KSP;
	static networkAliases=Wallet.networkAliases;
	static Mnemonic=Wallet.Mnemonic;
	static passwordHandler=Wallet.passwordHandler;

	static async checkPasswordValidity(password:string, encryptedMnemonic: string){
		try{
			const decrypted = await this.passwordHandler.decrypt(password, encryptedMnemonic);
			const savedWallet = JSON.parse(decrypted) as WalletSave;
			return !!savedWallet?.privKey;
		}catch(e){
			return false;
		}
	}

	static async setWorkerLogLevel(level:string){
		workerLog.setLevel(level);
		await workerReady;
		await this.postMessage('worker-log-level', {level});
	}

	static async postMessage(op:string, data:any){
		workerLog.info(`postMessage:: ${op}, ${JSON.stringify(data)}`)
		//@ts-ignore
		worker.postMessage({op, data})
	}

	static fromMnemonic(seedPhrase: string, networkOptions: NetworkOptions, options: WalletOptions = {}): WalletWrapper {
		if (!networkOptions || !networkOptions.network)
			throw new Error(`fromMnemonic(seedPhrase,networkOptions): missing network argument`);
		const privKey = new Wallet.Mnemonic(seedPhrase.trim()).toHDPrivateKey().toString();
		const wallet = new this(privKey, seedPhrase, networkOptions, options);
		return wallet;
	}

	/**
	 * Creates a new Wallet from encrypted wallet data.
	 * @param password the password the user encrypted their seed phrase with
	 * @param encryptedMnemonic the encrypted seed phrase from local storage
	 * @throws Will throw "Incorrect password" if password is wrong
	 */
	static async import (password: string, encryptedMnemonic: string, networkOptions: NetworkOptions, options: WalletOptions = {}): Promise < WalletWrapper > {
		const decrypted = await Wallet.passworder.decrypt(password, encryptedMnemonic);
		const savedWallet = JSON.parse(decrypted) as WalletSave;
		const myWallet = new this(savedWallet.privKey, savedWallet.seedPhrase, networkOptions, options);
		return myWallet;
	}

	//@ts-ignore
	worker:Worker;
	isWorkerReady=false;
	rpc:IRPC|undefined;
	_pendingCB:Map<string, CBItem> = new Map();
	syncSignal:helper.DeferredPromise|undefined;
	workerReady:helper.DeferredPromise = workerReady;
	balance:{available:number, pending:number, total:number} = {available:0, pending:0, total:0};
	_rid2subUid:Map<string, string> = new Map();

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
		if(!worker)
			throw new Error("Please init kaspa framework using 'await initKaspaFramework();'.")
		this.worker = worker;
		onWorkerMessage = (op:string, data:any)=>{
			if(op != 'rpc-request')
				workerLog.info(`onWorkerMessage: ${op}, ${JSON.stringify(data)}`)
			switch(op){
				case 'rpc-request':
					return this.handleRPCRequest(data);
				case 'wallet-response':
					return this.handleResponse(data);
				case 'wallet-events':
					return this.handleEvents(data);
				case 'wallet-property':
					return this.handleProperty(data);
			}

		}
	}

	handleProperty(msg:{name:string, value:any}){
		//@ts-ignore
		this[name] = value;
	}

	handleEvents(msg:{name:string, data:any}){
		let {name, data} = msg;
		if(name == 'balance-update'){
			this.balance = data;
		}
		this.emit(name, data);
	}

	async handleResponse(msg:{rid:string, error?:any, result?:any}){
		let {rid, error, result} = msg;
		let item:CBItem|undefined = this._pendingCB.get(rid);
		if(!item)
			return
		
		item.cb(error, result);
		this._pendingCB.delete(rid);
	}
	async handleRPCRequest(msg:{fn:string, args:any, rid?:string}){
		workerLog.debug(`RPCRequest: ${JSON.stringify(msg)}`)
		const {fn, args, rid} = msg;

		if(fn=="unSubscribe"){
			if(args[1]){
				args[1] = this._rid2subUid.get(args[1]);//rid to subid
				if(!args[1])
					return
			}
			//@ts-ignore
			this.rpc.unSubscribe(...args);
			return
		}

		let directFns = [
			'onConnect', 'onDisconnect', 'onConnectFailure', 'onError', 
			'disconnect', 'connect'
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


		if(fn=='subscribe'){
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

		if(fn=='subscribe' && rid){
			this._rid2subUid.set(rid, subUid);
		}

		this.postMessage("rpc-response", {rid, result, error})
	}

	postMessage(op:string, data:any){
		WalletWrapper.postMessage(op, data)
	}

	async request(fn:string, args:any[], callback:Function|undefined=undefined){
		await this.workerReady
		let rid = undefined;
		if(callback){
			rid = this.createPendingCall(callback)
		}
		workerLog.debug(`wallet-request: ${fn}, ${JSON.stringify(args)},  ${rid}`)
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

	/**
	 * Send a transaction. Returns transaction id.
	 * @param txParams
	 * @param txParams.toAddr To address in cashaddr format (e.g. kaspatest:qq0d6h0prjm5mpdld5pncst3adu0yam6xch4tr69k2)
	 * @param txParams.amount Amount to send in yonis (100000000 (1e8) yonis in 1 KSP)
	 * @param txParams.fee Fee for miners in yonis
	 * @throws `FetchError` if endpoint is down. API error message if tx error. Error if amount is too large to be represented as a javascript number.
	 */
	estimateTransaction(txParamsArg:TxSend): Promise<TxInfo>{
		return new Promise((resolve, reject)=>{
			this.request("estimateTransaction", [txParamsArg], (error:any, result:any)=>{
				if(error)
					return reject(error);
				resolve(result);
			})
		})
	}

	/**
	 * Generates encrypted wallet data.
	 * @param password user's chosen password
	 * @returns Promise that resolves to object-like string. Suggested to store as string for .import().
	 */
	export (password: string): Promise <string> {
		return new Promise((resolve, reject)=>{
			this.request("export", [password], (error:any, result:any)=>{
				if(error)
					return reject(error);
				resolve(result);
			})
		})
	}

	
}


export {WalletWrapper}