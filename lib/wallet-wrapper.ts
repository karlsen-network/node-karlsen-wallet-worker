//const threads = require('worker_threads');

const Worker = require('web-worker');
import {Wallet} from 'kaspa-wallet';

const Url = require('url');
const ISNODE = true;

let baseURL = Url.pathToFileURL(__dirname + '/');//TODO

import {
	Network, NetworkOptions, SelectedNetwork, WalletSave, Api, TxSend, TxResp,
	PendingTransactions, WalletCache, IRPC, RPC, WalletOptions,	WalletOpt
} from 'kaspa-wallet/types/custom-types';

class WalletWrapper {
	
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
	rpc:IRPC|undefined;

	constructor(privKey: string, seedPhrase: string, networkOptions: NetworkOptions, options: WalletOptions = {}){
		this.initWorker();

		let {rpc} = networkOptions;
		if(rpc)
			this.rpc = rpc;
		delete networkOptions.rpc;

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
		worker.onmessage = (msg:{op:string, data:any})=>{
			const {op, data} = msg;
			if(op == "rpc")
				return this.handleRPCProxy(data);

		}
	}

	async handleRPCProxy(msg:{fn:string, args:any, rid?:string}){
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
			this.rpc[fn].call(this, ...args)
			return
		}


		if(fn=='call' && /^notify/.test(args[0])){
			args.push((result:any)=>{
				this.postMessage("rpc-pub", {method:args[0], rid, result})
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

		this.postMessage("rpc-result", {rid, subUid, result, error})
	}

	postMessage(op:string, data:any){
		console.log("postMessage:: op: %s, data: %s", op, JSON.stringify(data))
		this.worker.postMessage({op, data})
	}

	
}


export {WalletWrapper}