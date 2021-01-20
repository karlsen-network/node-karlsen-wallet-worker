export * from 'kaspa-wallet/types/rpc';

import {RPC} from 'kaspa-wallet/types/rpc';

export interface SubscriberItem{
  uid:string;
  callback:function;
}

export declare type SubscriberItemMap = Map<string, SubscriberItem[]>;

export declare class Client{
	constructor(options: any);
	onConnect(callback: Function): void;
    onConnectFailure(callback: Function): void;
    onError(callback: Function): void;
    onDisconnect(callback: Function): void;
    disconnect(): void;
    clearPending(): void;
    close(): void;
    createStream(): any;
    initIntake(stream: IStream): void;
    handleIntake(o: IData): void;
    setIntakeHandler(fn: Function): void;
    post(name: string, args?: any): boolean;
    call(method: string, data: any): Promise<unknown>;
    subscribe<T>(subject: string, data: any, callback: Function): RPC.SubPromise<T>;
    subject2EventName(subject: string): string;
    unSubscribe(subject: string, uid?: string): void;
    connect(): void;
}