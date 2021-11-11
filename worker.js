"use strict";
//Object.defineProperty(exports, "__esModule", { value: true });
console.log("in worker");
const {WorkerCore, workerLog} = require("./dist/lib/worker-core");
let core = new WorkerCore();
console.log("WorkerCore started", core);
navigator.__core = core;
navigator.__workerLog = workerLog;
//workerLog.enable('all')