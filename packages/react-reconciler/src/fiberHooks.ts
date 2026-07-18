import { FiberNode } from './fiber';
import { Action } from 'shared/ReactTypes';
import internals from 'shared/internals';
import { Dispatch, Dispatcher } from 'react/src/currentDispatcher';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';

/**
 * 当前正在渲染的函数组件 fiber。
 * mountState / updateState 通过此变量感知当前环境，
 * dispatchSetState 通过闭包绑定了触发时的 fiber。
 */
let currentlyRenderingFiber: FiberNode | null = null;

/**
 * mount 时：指向当前正在构建的 Hook 链表的最后一个节点。
 * update 时：同上，但每次调用 updateWorkInProgressHook 时前进。
 */
let workInProgressHook: Hook | null = null;

/**
 * update 时：指向旧 fiber(current) 的 Hook 链表中当前正在对比的节点。
 * 用于 updateWorkInProgressHook 中按顺序取出对应的旧 Hook。
 */
let currentHook: Hook | null = null;
let renderLane: Lane = NoLane;
const { currentDispatcher } = internals;

interface Hook {
	memoizedState: unknown;
	updateQueue: unknown;
	next: Hook | null;
}

/**
 * 函数组件的执行环境初始化。
 * 1. 设置 currentlyRenderingFiber，重置 wip.memoizedState（清空 Hook 链表）
 * 2. 根据 wip.alternate 决定 Dispatcher：
 *    - 有 alternate → HookDispatcherOnUpdate（updateState）
 *    - 无 alternate → HookDispatcherOnMount（mountState）
 * 3. 执行 Component(props)，拿到返回的 ReactElement
 * 4. 重置全局变量（防止对后续渲染的污染）
 *
 * @param wip 函数组件的 workInProgress fiber
 * @param lane
 * @returns Component(props) 的返回值（ReactElement 或原始值）
 */
export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 赋值操作
	currentlyRenderingFiber = wip;
	wip.memoizedState = null;
	renderLane = lane;
	const current = wip.alternate;
	if (current !== null) {
		// 	更新
		currentDispatcher.current = HookDispatcherOnUpdate;
	} else {
		console.log();
		//在这里设置全局现在的Dispatcher
		currentDispatcher.current = HookDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	//算出新的 ReactElement
	const children = Component(props);

	// 重置操作
	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState
};
const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState
};

/**
 * update 时的 useState 实现。
 * 1. updateWorkInProgressHook → 从 current fiber 的 Hook 链表中取对应位置的 Hook，克隆到 wip
 * 2. 检查 queue.shared.pending 是否有待处理的 update
 * 3. 有则 processUpdateQueue 计算新 state，否则保持旧值
 *
 * @returns [当前 state, dispatch 函数]
 */
function updateState<State>(): [State, Dispatch<State>] {
	const hook = updateWorkInProgressHook();

	// 计算新的State
	const queue = hook.updateQueue as UpdateQueue<State>;
	const pending = queue.shared.pending;
	queue.shared.pending = null;
	if (pending !== null) {
		const { memoizedState } = processUpdateQueue(
			hook.memoizedState as State,
			pending,
			renderLane
		);
		hook.memoizedState = memoizedState;
	}

	// @ts-ignore
	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

/**
 * mount 时的 useState 实现。
 * 1. mountWorkInProgressHook → 创建新的 Hook 节点，追加到当前 fiber 的 Hook 链表尾
 * 2. 处理 initialState（支持惰性初始化函数）
 * 3. 创建 updateQueue 并生成 dispatch（闭包绑定 fiber + queue）
 *
 * @param initialState 初始值或惰性初始化函数
 * @returns [state, dispatch]
 */
function mountState<State>(
	initialState: (() => State) | State
): [State, Dispatch<State>] {
	const hook = mountWorkInProgressHook();
	let memoizedState: State;
	// 这里不能使用 typeof initialState === 'function'.
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}
	const queue = createUpdateQueue<State>();
	hook.updateQueue = queue;
	hook.memoizedState = memoizedState; // 这样hook上次获取的数据就存下来了,后续更新是就好根据之前的数据进行计算了

	// @ts-ignore 这里我们之所以dispatchSetState.bind(null, currentlyRenderingFiber, queue);，是因为我们之后dispatch是可以传出组件外的，在组件外也要能执行
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
	queue.dispatch = dispatch;
	return [memoizedState, dispatch];
}

