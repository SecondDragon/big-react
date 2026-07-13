import { FiberNode } from './fiber';
import { Action } from 'shared/ReactTypes';
import internals from 'shared/internals';
import { Dispatch, Dispatcher } from 'react/src/currentDispatcher';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

/**
 * 当前fiberNode。这样我们的hook就知道从哪里取值了
 */
let currentlyRenderingFiber: FiberNode | null = null;

let workInProgressHook: Hook | null = null;

const { currentDispatcher } = internals;

interface Hook {
	memoizedState: unknown;
	updateQueue: unknown;
	next: Hook | null;
}

/**
 * 在执行函数式组件的函数前先确定环境
 * @param wip
 */
export function renderWithHooks(wip: FiberNode) {
	// 赋值操作
	currentlyRenderingFiber = wip;
	wip.memoizedState = null;
	const current = wip.alternate;
	if (current !== null) {
		// 	更新
	} else {
		console.log();
		//在这里设置全局现在的Dispatcher
		currentDispatcher.current = HookDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	const children = Component(props);

	// 重制操作
	currentlyRenderingFiber = null;
	return children;
}

const HookDispatcherOnMount: Dispatcher = {
	useState: mountState
};

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

function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	const update = createUpdate(action);
	enqueueUpdate(updateQueue, update);
	scheduleUpdateOnFiber(fiber);
}

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
