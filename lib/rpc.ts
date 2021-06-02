import {IRPC, RPC as Rpc, SubscriberItem, SubscriberItemMap} from '../types/custom-types';
import {WorkerCore} from './worker-core';
export type CBItem = {uid?:string, cb:Function};
export const UID = ()=>(Math.random()*100000).toFixed(0)+Date.now();

export {IRPC};

export class Client{
	callbacks:Map<string, Function> = new Map();
	subscribers:SubscriberItemMap = new Map();
	pending:Map<string, {method:string, cb:Function}> = new Map();

	verbose:boolean = false;
	log:Function;
	core:WorkerCore;

	constructor(core:WorkerCore, options:any={}){
		this.core = core;
		this.log = Function.prototype.bind.call(
			console.log,
			console,
			`[Kaspa gRPCProxy]:`
		);

		//seperate callback for direct function
		this.core.on('rpc-direct', (msg:{rid:string, result:any})=>{
			const {rid, result} = msg;
			let CB:Function|undefined = this.callbacks.get(rid);
			this.log("rpc-direct", rid, result, CB)
			if(!CB)
				return
			CB(result);
		})

		this.core.on('rpc-response', (msg:{rid:string, result:any, error:any})=>{
			const {rid, result, error} = msg;
			let pending:{method:string, cb:Function}|undefined = this.pending.get(rid);
			if(!pending)
				return
			pending.cb(error, result);
			
			this.pending.delete(rid);
		})

		this.core.on('rpc-publish', (msg:{result:any, method:string})=>{
			const {result, method} = msg;
			let eventName = this.subject2EventName(method);
			this.verbose && this.log("subscribe:eventName", eventName)

			let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
			if(!subscribers || !subscribers.length)
				return

			subscribers.map(subscriber=>{
				subscriber.callback(result)
			})
		})
	}

	cleanup(){
		this.callbacks.clear();
		this.subscribers.clear();
		this.pending.clear();
	}

	addCB(key:string, cb:Function){
		let uid = UID();
		this.callbacks.set(uid, cb);
		return uid;
	}

	req(fn:string, args:any[], rid:string=''){
		this.core.postMessage("rpc-request", {fn, args, rid})
	}

	call(method:string, data:any={}, type:string="request", uid:string|undefined=undefined){
		return new Promise((resolve, reject)=>{
			let rid = uid || UID();
			this.pending.set(rid, {
				method,
				cb:(error:any, result:any=undefined)=>{
					if(error)
						return reject(error);
					resolve(result);
				}
			})
			this.req(type, [method, data], rid);
		})
	}

	onConnect(callback:Function){
		let rid = this.addCB("onConnect", callback);
		this.req("onConnect", [], rid);
	}
	onDisconnect(callback:Function){
		let rid = this.addCB("onDisconnect", callback);
		this.req("onDisconnect", [], rid);
	}
	onConnectFailure(callback:Function){
		let rid = this.addCB("onConnectFailure", callback);
		this.req("onConnectFailure", [], rid);
	}
	onError(callback:Function){
		let rid = this.addCB("onError", callback);
		this.req("onError", [], rid);
	}

	disconnect(){
		this.req("disconnect", []);
	}
	connect(){
		this.req("connect", []);
	}

	subscribe<T>(subject: string, data: any, callback: Function): Rpc.SubPromise<T>{
		let eventName = this.subject2EventName(subject);
		this.verbose && this.log("subscribe:eventName", eventName)

		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers){
			subscribers = [];
			this.subscribers.set(eventName, subscribers);
		}
		let uid = UID();
		subscribers.push({uid, callback});

		let p = this.call(subject, data, "subscribe", uid) as Rpc.SubPromise<T>;

		p.uid = uid;
		return p;
	}

	subject2EventName(subject:string){
		let eventName = subject.replace("notify", "").replace("Request", "Notification")
		return eventName[0].toLowerCase()+eventName.substr(1);
	}

	unSubscribe(subject:string, uid:string=''){
		this.req("unSubscribe", [subject, uid])
		let eventName = this.subject2EventName(subject);
		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers)
			return
		if(!uid){
			this.subscribers.delete(eventName);
		}else{
			subscribers = subscribers.filter(sub=>sub.uid!=uid)
			this.subscribers.set(eventName, subscribers);
		}
	}

}

