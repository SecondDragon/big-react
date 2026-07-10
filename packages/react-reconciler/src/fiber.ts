import { Key, Props, ReactElementType, Ref } from 'shared/ReactTypes';
import { FunctionComponent, HostComponent, WorkTag } from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
export class FiberNode {
	type: any; //
	tag: WorkTag;
	pendingProps: Props;
	key: Key;

	/**
	 * HostComponent类型的由真实dom节点的ReactElement转化而来，指向真实的dom节点
	 *
	 * FunctionComponent类型的由函数组件的ReactElement转化而来，指向null
	 *
	 * HostRoot类型的由我们自己在调用createContainer时生成，指向FiberRootNode节点
	 */
	stateNode: any;
	// ref: Ref;
	/**
	 * 指向父级FiberNode,通过它可以一级级的找到管理员，然后从管理员处开始更新
	 */
	return: FiberNode | null;
	/**
	 * 找到临近的兄弟FiberNode节点，一般是为了遍历
	 */
	sibling: FiberNode | null;
	/**
	 * 指向子FiberNode节点。一般是更新时一级一级往下更新
	 */
	child: FiberNode | null;
	index: number;
	memoizedProps: Props | null;
	/**
	 * HostRoot类型的 memoizedState 是一个 ReactElement
	 * 其余
	 */
	memoizedState: any;
	updateQueue: unknown;
	/**
	 * 指向备用fiberNode，两者互为备用，第一次挂载时为null
	 */
	alternate: FiberNode | null;
	/**
	 * 标记副作用
	 */
	flags: Flags;
	subtreeFlags: Flags;

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		this.tag = tag;
		this.pendingProps = pendingProps;
		this.key = key;

		this.stateNode = null; //此fiber对应的真实DOM节点  h1=>真实的h1DOM

		// fiber类型，来自于 虚拟DOM节点的type  span div p
		this.type = null;

		this.return = null; // 此fiber的父级fiber
		this.sibling = null; // 指向下一个兄弟fiber
		this.child = null; //指向第一个子节点
		this.index = 0; // 子节点的索引

		// 工作单元
		this.memoizedProps = null; // 已处理的属性（已应用到真实DOM节点上的属性）
		this.memoizedState = null; // 已处理的状态（已应用到真实DOM节点上的状态）
		this.updateQueue = null; // 工作单元队列

		this.alternate = null; // 指向当前fiber的备份fiber
		// react实际有两个fiber树，一个是当前正在进行更改以待后续进行渲染的树，
		// 一个是备份树（已经渲染完成的树）。当渲染完成后，会将当前树赋值给备份树，
		// 而当前树则会被用于下一次渲染。

		/* this.flags  此fiber的副作用标记。标记该fiber是否有副作用。及副作用的类型，是要进行什么操作*/
		this.flags = NoFlags;
		// 子fiber的副作用标记，如果一个fiber节点的子fiber节点有副作用，那么父节点必须知道，一直向上一级一级的冒泡
		this.subtreeFlags = NoFlags;
	}
}
// Container 一般是dom节点，但是react可能不在web中渲染，所以不一定，类型才没有使用DOM
export class FiberRootNode {
	container: Container;
	current: FiberNode;
	// 指向更新完成后的fiber树的根节点 也就是 hostRootFiber
	finishedWork: FiberNode | null;

	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
	}
}

export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	let wip = current.alternate;
	if (wip === null) {
		// 首屏渲染，alternate为空
		wip = new FiberNode(current.tag, pendingProps, current.key);
		// 这时两者的stateNode都指向同一个对象了
		wip.stateNode = current.stateNode;
		// 两棵树互相指向对方
		wip.alternate = current;
		current.alternate = wip;
	} else {
		// 更新的操作
		wip.pendingProps = pendingProps;
		// 重置副作用标记 清空上一轮工作循环积累的副作用标记，防止残留标记污染新一轮的 commit 判断。
		wip.flags = NoFlags;
	}
	wip.type = current.type;
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	return wip;
};

export function createFiberFromElement(element: ReactElementType) {
	const { type, key, props } = element;
	let fiberTag: WorkTag = FunctionComponent;
	if (typeof type === 'string') {
		fiberTag = HostComponent;
	} else if (typeof type !== 'function' && __DEV__) {
		console.warn('未定义的type类型', element);
	}
	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	console.log('createFiberFromElement----element', element);
	console.log('createFiberFromElement----fiber', fiber);

	return fiber;
}
