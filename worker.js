"use strict";
//Object.defineProperty(exports, "__esModule", { value: true });
console.log("in worker");
const {WorkerCore} = require("./dist/lib/worker-core");
let core = new WorkerCore();
console.log("WorkerCore started", core);
