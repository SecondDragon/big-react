import { FiberNode, FiberRootNode } from './fiber';
import { Container } from 'hostConfig';
import { HostRoot } from './workTags';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue
} from './updateQueue';
import { ReactElementType } from 'shared/ReactTypes';
import { scheduleUpdateOnFiber } from './workLoop';
import { requestUpdateLane } from './fiberLanes';

/**
 * 创建整个 React 应用的根容器。
 * 内部创建 HostRoot fiber + FiberRootNode，建立双向引用，
 * 并为 HostRoot 初始化空的 updateQueue。
 *
 * @param container 真实的 DOM 容器（如 document.querySelector('#root')）
 * @returns FiberRootNode 实例
 */
export function createContainer(container: Container) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null);
	const root = new FiberRootNode(container, hostRootFiber);
	hostRootFiber.updateQueue = createUpdateQueue();
	return root;
}

/**
 * 将 ReactElement 更新到容器中。这是 ReactDOM.createRoot().render() 的底层实现。
 *
 * 流程：
 * 1. 取出 HostRoot fiber
 * 2. 将 ReactElement（如 <App/>）包装成 Update 入队到 HostRoot 的 updateQueue
 * 3. 调用 scheduleUpdateOnFiber 触发整个工作循环
 *
 * @param element render 传入的 ReactElement，如 <App/> 对应的 {'$$typeof': Symbol, type: App, props: {}}
 * @param root createContainer 返回的 FiberRootNode
 */
export function updateContainer(
	element: ReactElementType,
	root: FiberRootNode
) {
	const hostRootFiber = root.current;
	const lane = requestUpdateLane();
	const update = createUpdate<ReactElementType | null>(element, lane);
	enqueueUpdate(
		hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
		update
	);
	// 调度更新
	scheduleUpdateOnFiber(hostRootFiber, lane);
	return element;
}
