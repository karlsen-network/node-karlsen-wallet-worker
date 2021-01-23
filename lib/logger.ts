import {FlowLogger} from '@aspectron/flow-logger';
export const workerLog = new FlowLogger('WalletWorker', {
	display : ['name', 'level', 'time'],
	color: ['name', 'level', 'time']
});

workerLog.enable('all');
