import { Action } from 'shared/ReactTypes';
import { Lane } from './fiberLanes';

/** 一次更新请求 */
export interface Update<State> {
	action: Action<State>;
	next: Update<any> | null;
	lane: Lane;
}

/**
 * 更新队列。
 * shared.pending: 当前待处理的 update（简化版，非环形链表，仅覆盖最后一次 update）
 * dispatch: 触发更新的函数（由 mountState 时 bind 生成）
 */
export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: (action: unknown) => void;
}

/**
 * 创建一个 update，包装 action。
 * @param action 新值 或 (旧值→新值) 的函数
 * @param lane
 */
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane
): Update<State> => {
	return {
		action,
		lane,
		next: null
	};
};

/**
 * 创建空的更新队列。
 * 在 createContainer（HostRoot）和 mountState（每个 Hook）时调用。
 */
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		}
	} as UpdateQueue<State>;
};

/**
 * 将 update 加入队列。
 *
 * 使用环状单向链表存储多个 update。核心设计：
 *   - shared.pending 始终指向**最后一个**入队的 update（即 tail）
 *   - shared.pending.next 始终指向**第一个**入队的 update（即 head）
 *
 * 入队过程举例（三次 setState）：
 *
 *   步骤 ①：enqueueUpdate(update_a)
 *     pending = null，构造自环
 *     结果：update_a.next → update_a
 *     shared.pending = update_a
 *     内存状态：
 *       a ──→ a
 *       ↑pending↑
 *
 *   步骤 ②：enqueueUpdate(update_b)
 *     pending = a
 *     b.next = a.next（即 a）= a     →  b.next → a
 *     a.next = b                      →  a.next → b
 *     shared.pending = b
 *     内存状态：
 *       a ←── b
 *       ↓      ↑
 *       └── a ─┘
 *       (等价于: b → a → b)
 *
 *   步骤 ③：enqueueUpdate(update_c)
 *     pending = b
 *     c.next = b.next（即 a）= a     →  c.next → a
 *     b.next = c                      →  b.next → c
 *     shared.pending = c
 *     内存状态：
 *       a ←── b
 *       ↓      ↑
 *       c ──→  ┘
 *       ↑      ↑
 *       └──────┘
 *       (等价于: c → a → b → c)
 *
 * 遍历方式（processUpdateQueue 消费时）：
 *   const first = pending.next;  // 拿到 head
 *   let cur = first;
 *   do {
 *     // 处理 cur.action
 *     cur = cur.next;
 *   } while (cur !== first);      // 回到 head 说明遍历完整个环
 *
 * @param updateQueue 目标更新队列
 * @param update 待加入的 update
 */
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	const pending = updateQueue.shared.pending;
	if (pending === null) {
		update.next = update;
	} else {
		update.next = pending.next;
		pending.next = update;
	}

	updateQueue.shared.pending = update;
	// 完成上述操作后，形成环形链表
	// 	shared.pending.next 一直指向第一个入队的
	// 	shared.pending一直是最后一个入队的
};

/**
 * 消费 pending 中的 update，计算新的 memoizedState。
 * @param baseState 旧的状态值
 * @param pendingUpdate 待处理的 update（可能为 null）
 * @param renderLane
 * @returns { memoizedState: 新状态 }
 */
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
): { memoizedState: State } => {
	// ReturnType<typeof processUpdateQueue<State>>  表示 processUpdateQueue 函数的返回值类型

	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState
	};
	if (pendingUpdate !== null) {
		// 环形链表，pendingUpdate指向最晚入队的一个，pendingUpdate.next 指向最先入队的哪个
		const first = pendingUpdate.next;
		//
		let pending = pendingUpdate.next as Update<any>;

		do {
			const updateLane = pending?.lane;
			if (updateLane === renderLane) {
				const action = pending.action;
				if (action instanceof Function) {
					baseState = action(baseState);
				} else {
					baseState = action;
				}
			} else {
				if (__DEV__) {
					console.error('不应该进入updateLane !== renderLane');
				}
			}
			pending = pending?.next as Update<any>;
		} while (pending !== first);
	}
	result.memoizedState = baseState;
	return result;
};

/**
 * 整体更新流程：
 * 1. 组件内部触发更新（setState / HostRoot 的 updateContainer）
 * 2. 对应的 action 被 enqueueUpdate 加入该组件的 fiber.updateQueue 中
 * 3. scheduleUpdateOnFiber 从该 fiber 向上找到 FiberRootNode
 * 4. renderRoot 中 HostRoot 的 updateHostRoot 调用 processUpdateQueue 消费 pending
 * 5. Hook 的 updateState 同理，在 renderWithHooks → App() 内调用 processUpdateQueue
 */
