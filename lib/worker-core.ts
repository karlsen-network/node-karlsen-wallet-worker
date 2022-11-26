import {workerLog} from './logger';
import {Wallet as WalletImpl, initKaspaFramework} from '@kaspa/wallet';
import {TxSend, TxInfo} from '@kaspa/wallet/types/custom-types';
import {RPC, Client, IRPC} from './rpc';
import {EventEmitter} from './event-emitter';
export {workerLog}

class Wallet extends WalletImpl{
	emit(name:string, data:any={}){
		super.emit(name, data);
		//@ts-ignore
		postMessage({op:"wallet-events", data:{name, data}});
	}
}

export class WorkerCore extends EventEmitter{
	rpc:IRPC;
	wallet:Wallet|undefined;

	constructor(){
		workerLog.debug("WorkerCore:constructor1")
		super();
		this.rpc = new RPC({
			client: new Client(this)
		})
		workerLog.debug("WorkerCore:constructor2")
	}
	async init(){
		workerLog.debug("WorkerCore:init")
		super.init();
		workerLog.debug("before initKaspaFramework")
		await initKaspaFramework();
		workerLog.debug("after initKaspaFramework")
		addEventListener("message", (event)=>{
			let {data:msg} = event;
			let {op, data} = msg;
			if (op != "wallet-init"){
				workerLog.info(`worker op: ${op}, ${JSON.stringify(data)}`)
			}
			if(!op)
				return
			this.emit(op, data);
		})

		this.postMessage("ready");
		this.initWalletHanler();
	}
	initWalletHanler(){
		this.on('worker-log-level', (msg:{level:string})=>{
			workerLog.setLevel(msg.level)
		})
		this.on('wallet-init', (msg)=>{
			//@ts-ignore
			this.rpc.cleanup();
			const {
				privKey,
				seedPhrase,
				networkOptions,
				options
			} = msg;
			networkOptions.rpc = this.rpc;

			this.wallet = new Wallet(privKey, seedPhrase, networkOptions, options);
			//workerLog.info("core.wallet", this.wallet)
		})

		this.on("wallet-request", async (msg:{fn:string, rid:string, args:any[]})=>{
			let {fn, rid, args} = msg;
			let {wallet} = this;
			if(!wallet)
				return this.sendWalletResponse(rid, `Wallet not initilized yet. (subject:${fn})`);
			if(!fn)
				return this.sendWalletResponse(rid, "Invalid wallet request.");

			let func;
			//@ts-ignore
			if(typeof this[fn] == 'function'){
				//@ts-ignore
				func = this[fn].bind(this);
			//@ts-ignore
			}else if(typeof wallet[fn] == 'function'){
				//@ts-ignore
				func = wallet[fn].bind(wallet);
			//@ts-ignore
			}else if(typeof wallet[fn] != undefined){
				func = async ()=>{
					//@ts-ignore
					return wallet[fn];
				}
			}

			workerLog.debug(`wallet-request: ${fn} => ${func}`)

			if(!func){
				this.sendWalletResponse(rid, 
					"Invalid wallet request. No such wallet method available."
				);
				return
			}

			let error, result = func(...args);

			if(result instanceof Promise){
				result = await result
				.catch((err:any)=>{
					error = err;
				})
			}

			//@ts-ignore
			let errorMsg = error?.message||error;
			if (fn != "mnemonic"){
				workerLog.info(
					`Sending Wallet Response: \n`+
					`  FN: ${fn} \n`+
					`  error: ${errorMsg} \n`+
					`  result: ${JSON.stringify(result)} \n`
				)
			}
			this.sendWalletResponse(rid, error, result, fn);
		})
	}

	async estimateTransaction(txParamsArg: TxSend): Promise < TxInfo|null > {
		if(!this.wallet)
			return null;
		let data = await this.wallet.estimateTransaction(txParamsArg)
		delete data.tx;
		delete data.rawTx;
		delete data.utxos;
		return data;
	}

	sendWalletResponse(rid:string, error:any=undefined, result:any=undefined, fn:string|undefined=undefined){
		this.postMessage("wallet-response", {rid, fn, error, result});
	}
}
