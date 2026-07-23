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
import { Flags, PassiveEffect } from './fiberFlags';
import { HookHasEffect, Passive } from './hookEffectTags';

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

export interface Effect {
	tag: Flags;
	// 回调函数
	create: EffectCallback | void;
	// 清理函数
	destroy: EffectCallback | void;
	// 依赖项
	deps: HookDeps;
	next: Effect | null;
}

export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
	lastRenderedState: State;
}

type EffectCallback = () => void;
export type HookDeps = any[] | null;

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
	// 重置hooks链表
	wip.memoizedState = null;
	// 重置effect链表（wip.alternate 中的还在，所以后续比较没问题）
	wip.updateQueue = null;
	renderLane = lane;
	const current = wip.alternate;
	if (current !== null) {
		// 	更新
		currentDispatcher.current = HookDispatcherOnUpdate;
	} else {
		// console.log();
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
	useState: mountState,
	useEffect: mountEffect
};
const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect
};

/**
 * deps 传进来的，好简单，直接拿上一轮的进行对比就行了
 * @param create
 * @param deps
 */
function mountEffect(create: EffectCallback | void, deps: HookDeps | void) {
	// 取到当前hook（mount时就是新建）
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;

	(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}

/**
 * update 时的 useEffect 实现。与 mountEffect 的核心差异：需要对比 deps 决定是否真正执行。
 *
 * 执行流程：
 * 1. updateWorkInProgressHook → 从 current fiber 的 Hook 链表中克隆对应位置的 Hook
 * 2. 从 currentHook.memoizedState 中取出上一次渲染保存的 Effect（prevEffect）
 * 3. 继承 prevEffect.destroy（上次的清理函数，本次 commit 前会先执行）
 * 4. 若 nextDeps !== null，调用 areHookInputsEqual 浅比较新旧 deps
 *    - deps 未变化 → pushEffect(Passive, ...)，不带 HookHasEffect，commit 时跳过执行
 *    - deps 已变化 → 标记 fiber.flags |= PassiveEffect，pushEffect(Passive | HookHasEffect, ...)
 * 5. 若 nextDeps === null（无依赖数组）→ 每次都执行，直接走步骤 4 的"已变化"分支
 *
 * 具体举例：
 *   组件代码：
 *     const [count, setCount] = useState(0);
 *     useEffect(() => {
 *       console.log('effect');
 *       return () => console.log('cleanup');
 *     }, [count]);
 *
 *   第一次渲染（mount）：
 *     → mountEffect → pushEffect(Passive | HookHasEffect, create, undefined, [0])
 *     → commit 阶段执行 create()，destroy = cleanup
 *
 *   点击按钮 setCount(1) → 第二次渲染（update）：
 *     → updateWorkInProgressHook 克隆 Hook
 *     → prevEffect = currentHook.memoizedState = { deps: [0], destroy: cleanup, ... }
 *     → nextDeps = [1]
 *     → areHookInputsEqual([1], [0]) → false（Object.is(1, 0) = false）
 *     → fiber.flags |= PassiveEffect
 *     → pushEffect(Passive | HookHasEffect, create, cleanup, [1])
 *     → commit 阶段：先执行 cleanup()，再执行 create()
 *
 *   再次点击 setCount(1) → 第三次渲染（update）：
 *     → nextDeps = [1]，prevDeps = [1]
 *     → areHookInputsEqual([1], [1]) → true
 *     → pushEffect(Passive, create, cleanup, [1])  // 无 HookHasEffect
 *     → commit 阶段：检测到无 HookHasEffect，跳过执行
 *
 * 结论：
 *   updateEffect 通过 deps 对比实现了 useEffect 的"按需执行"。destroy 的继承
 *   保证了每次执行新 effect 前，先清理上一次的副作用。
 *
 * @param create useEffect 的第一个参数（回调函数）
 * @param deps 依赖数组，undefined 表示每次 render 都执行
 */
function updateEffect(create: EffectCallback | void, deps: HookDeps | void) {
	const hook = updateWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	let destroy: EffectCallback | void;

	if (currentHook !== null) {
		const prevEffect = currentHook.memoizedState as Effect;
		destroy = prevEffect.destroy;

		if (nextDeps !== null) {
			// 浅比较依赖
			const prevDeps = prevEffect.deps;
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				// 浅比较相等、不需要执行Passive
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
		}
		// 浅比较 不相等
		(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
		hook.memoizedState = pushEffect(
			Passive | HookHasEffect,
			create,
			destroy,
			nextDeps
		);
	}
}

/**
 * 浅比较两次渲染的 useEffect 依赖数组，判断 deps 是否发生变化。
 * 使用 Object.is 逐个对比元素，长度不一致或任一元素不同则返回 false。
 *
 * 执行流程：
 * 1. 边界检查：prevDeps 或 nextDeps 为 null → 返回 false（视为变化）
 * 2. 遍历数组，取两者较短长度，逐个用 Object.is 对比
 * 3. 全部相等 → 返回 true；任一不等 → 返回 false
 *
 * 具体举例：
 *   场景 ①：deps 均为 null
 *     prevDeps = null, nextDeps = null
 *     → prevDeps === null → return false（视为变化，需要执行 effect）
 *
 *   场景 ②：deps 长度不同
 *     prevDeps = [1], nextDeps = [1, 2]
 *     → 遍历到 i=0：Object.is(1, 1) → continue
 *     → i=1：prevDeps[1] 为 undefined，但循环条件 i < prevDeps.length 不成立
 *     → 循环结束，return true
 *     ⚠️ 注意：此实现与 React 官方一致，长度不同但前缀相同时返回 true
 *        （依赖数组长度在源码中由 hook 调用顺序保证一致，此处仅做防御）
 *
 *   场景 ③：deps 内容相同
 *     prevDeps = [1, 'a'], nextDeps = [1, 'a']
 *     → i=0：Object.is(1, 1) → continue
 *     → i=1：Object.is('a', 'a') → continue
 *     → return true（deps 未变化，跳过 effect 执行）
 *
 *   场景 ④：deps 内容不同
 *     prevDeps = [1, {}], nextDeps = [1, {}]
 *     → i=0：Object.is(1, 1) → continue
 *     → i=1：Object.is({}, {}) → false（对象引用不同）
 *     → return false（deps 变化，需要执行 effect）
 *
 * 结论：
 *   该函数是 useEffect 性能优化的核心。deps 未变化时，updateEffect 会跳过
 *   新 Effect 的创建和 PassiveEffect 标记，避免 commit 阶段不必要的回调执行。
 *
 * @param nextDeps 本次渲染的依赖数组
 * @param prevDeps 上一次渲染的依赖数组（从 currentHook.memoizedState.deps 获取）
 * @returns true = deps 未变化；false = deps 已变化或任一 deps 为 null
 */
function areHookInputsEqual(nextDeps: HookDeps, prevDeps: HookDeps) {
	if (prevDeps === null || nextDeps === null) {
		return false;
	}
	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}
	return true;
}

/**
 * 将一个 Effect 节点插入到当前函数组件 fiber 的 updateQueue 中。
 * 所有 useEffect 的 Effect 通过环形单向链表串联，lastEffect 始终指向尾部。
 *
 * 执行流程：
 * 1. 创建 Effect 对象（tag / create / destroy / deps / next）
 * 2. 获取 currentlyRenderingFiber 的 updateQueue
 * 3. 若 updateQueue 不存在 → createFCUpdateQueue 创建，effect 自环，lastEffect 指向自身
 * 4. 若 updateQueue 存在但 lastEffect 为 null → effect 自环，lastEffect 指向自身
 * 5. 若已有 Effect 链表 → 尾插法：新 effect 接在尾部，同时指向头部，更新 lastEffect
 *
 * 具体举例：
 *   组件中连续调用两次 useEffect：
 *     useEffect(() => { console.log('A'); }, []);   // Effect_A
 *     useEffect(() => { console.log('B'); }, []);   // Effect_B
 *
 *   第一次 pushEffect(Effect_A)：
 *     fiber.updateQueue === null
 *     → 创建 FCUpdateQueue
 *     → Effect_A.next = Effect_A（自环）
 *     → lastEffect = Effect_A
 *     结果：A ──→ A
 *           ↑_____|
 *          lastEffect
 *
 *   第二次 pushEffect(Effect_B)：
 *     lastEffect = Effect_A
 *     firstEffect = Effect_A.next = Effect_A
 *     → Effect_A.next = Effect_B
 *     → Effect_B.next = Effect_A
 *     → lastEffect = Effect_B
 *     结果：A ──→ B ──→ A
 *           ↑           |
 *           |___________|
 *          lastEffect = B
 *
 * 结论：
 *   无论调用多少次 useEffect，fiber.updateQueue.lastEffect 始终指向最新插入的
 *   Effect 节点，通过 next 指针可以遍历整个环形链表。commit 阶段从
 *   lastEffect.next（头部）开始遍历，直到回到头部，即可按顺序执行所有 Effect。
 *
 * @param hookFlags 副作用标记（Passive | HookHasEffect 等）
 * @param create useEffect 的第一个参数（回调函数）
 * @param destroy 上一次渲染保存的清理函数（update 时从 prevEffect.destroy 继承）
 * @param deps 依赖数组
 * @returns 新创建的 Effect 节点
 */
function pushEffect(
	hookFlags: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: HookDeps
): Effect {
	const effect: Effect = {
		tag: hookFlags,
		create,
		destroy,
		deps,
		next: null
	};
	const fiber = currentlyRenderingFiber as FiberNode;
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue === null) {
		const updateQueue = createFCUpdateQueue();
		fiber.updateQueue = updateQueue;
		effect.next = effect;
		updateQueue.lastEffect = effect;
	} else {
		// 插入effect
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			const firstEffect = lastEffect.next;
			lastEffect.next = effect;
			effect.next = firstEffect;
			updateQueue.lastEffect = effect;
		}
	}
	return effect;
}

