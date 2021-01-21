export const CB = (msg:any)=>{};
export type CB_FUNC = typeof CB;

export class EventEmitter{
	eventListeners:Map<string, CB_FUNC[]> = new Map();
	constructor(){
		this.init();
	}
	init(){
		/*
		addEventListener("message", (event)=>{
			let {data:msg} = event;
			if(!msg || !msg.op)
				return
			console.log("event", event)

			let {op, data} = msg;
			this.emit(op, data);
		})
		*/
	}
	on(eventName:string, fn:CB_FUNC){
		let list:CB_FUNC[]|undefined = this.eventListeners.get(eventName);
		if(!list){
			list = [];
			this.eventListeners.set(eventName, list);
		}
		list.push(fn)
	}
	emit(eventName:string, data:any){
		let list:CB_FUNC[]|undefined = this.eventListeners.get(eventName);
		if(!list)
			return
		list.map(fn=>{
			fn(data);
		})
	}
	postMessage(op:string, data:any={}){
		//@ts-ignore
		postMessage({op, data});
	}
}