/**
 * setState 的 dispatch 函数实现（通过闭包 bind 了 fiber 和 queue）。
 *
 * 执行流程：
 * 1. createUpdate(action) → 包装 action
 * 2. enqueueUpdate → 写入 queue.shared.pending
 * 3. scheduleUpdateOnFiber(fiber) → 从该 fiber 向上找到 FiberRootNode，触发整个工作循环
 *
 * @param fiber 该 Hook 所属的函数组件 fiber（通过 bind 隐式传递）
 * @param updateQueue 该 Hook 的更新队列（通过 bind 隐式传递）
 * @param action setState 的参数：新值 或 (prevState)→新值 的函数
 */
function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	const lane = requestUpdateLane();
	const update = createUpdate(action, lane);
	enqueueUpdate(updateQueue, update);
	scheduleUpdateOnFiber(fiber, lane);
}

/**
 * update 时从 current fiber 的 Hook 链表中按顺序取出对应位置的 Hook，
 * 克隆其 memoizedState 和 updateQueue，添加到 wip fiber 的 Hook 链表中。
 *
 * 如果旧 Hook 链表长度不足（nextCurrentHook === null），说明 mount 和 update
 * 调用了不同数量的 hook，抛出错误（React 不允许条件调用 hook 的原因）。
 */
function updateWorkInProgressHook(): Hook {
	// TODO:render阶段触发的更新还没处理

	let nextCurrentHook: Hook | null = null;
	// 	FC update 时的第一个Hook
	if (currentHook === null) {
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			nextCurrentHook = current?.memoizedState;
		} else {
			nextCurrentHook = null;
		}
	} else {
		nextCurrentHook = currentHook.next;
	}

	/**
	 * 探讨一种问题
	 * 如果 nextCurrentHook === null 是什么情况
	 * 答：
	 * 组件内mount和update中调用了不同数量的hook
	 *
	 * mount：u1、u2、u3
	 * update：u1、u2、u3、u4
	 *
	 * 这往往是没把hook函数放进最顶层导致的（比如放进了分支语句（if）中）
	 */

	if (nextCurrentHook === null) {
		// mount/update u1 u2 u3
		// update       u1 u2 u3 u4
		throw new Error(
			`组件 ${currentlyRenderingFiber?.type.name} 本次执行时的Hook比上次执行时多`
		);
	}

	currentHook = nextCurrentHook as Hook;
	const newHook: Hook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		next: null
	};
	if (workInProgressHook === null) {
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = newHook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		//我们生成的就是workInProgressHook mount时这个hook的下一个hook
		workInProgressHook.next = newHook;
		workInProgressHook = newHook;
	}
	return workInProgressHook;
}
/**
 * mount 时创建一个新的 Hook 节点，追加到当前 fiber 的 Hook 链表尾部。
 * 如果是第一个 Hook，则赋给 currentlyRenderingFiber.memoizedState 作为链表头。
 *
 * 必须在 currentlyRenderingFiber !== null 时调用（即函数组件内），否则抛错。
 */
function mountWorkInProgressHook(): Hook {
	const hook: Hook = { memoizedState: null, updateQueue: null, next: null };
	if (workInProgressHook === null) {
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = hook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		//我们生成的就是workInProgressHook mount时这个hook的下一个hook
		workInProgressHook.next = hook;
		workInProgressHook = hook;
	}

	return workInProgressHook;
}