/**
 * 创建函数组件专用的更新队列（FCUpdateQueue）。
 * 在基础 UpdateQueue 之上扩展了 lastEffect 字段，用于串联 useEffect 的 Effect 链表。
 *
 * 执行流程：
 * 1. 调用 createUpdateQueue 创建基础 UpdateQueue（shared.pending = null, dispatch = null）
 * 2. 将其断言为 FCUpdateQueue 类型
 * 3. 初始化 lastEffect = null
 *
 * 具体举例：
 *   第一次调用 useEffect 时，fiber.updateQueue 为 null：
 *     → createFCUpdateQueue()
 *     → 返回 { shared: { pending: null }, dispatch: null, lastEffect: null }
 *     → fiber.updateQueue = 上述对象
 *     → 后续 pushEffect 将 Effect 挂到 lastEffect 上
 *
 * 结论：
 *   FCUpdateQueue 是 UpdateQueue 的超集，既支持 useState 的 shared.pending 更新，
 *   又通过 lastEffect 支持 useEffect 的 Effect 环形链表。
 *
 * @returns 初始化完成的 FCUpdateQueue 对象
 */
function createFCUpdateQueue<State>() {
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
	updateQueue.lastEffect = null;
	return updateQueue;
}

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
	// 	currentHook=== null,说明是这个fiber 在更新时的的第一个Hook 在执行
	if (currentHook === null) {
		// wip的alternate 就是旧的那个正在展现的fiber
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			// 从旧fiber树中拿到旧的链表
			nextCurrentHook = current?.memoizedState;
		} else {
			// 这个绝不会存在，因为这样的话根本就不会走进updateWorkInProgressHook（ai请帮忙判断对不对，不对的话请修正）
			nextCurrentHook = null;
		}
	} else {
		// currentHook 就是上一个 hook
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
	// 拿到上一轮的值
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
	// 无论如何都会根据上一轮的hook生成新的对象
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
