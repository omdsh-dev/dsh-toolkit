/**
 * 正则执行 worker —— 把 test/find/replace 的同步正则执行隔离到可终止的线程。
 *
 * 宿主（index.ts）在 WORKER_BUDGET_MS 到期后调用 worker.terminate()，
 * 使灾难性回溯（ReDoS）无法阻塞宿主进程；本文件内通过 executeAction 再次
 * 执行输入/pattern/replacement/输出全部上限校验。
 *
 * 说明：worker 入口依赖 Node 对 .ts 的原生 type-stripping（构建产物为 .js，
 * 两处均可用同一套源码逻辑）。
 */
export {};
