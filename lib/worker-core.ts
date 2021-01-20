import {Wallet} from 'kaspa-wallet';
import {RPC, Client, IRPC} from './rpc';
import {EventEmitter} from './event-emitter';

export class WorkerCore extends EventEmitter{
	rpc:IRPC;
	wallet:Wallet|undefined;

	constructor(){
		super();
		this.rpc = new RPC({
			client: new Client(this)
		})
	}
	init(){
		this.initWalletHanler();
		addEventListener("message", (event)=>{
			let {data:msg} = event;
			if(!msg || !msg.op)
				return
			console.log("event", msg)

			let {op, data} = msg;
			this.emit(op, data);
		})
	}
	initWalletHanler(){
		this.on('wallet-init', (msg)=>{
			console.log("wallet-init", msg)
			const {
				privKey,
				seedPhrase,
				networkOptions,
				options
			} = msg;
			networkOptions.rpc = this.rpc;

			this.wallet = new Wallet(privKey, seedPhrase, networkOptions, options);
			console.log("core.wallet", this.wallet)
		})
	}
}