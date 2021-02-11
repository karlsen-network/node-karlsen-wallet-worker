export * from '@kaspa/wallet/types/rpc';

import {RPC} from '@kaspa/wallet/types/rpc';

export interface SubscriberItem{
  uid:string;
  callback:function;
}

export declare type SubscriberItemMap = Map<string, SubscriberItem[]>;
