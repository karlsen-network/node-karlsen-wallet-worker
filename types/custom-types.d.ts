export * from '@karlsen/wallet/types/rpc';

import {RPC} from '@karlsen/wallet/types/rpc';

export interface SubscriberItem{
  uid:string;
  callback:function;
}

export declare type SubscriberItemMap = Map<string, SubscriberItem[]>;
