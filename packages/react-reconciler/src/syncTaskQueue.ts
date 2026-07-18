let syncQueue: ((...args: any) => void)[] | null = null;
let isFlushingSyncQueue = false;

/**
 * 将一个同步任务加入全局同步任务队列。
 *
 * 执行流程：
 * 1. 如果同步任务队列尚未创建，则创建数组并把当前 callback 作为第一个任务。
 * 2. 如果队列已经存在，则使用 push 按注册顺序追加当前 callback。
 *
 * 例如，调用 scheduleSyncCallback(callbackA) 后，syncQueue 为 [callbackA]；
 * 随后调用 scheduleSyncCallback(callbackB)，syncQueue 变为 [callbackA, callbackB]。
 * flushSyncCallbacks 执行时会先调用 callbackA，再调用 callbackB。
 *
 * 最终效果是：多个同步更新可以先集中到同一个队列中，再由统一的刷新过程按顺序执行。
 */
export function scheduleSyncCallback(callback: (...args: any) => void) {
	if (syncQueue === null) {
		syncQueue = [callback];
	} else {
		syncQueue.push(callback);
	}
}

/**
 * 按注册顺序执行并清空当前同步任务队列。
 *
 * 执行流程：
 * 1. 只有在当前没有执行刷新，并且 syncQueue 不为空时才开始执行，避免 flushSyncCallbacks 重入。
 * 2. 设置 isFlushingSyncQueue 为 true，使用 forEach 依次执行队列中的每个 callback。
 * 3. 如果某个 callback 抛出异常，则在开发环境打印错误；随后通过 finally 恢复状态并清空队列。
 *
 * 例如，syncQueue 为 [callbackA, callbackB]：
 * ① isFlushingSyncQueue 从 false 变为 true；
 * ② 先执行 callbackA，再执行 callbackB；
 * ③ 执行结束后 isFlushingSyncQueue 恢复为 false，syncQueue 恢复为 null。
 * 如果 callbackA 抛出异常，forEach 会停止继续执行后续 callback，仍然会进入 finally 完成清理。
 * 如果 callbackA 内部再次调用 flushSyncCallbacks，由于刷新标记为 true，嵌套调用会直接跳过。
 *
 * 最终效果是：当前批次的同步任务只会被刷新一次，并在刷新完成后释放队列状态。
 */
export function flushSyncCallbacks() {
	if (!isFlushingSyncQueue && syncQueue) {
		isFlushingSyncQueue = true;
		try {
			syncQueue.forEach((callback) => callback());
		} catch (e) {
			if (__DEV__) {
				console.error('flushSyncCallbacks出错', e);
			}
		} finally {
			isFlushingSyncQueue = false;
			syncQueue = null;
		}
	}
}
