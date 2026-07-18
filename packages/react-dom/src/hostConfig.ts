import { FiberNode } from 'react-reconciler/src/fiber';
import { HostText } from 'react-reconciler/src/workTags';
import {
	DOMElement,
	updateFiberProps as updateFiberPropsFn
} from './SyntheticEvent';

export type Container = Element;

export type Instance = Element;
export type TextInstance = Text;

export const updateFiberProps = updateFiberPropsFn;

/**
 * 创建 DOM 元素。对应 completeWork 中 HostComponent 的 mount 处理。
 * @param type 标签名，如 'div'/'span'
 */
export const createInstance = (type: string, props: any): Instance => {
	// export const createInstance = (type: string): Instance => {
	// TODO 处理props
	const element = document.createElement(type) as unknown;
	updateFiberProps(element as DOMElement, props);
	return element as DOMElement;
};

/**
 * 将子 DOM 节点追加到父 DOM 节点下。
 * 在 completeWork 的 appendAllChildren 中使用，离屏组装 DOM 子树。
 */
export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	parent.appendChild(child);
};

/** 创建文本 DOM 节点 */
export const createTextInstance = (content: string) => {
	return document.createTextNode(content);
};

/** commit 阶段，将完成好的 DOM 子树一次性追加到容器中 */
export const appendChildToContainer = appendInitialChild;

/**
 * commit 阶段，提交 fiber 的属性更新。
 * 目前仅支持 HostText（文本内容更新），HostComponent 属性更新标记 TODO。
 */
export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.memoizedProps?.content;
			// stateNode指向dom实例
			return commitTextUpdate(fiber.stateNode, text);
		// case HostComponent:
		// 	return updateFiberProps(fiber.stateNode, fiber.memoizedProps);
		default:
			if (__DEV__) {
				console.warn('未实现的Update类型', fiber);
			}
			break;
	}
}

/** 更新文本节点的 textContent */
export function commitTextUpdate(textInstance: TextInstance, content: string) {
	textInstance.textContent = content;
}

/** 从容器中移除子 DOM 节点 */
export function removeChild(
	child: Instance | TextInstance,
	container: Container
) {
	container.removeChild(child);
}

/*** 在 before 节点前插入 child 节点 */
export function insertChildToContainer(
	child: Instance,
	container: Container,
	before: Instance
) {
	container.insertBefore(child, before);
}

/**
 * 为 reconciler 提供宿主环境的异步任务调度能力。
 *
 * 执行流程：
 * 1. 优先使用 queueMicrotask，把 callback 放入当前任务结束后的 microtask 队列。
 * 2. 如果运行环境不支持 queueMicrotask，则使用 Promise.then 实现同样的异步调度。
 * 3. 如果 queueMicrotask 和 Promise 都不可用，则退化为 setTimeout，保证 callback 仍能被异步执行。
 *
 * 例如，reconciler 先通过 scheduleSyncCallback 注册 callbackA 和 callbackB，
 * 再调用 scheduleMicroTask(flushSyncCallbacks)：
 * ① 当前 JavaScript 调用栈继续执行，不会立即刷新 syncQueue；
 * ② 当前任务结束后，优先由 queueMicrotask 或 Promise 调用 flushSyncCallbacks；
 * ③ flushSyncCallbacks 按顺序执行 callbackA 和 callbackB，并清空同步任务队列；
 * ④ 只有在前两种 microtask API 都不可用时，才会由 setTimeout 在后续任务中执行刷新。
 *
 * 最终效果是：reconciler 可以把同步任务的刷新安排到当前调用栈结束后，
 * 同时通过宿主环境提供的降级策略兼容不同运行环境。
 */
export const scheduleMicroTask =
	typeof queueMicrotask === 'function'
		? queueMicrotask
		: typeof Promise === 'function'
		? (callback: (...args: any) => void) => Promise.resolve(null).then(callback)
		: setTimeout;

/** 通过 display:none 隐藏 DOM 元素（OffscreenComponent 使用） */
export function hideInstance(instance: Instance) {
	const style = (instance as HTMLElement).style;
	style.setProperty('display', 'none', 'important');
}

/** 恢复被 hideInstance 隐藏的 DOM 元素 */
export function unhideInstance(instance: Instance) {
	const style = (instance as HTMLElement).style;
	style.display = '';
}

/** 清空文本节点内容（OffscreenComponent 使用） */
export function hideTextInstance(textInstance: TextInstance) {
	textInstance.nodeValue = '';
}

/** 恢复被 hideTextInstance 清空的文本内容 */
export function unhideTextInstance(textInstance: TextInstance, text: string) {
	textInstance.nodeValue = text;
}