export class RPC implements IRPC{
	client:Client;
	cleanup(){
		this.client.cleanup();
	}
	constructor(options:any={}){
		this.client = options.client;
	}
	onConnect(callback:Function){
		this.client.onConnect(callback);
	}
	onConnectFailure(callback:Function){
		this.client.onConnectFailure(callback);
	}
	onError(callback:Function){
		this.client.onError(callback);
	}
	onDisconnect(callback:Function){
		this.client.onDisconnect(callback);
	}
	disconnect(){
		this.client?.disconnect();
	}
	async connect(){
		return this.client?.connect();
	}
	unSubscribe(method:string, uid:string=''){
		return this.client.unSubscribe(method, uid);
	}
	subscribe<T, R>(method:string, data:any, callback:Rpc.callback<R>){
		return this.client.subscribe<T>(method, data, callback);
	}
	request<T>(method:string, data:any){
		return this.client.call(method, data) as Promise<T>;
	}

	subscribeChainChanged(callback:Rpc.callback<Rpc.ChainChangedNotification>){
		return this.subscribe<Rpc.NotifyChainChangedResponse, Rpc.ChainChangedNotification>("notifyChainChangedRequest", {}, callback);
	}
	subscribeBlockAdded(callback:Rpc.callback<Rpc.BlockAddedNotification>){
		return this.subscribe<Rpc.NotifyBlockAddedResponse, Rpc.BlockAddedNotification>("notifyBlockAddedRequest", {}, callback);
	}
	subscribeVirtualSelectedParentBlueScoreChanged(callback:Rpc.callback<Rpc.VirtualSelectedParentBlueScoreChangedNotification>){
		return this.subscribe<Rpc.NotifyVirtualSelectedParentBlueScoreChangedResponse, Rpc.VirtualSelectedParentBlueScoreChangedNotification>("notifyVirtualSelectedParentBlueScoreChangedRequest", {}, callback);
	}

	subscribeUtxosChanged(addresses:string[], callback:Rpc.callback<Rpc.UtxosChangedNotification>){
		return this.subscribe<Rpc.NotifyUtxosChangedResponse, Rpc.UtxosChangedNotification>("notifyUtxosChangedRequest", {addresses}, callback);
	}

	unSubscribeUtxosChanged(uid:string=''){
		this.unSubscribe("notifyUtxosChangedRequest", uid);
	}

	getBlock(hash:string){
		return this.request<Rpc.BlockResponse>('getBlockRequest', {hash, includeBlockVerboseData:true});
	}
	getTransactionsByAddresses(startingBlockHash:string, addresses:string[]){
		return this.request<Rpc.TransactionsByAddressesResponse>('getTransactionsByAddressesRequest', {
			startingBlockHash, addresses
		});
	}
	getUtxosByAddresses(addresses:string[]){
		return this.request<Rpc.UTXOsByAddressesResponse>('getUtxosByAddressesRequest', {addresses});
	}
	submitTransaction(tx: Rpc.SubmitTransactionRequest){
		return this.request<Rpc.SubmitTransactionResponse>('submitTransactionRequest', tx);
	}

	getVirtualSelectedParentBlueScore(){
		return this.request<Rpc.VirtualSelectedParentBlueScoreResponse>('getVirtualSelectedParentBlueScoreRequest', {});
	}

	getBlockDagInfo(){
		return this.request<Rpc.GetBlockDagInfoResponse>('getBlockDagInfoRequest', {});
	}
	subscribeVirtualDaaScoreChanged(callback:Rpc.callback<Rpc.VirtualDaaScoreChangedNotification>){
		return this.subscribe<Rpc.NotifyVirtualDaaScoreChangedResponse, Rpc.VirtualDaaScoreChangedNotification>("notifyVirtualDaaScoreChangedRequest", {}, callback);
	}
}