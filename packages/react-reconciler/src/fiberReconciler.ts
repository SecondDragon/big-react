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

export function createContainer(container: Container) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null);
	/**
	 * 这里就实现了创建hostRootFiber和创建FiberRootNode，让他们互相指向
	 */
	const root = new FiberRootNode(container, hostRootFiber);
	// 创建hostRootFiber的更新队列
	hostRootFiber.updateQueue = createUpdateQueue();
	return root;
}

/**
 * 更新容器
 * @param element 传入 ReactElementType 实际是一个 ReactElement
 * @param root
 */
export function updateContainer(
	element: ReactElementType,
	root: FiberRootNode
) {
	const hostRootFiber = root.current;

	const update = createUpdate<ReactElementType | null>(element);
	enqueueUpdate(
		hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
		update
	);
	// 调度更新
	scheduleUpdateOnFiber(hostRootFiber);
	return element;
}
