import {
	/**
	 * 最高优先级（数值为 1），用于需要立即同步完成的任务。
	 * 对应 React 中的同步更新（如 useSyncExternalStore 的同步 snapshot 触发的更新，
	 * 或 Scheduler 内部通过 postMessage 实现同步回调的场景）。
	 * 在本 demo 中，标记为 ImmediatePriority 的工作会在 perform 函数中
	 * 绕过 shouldYield() 时间切片检查，一次性连续执行直到完成（needSync = true），
	 * 不会被任何时间分片中斷。
	 */
	unstable_ImmediatePriority as ImmediatePriority,
	/**
	 * 用户阻塞优先级（数值为 2），用于用户当前正在交互的任务。
	 * 对应 React 中的离散事件（click / keydown / focus / blur 等）和
	 * 连续事件（mouseover / scroll 等）触发的更新，例如按钮点击后的状态更新。
	 * 在本 demo 中，UserBlockingPriority 的工作在点击对应按钮后会进入调度队列，
	 * 它的优先级比 NormalPriority 高，会排在 NormalPriority 和 LowPriority 工作之前执行；
	 * 但由于 needSync = false，它仍受 shouldYield() 时间切片控制，
	 * 如果单次执行时间超过 5ms 会主动让出主线程。
	 */
	unstable_UserBlockingPriority as UserBlockingPriority,
	/**
	 * 普通优先级（数值为 3），Scheduler 调度的默认优先级，用于大多数异步更新。
	 * 对应 React 中通过 useState / useReducer 的 dispatch（非紧急场景）、
	 * setState、forceUpdate 触发的默认更新，以及由 Concurrent Mode 下的
	 * startTransition 包裹的更新降级后的基准优先级。
	 * 在本 demo 中，NormalPriority 工作是"中等偏上"的 —— 它优先于 LowPriority
	 * 和 IdlePriority，但在 UserBlockingPriority 和 ImmediatePriority 之后执行；
	 * 数值 3 意味着如果有更高优先级（1 或 2）的工作插入队列尾部，
	 * schedule() 中的排序逻辑（w1.priority - w2.priority，数值越小优先级越高）
	 * 会将其排在前面，当前 NormalPriority 工作会被取消並让位。
	 */
	unstable_NormalPriority as NormalPriority,
	/**
	 * 低优先级（数值为 4），用于可延迟的非紧急任务。
	 * 对应 React 中 Suspense 触发 fallback 后的懒加载内容的渲染，
	 * 或数据预获取（preload）、日志上报、分析统计等不需要立即呈现给用户的工作。
	 * 在本 demo 中，LowPriority 是按钮列表中数值最低（优先级最低）的
	 * 可调度工作，只有当队列中没有更高优先级（1/2/3）的工作时才会被执行；
	 * 如果有多个 LowPriority 工作同时排队，它们之间按 FIFO 顺序依次执行。
	 */
	unstable_LowPriority as LowPriority,
	/**
	 * 空闲优先级（数值为 5），优先级最低，仅在浏览器空闲时段执行。
	 * 对应 React 中隐藏内容的预渲染（offscreen）、日志写入本地存储、
	 * 大量非关键数据的后处理等场景。React 18 的 useDeferredValue 产生的
	 * 延迟值更新也会使用这个优先级。
	 * 在本 demo 中，IdlePriority 被用作两个特殊用途：
	 *   1. prevPriority 的初始值（第 31 行）—— 表示"没有正在执行的工作"，
	 *      使得第一个调度进来的任何工作都能触发 schedule() 逻辑；
	 *   2. 一组工作全部执行完毕后，prevPriority 被重置为 IdlePriority（第 94 行），
	 *      以允许后续新来的工作能正常调度。
	 * 注意：IdlePriority 本身不会在按钮列表中创建一个对应的按钮（第 34 行的
	 * forEach 没有包含 IdlePriority），因此它在此 demo 中仅作为"无工作"的
	 * 标记状态使用。
	 */
	unstable_IdlePriority as IdlePriority,
	unstable_scheduleCallback as scheduleCallback,
	unstable_shouldYield as shouldYield,
	CallbackNode,
	unstable_getFirstCallbackNode as getFirstCallbackNode,
	unstable_cancelCallback as cancelCallback
} from 'scheduler';

import './style.css';
const button = document.querySelector('button');
const root = document.querySelector('#root');

type Priority =
	| typeof IdlePriority
	| typeof LowPriority
	| typeof NormalPriority
	| typeof UserBlockingPriority
	| typeof ImmediatePriority;

interface Work {
	count: number;
	priority: Priority;
}

const workList: Work[] = [];
let prevPriority: Priority = IdlePriority;
let curCallback: CallbackNode | null = null;

[LowPriority, NormalPriority, UserBlockingPriority, ImmediatePriority].forEach(
	(priority) => {
		const btn = document.createElement('button');
		root?.appendChild(btn);
		btn.innerText = [
			'',
			'ImmediatePriority',
			'UserBlockingPriority',
			'NormalPriority',
			'LowPriority'
		][priority];
		btn.onclick = () => {
			workList.unshift({
				count: 100,
				priority: priority as Priority
			});
			schedule();
		};
	}
);

function schedule() {
	const cbNode = getFirstCallbackNode();
	const curWork = workList.sort((w1, w2) => w1.priority - w2.priority)[0];

	// 策略逻辑
	if (!curWork) {
		curCallback = null;
		cbNode && cancelCallback(cbNode);
		return;
	}

	const { priority: curPriority } = curWork;
	if (curPriority === prevPriority) {
		return;
	}
	// 更高优先级的work
	cbNode && cancelCallback(cbNode);

	curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
}

function perform(work: Work, didTimeout?: boolean) {
	/**
	 * 1. work.priority
	 * 2. 饥饿问题
	 * 3. 时间切片
	 */
	const needSync = work.priority === ImmediatePriority || didTimeout;
	while ((needSync || !shouldYield()) && work.count) {
		work.count--;
		insertSpan(work.priority + '');
	}

	// 中断执行 || 执行完
	prevPriority = work.priority;

	if (!work.count) {
		const workIndex = workList.indexOf(work);
		workList.splice(workIndex, 1);
		prevPriority = IdlePriority;
	}

	const prevCallback = curCallback;
	schedule();
	const newCallback = curCallback;

	if (newCallback && prevCallback === newCallback) {
		return perform.bind(null, work);
	}
}

function insertSpan(content) {
	const span = document.createElement('span');
	span.innerText = content;
	span.className = `pri-${content}`;
	doSomeBuzyWork(10000000);
	root?.appendChild(span);
}

function doSomeBuzyWork(len: number) {
	let result = 0;
	while (len--) {
		result += len;
	}
}
