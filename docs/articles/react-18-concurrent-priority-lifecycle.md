# React 18 并发优先级实现深度解析（二）：生命周期螺旋式源码追踪

> 本文基于 React 18.2.0 源码，从 API 调用入口开始，逐行追踪 `useTransition`、`useDeferredValue` 和高优先级打断的完整生命周期。所有演示代码采用「官方源码风格 + big-react 简化版」对照。

---

## 第 1 章 开场：一个会卡的页面

### 1.1 页面示例

```tsx
function SearchResults({ query }: { query: string }) {
	const list = useMemo(() => {
		return Array.from({ length: 10000 }, (_, i) => `${query} - item ${i}`);
	}, [query]);

	return (
		<ul>
			{list.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}

function App() {
	const [query, setQuery] = useState('');

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setQuery(e.target.value);
	};

	return (
		<div>
			<input value={query} onChange={handleChange} />
			<SearchResults query={query} />
		</div>
	);
}
```

这是一个典型的"输入框 + 大数据列表"页面。用户输入时，React 需要同时更新输入框和 10000 行列表。

### 1.2 不用并发时的掉帧原因

当用户在输入框输入字符 'a' 时：

1. 浏览器触发 onChange 事件
2. React 事件系统调用 `handleChange`
3. `setQuery('a')` 触发一次 DefaultLane 更新
4. React 进入 `performSyncWorkOnRoot` 或 `performConcurrentWorkOnRoot`
5. render 阶段遍历 Fiber 树
6. `SearchResults` 组件生成 10000 个 `<li>` 元素
7. commit 阶段把 DOM 更新到页面上

如果第 5-7 步耗时 200ms，那么这 200ms 内：

- 主线程被占用
- 浏览器无法处理下一次输入事件
- 输入框光标不移动
- 用户感觉卡顿

Performance 面板里会看到一个长长的黄色脚本执行块。

### 1.3 并发模式的心智模型

React 18 并发模式提供了三种机制：

1. **Lane（车道）**：把不同更新按优先级分类
2. **时间切片**：把长 render 拆成多个 5ms 小任务
3. **双缓冲**：同时维护 current 树和 workInProgress 树，只有完整的 workInProgress 才会提交

这三个机制配合，实现了：

- 紧急更新（输入）优先处理
- 非紧急更新（列表渲染）可以被打断和恢复
- 用户始终看到一致的 UI

本文的目标就是：从一次 API 调用开始，追踪这些机制在源码层面的完整协作过程。

---

## 第 2 章 先补够用的基础

在追踪生命周期之前，先集中学习三个核心函数：`requestUpdateLane`、`ensureRootIsScheduled`、`workLoopConcurrent`。

### 2.1 requestUpdateLane：给更新发车道

```ts
// big-react 风格简化版

export function requestUpdateLane(): Lane {
	const isTransition = ReactCurrentBatchConfig.transition !== null;
	if (isTransition) {
		return TransitionLane;
	}

	const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
	const lane = schedulerPriorityToLane(currentSchedulerPriority);
	return lane;
}

export function schedulerPriorityToLane(schedulerPriority: number): Lane {
	if (schedulerPriority === unstable_ImmediatePriority) {
		return SyncLane;
	}
	if (schedulerPriority === unstable_UserBlockingPriority) {
		return InputContinuousLane;
	}
	if (schedulerPriority === unstable_NormalPriority) {
		return DefaultLane;
	}
	if (schedulerPriority === unstable_IdlePriority) {
		return IdleLane;
	}
	return NoLane;
}
```

**核心逻辑**：

- 只要处于 transition 上下文，就返回 `TransitionLane`（最低优先级之一）
- 否则根据 Scheduler 当前优先级返回对应的 lane

### 2.2 ensureRootIsScheduled：决定用哪种方式执行

```ts
// big-react 风格简化版

export function ensureRootIsScheduled(root: FiberRootNode) {
	const updateLane = getHighestPriorityLane(root.pendingLanes);
	if (updateLane === NoLane) {
		return;
	}

	if (updateLane === SyncLane) {
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		scheduleCallback(
			NormalPriority,
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}
}
```

**核心逻辑**：

- 取 `pendingLanes` 中最高优先级的 lane
- SyncLane 用微任务同步调度
- 其他 lane 用 Scheduler 的宏任务调度

注意：真实的 React 18 源码里这里会处理 callbackNode 和 callbackPriority 的复用/替换，我们会在高优先级打断章节详细展开。

### 2.3 workLoopConcurrent：可中断的 render

```ts
// big-react 风格简化版

function workLoopConcurrent() {
	while (workInProgress !== null && !shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;

	if (next === null) {
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}
```

**核心逻辑**：

- 每次处理一个 Fiber（beginWork + completeWork）
- 处理前检查 `shouldYield()`
- 如果时间片用尽，退出循环，等待下一次调度

### 2.4 本文学到的三个约定

1. 所有代码片段都是简化版，省略 DEV 警告、错误处理、部分类型断言
2. "官方源码风格"保留核心函数名和调用关系
3. "big-react 风格"更贴近仓库现有实现

---

## 第 3 章 useTransition 完整生命周期

### 3.1 示例代码

```tsx
function SearchResults({ query }: { query: string }) {
	const list = useMemo(() => {
		return Array.from({ length: 10000 }, (_, i) => `${query} - item ${i}`);
	}, [query]);

	return (
		<ul>
			{list.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}

function App() {
	const [inputValue, setInputValue] = useState('');
	const [query, setQuery] = useState('');
	const [isPending, startTransition] = useTransition();

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setInputValue(value);
		startTransition(() => {
			setQuery(value);
		});
	};

	return (
		<div>
			<input value={inputValue} onChange={handleChange} />
			{isPending && <div>Loading...</div>}
			<SearchResults query={query} />
		</div>
	);
}
```

### 3.2 Step 1：Hook 创建（mountTransition）

组件第一次渲染时，React 调用 `mountTransition`：

```ts
// big-react 风格简化版

function mountTransition() {
	const [isPending, setPending] = mountState(false);

	const start = (callback: () => void) => {
		setPending(true);

		const prevTransition = ReactCurrentBatchConfig.transition;
		ReactCurrentBatchConfig.transition = {};

		try {
			callback();
		} finally {
			ReactCurrentBatchConfig.transition = prevTransition;
			setPending(false);
		}
	};

	return [isPending, start];
}
```

**状态变化**：

| 字段                 | 初始值 | mount 后              |
| -------------------- | ------ | --------------------- |
| isPending state      | 无     | false                 |
| setPending 函数      | 无     | dispatchSetState 绑定 |
| startTransition 函数 | 无     | 闭包函数              |

此时组件 render 完成，页面上显示：

- 输入框为空
- 没有 Loading
- 列表为空

### 3.3 Step 2：用户触发 startTransition

用户在输入框输入 'a'，触发 `handleChange`：

```ts
const value = 'a';
setInputValue(value);
startTransition(() => {
	setQuery(value);
});
```

#### 3.3.1 setInputValue('a')

```ts
function dispatchSetState(fiber, queue, action) {
	const lane = requestUpdateLane(fiber);
	// lane = DefaultLane（普通输入事件）
	const update = createUpdate(action, lane);
	enqueueUpdate(queue, update);
	scheduleUpdateOnFiber(fiber, lane);
}
```

`scheduleUpdateOnFiber` 内部：

```ts
function scheduleUpdateOnFiber(fiber, lane) {
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	ensureRootIsScheduled(root);
}
```

此时：

```
root.pendingLanes = DefaultLane
root.callbackPriority = DefaultLane
root.callbackNode = task1
```

#### 3.3.2 startTransition 内部执行

进入 `start` 函数：

```ts
setPending(true);
```

同样触发 `dispatchSetState(fiber, pendingQueue, true)`。注意此时 `ReactCurrentBatchConfig.transition` 还是 `null`，所以这次更新走 DefaultLane：

```
root.pendingLanes = DefaultLane | DefaultLane = DefaultLane
```

（注意：同一 lane 按位或不会重复计数）

然后：

```ts
const prevTransition = ReactCurrentBatchConfig.transition;
ReactCurrentBatchConfig.transition = {};
```

现在 transition 上下文建立。

执行用户回调：

```ts
callback();
// 即 setQuery('a')
```

在回调中：

```ts
function dispatchSetState(fiber, queue, action) {
	const lane = requestUpdateLane(fiber);
	// ReactCurrentBatchConfig.transition !== null
	// lane = TransitionLane1
	const update = createUpdate(action, lane);
	enqueueUpdate(queue, update);
	scheduleUpdateOnFiber(fiber, lane);
}
```

此时：

```
root.pendingLanes = DefaultLane | TransitionLane1
```

`ensureRootIsScheduled` 被再次调用。最高优先级是 DefaultLane，和当前 `callbackPriority` 相同，所以复用 task1。

回调执行完后：

```ts
ReactCurrentBatchConfig.transition = prevTransition;
setPending(false);
```

`setPending(false)` 再次触发 DefaultLane 更新。

此时 `root.pendingLanes` 仍然为 `DefaultLane | TransitionLane1`。

### 3.4 Step 3：调度

事件循环结束，Scheduler 开始执行任务。

假设 `handleChange` 里的所有 setState 都被自动批处理合并。最终 Scheduler 拿到 task1：`performConcurrentWorkOnRoot(root)`。

注意：真实的 React 18 中，`setInputValue`、`setPending(true)`、`setQuery('a')`、`setPending(false)` 都可能在同一个事件循环中，React 的自动批处理会把它们一起处理。

进入 `performConcurrentWorkOnRoot`：

```ts
function performConcurrentWorkOnRoot(root, didTimeout) {
	const originalCallbackNode = root.callbackNode; // task1

	flushPassiveEffects(); // 假设没有 effects

	const lanes = getNextLanes(root, NoLanes);
	// lanes = DefaultLane | TransitionLane1

	if (lanes === NoLanes) {
		return null;
	}

	const shouldTimeSlice = !includesBlockingLane(root, lanes) && !didTimeout;
	// true，走并发渲染

	const exitStatus = renderRootConcurrent(root, lanes);
	// ...
}
```

`getNextLanes` 从 `root.pendingLanes` 中取出所有非挂起、非过期的 lanes。

### 3.5 Step 4：并发渲染

进入 `renderRootConcurrent`：

```ts
function renderRootConcurrent(root, lanes) {
	if (root !== workInProgressRoot || lanes !== workInProgressRootRenderLanes) {
		prepareFreshStack(root, lanes);
	}

	executionContext |= RenderContext;

	do {
		try {
			workLoopConcurrent();
			break;
		} catch (error) {
			handleError(root, error);
		}
	} while (true);

	executionContext = prevExecutionContext;

	if (workInProgress !== null) {
		return RootInProgress;
	}

	return workInProgressRootExitStatus;
}
```

`prepareFreshStack`：

```ts
function prepareFreshStack(root, lanes) {
	workInProgress = createWorkInProgress(
		root.current,
		root.current.pendingProps
	);
	workInProgressRoot = root;
	workInProgressRootRenderLanes = lanes;
	wipRootRenderLane = lanes;
}
```

此时全局状态：

```
workInProgress = 新的 HostRoot Fiber
workInProgressRoot = root
workInProgressRootRenderLanes = DefaultLane | TransitionLane1
wipRootRenderLane = DefaultLane | TransitionLane1
```

然后进入 `workLoopConcurrent`：

```ts
function workLoopConcurrent() {
	while (workInProgress !== null && !shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}
```

#### 渲染 App 组件

`beginWork(HostRoot)` 处理 HostRoot，拿到 `<App />`。

`beginWork(FunctionComponent, App)` 调用 `renderWithHooks`：

```ts
function renderWithHooks(wip, lane) {
	currentlyRenderingFiber = wip;
	wip.memoizedState = null;
	wip.updateQueue = null;
	renderLane = lane;

	const Component = wip.type; // App
	const props = wip.pendingProps;
	const children = Component(props);

	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;

	return children;
}
```

在 `App()` 内部：

1. `useState('')` → `updateState`，从 queue 中读取 `inputValue = 'a'`
2. `useState('')` → `updateState`，从 queue 中读取 `query = 'a'`（因为 TransitionLane update 已经在 queue 中）
3. `useTransition()` → `updateTransition`，从 state 中读取 `isPending`

等一下，这里有一个关键点：

`isPending` 的 queue 中有 `true` 和 `false` 两个 update。在 render 时，React 会消费 queue 中所有 lane 匹配的 update。

由于本次 render 的 lanes 是 `DefaultLane | TransitionLane1`，而 `setPending(true)` 和 `setPending(false)` 都是 DefaultLane，所以它们都会被消费。

结果可能是：

- `setPending(true)` 先执行，isPending = true
- `setPending(false)` 后执行，isPending = false

所以第一次 render 时 isPending 可能还是 false。

这正是 React 18 源码中 `startTransition` 的优化：isPending 的 true/false 变化会尽快反映，但如果 transition 回调执行得很快，用户可能看不到 Loading。

#### 渲染 SearchResults 组件

App 返回：

```tsx
<div>
	<input value={'a'} />
	{false && <div>Loading...</div>}
	<SearchResults query={'a'} />
</div>
```

`SearchResults` 组件生成 10000 个 `<li>` 元素。这个 render 可能耗时较长。

### 3.6 Step 5：提交

假设列表渲染在时间片内完成（实际可能需要多次时间切片），`workLoopConcurrent` 遍历完整棵树，workInProgress = null。

`renderRootConcurrent` 返回 `workInProgressRootExitStatus`。

回到 `performConcurrentWorkOnRoot`：

```ts
if (exitStatus !== RootInProgress) {
	const finishedWork = root.current.alternate;
	root.finishedWork = finishedWork;
	root.finishedLanes = lanes;

	commitRoot(root);
}

if (root.callbackNode === originalCallbackNode) {
	return performConcurrentWorkOnRoot.bind(null, root);
}

return null;
```

`commitRoot` 执行：

1. beforeMutation
2. mutation：把新的 DOM 更新到页面
3. layout：执行 layout effects
4. 调度 passive effects

`markRootFinished(root, lanes)` 清除已消费的 lanes：

```
root.pendingLanes = 0
```

### 3.7 Step 6：isPending 真正变化

前面的分析提到，isPending 的 true/false 可能在同一次 render 中被消费，导致 Loading 不显示。

但在真实的 React 18 中，`startTransition` 的实现更复杂。它会确保：

1. `setPending(true)` 先被调度并 render
2. transition 更新再 render
3. `setPending(false)` 在 transition 完成后再 render

这样用户可以看到 Loading → 列表更新 → Loading 消失。

简化版的实现可能无法完全复现这一点，因为真实的源码中有 `dispatchOptimisticSetState` 等优化。但核心原理是相通的：isPending 的高优先级更新会先渲染，transition 的低优先级更新会后渲染。

### 3.8 useTransition 生命周期状态变化表

| 步骤      | pendingLanes                   | callbackNode | workInProgressRoot | isPending             | query          | UI                   |
| --------- | ------------------------------ | ------------ | ------------------ | --------------------- | -------------- | -------------------- |
| 初始      | 0                              | null         | null               | false                 | ''             | 输入框空，列表空     |
| 输入 'a'  | DefaultLane \| TransitionLane1 | task1        | root               | queue 中有 true/false | queue 中有 'a' | 尚未更新             |
| render 中 | DefaultLane \| TransitionLane1 | task1        | root               | 可能 false            | 'a'            | 旧 UI                |
| commit 后 | 0                              | null         | null               | 可能 false            | 'a'            | 输入框 'a'，列表 'a' |

---

## 第 4 章 useDeferredValue 完整生命周期

### 4.1 示例代码

```tsx
function Chart({ value }: { value: string }) {
	const data = useMemo(() => {
		return Array.from({ length: 5000 }, (_, i) => `${value}-${i}`);
	}, [value]);

	return (
		<svg width={400} height={300}>
			{data.map((d, i) => (
				<rect
					key={d}
					x={(i % 40) * 10}
					y={Math.floor(i / 40) * 10}
					width={8}
					height={8}
				/>
			))}
		</svg>
	);
}

function App() {
	const [value, setValue] = useState('');
	const deferredValue = useDeferredValue(value);

	return (
		<div>
			<input value={value} onChange={(e) => setValue(e.target.value)} />
			<Chart value={deferredValue} />
		</div>
	);
}
```

### 4.2 Mount 阶段

组件首次渲染时，调用 `mountDeferredValue`：

```ts
// big-react 风格简化版

function useDeferredValue(value, initialValue) {
	const [prevValue, setValue] = useState(
		initialValue !== undefined ? initialValue : value
	);

	useEffect(() => {
		const prevTransition = ReactCurrentBatchConfig.transition;
		ReactCurrentBatchConfig.transition = {};
		try {
			setValue(value);
		} finally {
			ReactCurrentBatchConfig.transition = prevTransition;
		}
	}, [value]);

	return prevValue;
}
```

Mount 时：

```ts
const [prevValue, setValue] = useState(value);
// prevValue = ''
```

`useEffect` 不会立即执行，它会在 commit 后异步执行。

所以 mount 阶段返回 `prevValue = value = ''`。

页面显示：

- 输入框空
- Chart 组件用 '' 渲染

Commit 后，useEffect 执行：

```ts
ReactCurrentBatchConfig.transition = {};
setValue(value); // value = ''
ReactCurrentBatchConfig.transition = prevTransition;
```

`setValue('')` 触发一次 update，但值没有变化，React 会优化跳过这次更新。

### 4.3 Update 阶段：用户输入 'a'

用户输入 'a'，触发 `setValue('a')`：

```ts
function dispatchSetState(fiber, queue, action) {
	const lane = requestUpdateLane(fiber);
	// lane = DefaultLane
	const update = createUpdate(action, lane);
	enqueueUpdate(queue, update);
	scheduleUpdateOnFiber(fiber, lane);
}
```

`root.pendingLanes = DefaultLane`

Scheduler 调度 `performConcurrentWorkOnRoot`。

进入 `renderRootConcurrent`，渲染 App 组件：

```ts
const [value, setValue] = useState('');
// value 参数 'a' 被忽略，state 还是上一次的 ''

const deferredValue = useDeferredValue(value);
// useDeferredValue 内部：
// const [prevValue, setValue] = useState('a');
// prevValue 仍然是 ''（因为 state 已存在）
// useEffect 依赖 [value]，value 从 '' 变成 'a'，effect 会执行
// 返回 prevValue = ''
```

App 返回：

```tsx
<div>
	<input value={'a'} />
	<Chart value={''} />
</div>
```

注意：此时 `Chart` 仍然用旧值 '' 渲染。

这次 render 的 lane 是 DefaultLane。完成后 commit：

- 输入框显示 'a'
- Chart 仍然显示旧内容

### 4.4 Commit 后 effect 触发 Transition 更新

Commit 阶段结束后，useEffect 执行：

```ts
useEffect(() => {
	const prevTransition = ReactCurrentBatchConfig.transition;
	ReactCurrentBatchConfig.transition = {};
	try {
		setValue(value); // value = 'a'
	} finally {
		ReactCurrentBatchConfig.transition = prevTransition;
	}
}, [value]);
```

`setValue('a')` 在 transition 上下文中执行，所以：

```ts
const lane = requestUpdateLane(fiber);
// lane = TransitionLane1
```

`root.pendingLanes = TransitionLane1`

Scheduler 调度新的 `performConcurrentWorkOnRoot`，这次 lanes 只有 TransitionLane1。

### 4.5 第二次 render：Chart 更新为 'a'

`renderRootConcurrent` 渲染 App：

```ts
const [value, setValue] = useState('');
// value 参数 'a' 被忽略
// 但 queue 中有 TransitionLane1 的 update 'a'
// processUpdateQueue 后 value = 'a'

const deferredValue = useDeferredValue(value);
// useDeferredValue 内部：
// const [prevValue, setValue] = useState('a');
// prevValue 仍然是 ''，因为 useState 在 update 阶段返回旧 state
// useEffect 依赖 [value]，value 还是 'a'，deps 没变，effect 不执行
// 返回 prevValue = ''
```

等等，这里有问题。useDeferredValue 的 `prevValue` 怎么才能变成 'a'？

实际上，`useDeferredValue` 内部的 `useState(value)` 在 update 阶段，会把 `value` 当作新的 state 吗？不会，因为 React 的 `useState` 在 update 阶段只从 queue 中读取 pending update。

所以 `useDeferredValue` 的设计是：

- mount 阶段：`prevValue = value`
- update 阶段：第一次 render 返回旧 state，effect 中 setValue 触发第二次 render
- 第二次 render 时，queue 中有 setValue(value) 的 update，所以 `prevValue = value`

也就是说，`useDeferredValue` 需要两次 update render：

1. 第一次：value 变了，但 prevValue 还是旧值
2. effect 中 setValue(value)，触发第二次 render
3. 第二次：prevValue 更新为新值

### 4.6 连续输入时的合并

假设用户快速输入 'a'、'b'、'c'。

对于 `useDeferredValue`：

- 输入 'a'：第一次 render value='a'，deferredValue=''；effect 触发 TransitionLane1
- 输入 'b'（在 TransitionLane1 还没完成时）：第一次 render value='b'，deferredValue=''；effect 触发 TransitionLane2
- TransitionLane1 被更高优先级的 DefaultLane 打断（实际上 'b' 的输入会触发新的 DefaultLane render）
- 最终只渲染 TransitionLane2 对应 value='c' 的 Chart

React 会取消过时的 transition，只保留最新的。

### 4.7 useDeferredValue 与 useTransition 的对比

| 特性               | useTransition     | useDeferredValue          |
| ------------------ | ----------------- | ------------------------- |
| 触发方式           | 主动包裹 setState | 被动响应 props/state 变化 |
| 是否提供 isPending | 是                | 否                        |
| 使用位置           | 事件处理函数中    | 组件 render 中            |
| 底层 lane          | TransitionLane    | TransitionLane            |
| 需要几次 render    | 2-3 次            | 2 次（update 阶段）       |

### 4.8 useDeferredValue 生命周期状态变化表

| 阶段                   | pendingLanes    | deferredValue | value | UI                       |
| ---------------------- | --------------- | ------------- | ----- | ------------------------ |
| Mount                  | 0               | ''            | ''    | 输入框空，Chart 空       |
| 输入 'a' 第一次 render | DefaultLane     | ''            | 'a'   | 输入框 'a'，Chart 旧内容 |
| Commit + effect        | TransitionLane1 | ''            | 'a'   | 输入框 'a'，Chart 旧内容 |
| Transition render      | TransitionLane1 | 'a'           | 'a'   | 输入框 'a'，Chart 'a'    |

---

## 第 5 章 高优先级打断低优先级专题

### 5.1 场景构造

回到 useTransition 示例。用户输入 'a' 后，TransitionLane1 正在渲染 10000 行列表，渲染到一半时，用户又输入 'b'。

### 5.2 Step 1：低优先级渲染中

当前状态：

```
root.pendingLanes = DefaultLane | TransitionLane1
root.callbackNode = task1
root.callbackPriority = DefaultLane
workInProgressRoot = root
workInProgressRootRenderLanes = DefaultLane | TransitionLane1
workInProgress = 某个 Fiber（正在处理中）
```

`workLoopConcurrent` 正在执行：

```ts
while (workInProgress !== null && !shouldYield()) {
	performUnitOfWork(workInProgress);
}
```

它会一直处理 Fiber，直到：

- workInProgress 为 null（渲染完成）
- `shouldYield()` 返回 true（时间片用尽或有更高优先级任务）

### 5.3 Step 2：新事件到达

用户输入 'b'，浏览器触发 onChange。

React 事件系统调用 `handleChange`：

```ts
const value = 'b';
setInputValue(value);
startTransition(() => {
	setQuery(value);
});
```

#### setInputValue('b')

```ts
dispatchSetState(fiber, queue, 'b');
// lane = InputContinuousLane
// scheduleUpdateOnFiber(fiber, InputContinuousLane)
```

`markRootUpdated`：

```
root.pendingLanes = DefaultLane | TransitionLane1 | InputContinuousLane
```

#### startTransition(() => setQuery('b'))

```ts
setPending(true); // DefaultLane
ReactCurrentBatchConfig.transition = {};
setQuery('b'); // TransitionLane2
ReactCurrentBatchConfig.transition = prev;
setPending(false); // DefaultLane
```

最终：

```
root.pendingLanes = DefaultLane | TransitionLane1 | InputContinuousLane | TransitionLane2
```

### 5.4 Step 3：调度器重新排队

每次 `scheduleUpdateOnFiber` 都会调用 `ensureRootIsScheduled`。

最后一次调用时：

```ts
function ensureRootIsScheduled(root) {
	const existingCallbackNode = root.callbackNode; // task1
	const nextLanes = getHighestPriorityLane(root.pendingLanes);
	// nextLanes = InputContinuousLane

	if (nextLanes === NoLanes) return;

	const newCallbackPriority = nextLanes; // InputContinuousLane
	const existingCallbackPriority = root.callbackPriority; // DefaultLane

	if (
		existingCallbackNode !== null &&
		newCallbackPriority === existingCallbackPriority
	) {
		return;
	}

	// 优先级不同，取消旧任务
	cancelCallback(existingCallbackNode);

	// 调度新任务
	const schedulerPriorityLevel = laneToSchedulerPriority(InputContinuousLane);
	const newCallbackNode = scheduleCallback(
		schedulerPriorityLevel,
		performConcurrentWorkOnRoot.bind(null, root)
	);

	root.callbackPriority = InputContinuousLane;
	root.callbackNode = newCallbackNode; // task2
}
```

此时：

```
root.callbackNode = task2
root.callbackPriority = InputContinuousLane
```

### 5.5 Step 4：原任务让出

正在执行 task1 的 `performConcurrentWorkOnRoot` 继续运行。

`workLoopConcurrent` 处理完当前 Fiber 后，下一次循环检查 `shouldYield()`。此时 taskQueue 堆顶是 task2（InputContinuousLane，UserBlockingPriority），而且当前时间片可能也快到了，所以 `shouldYield()` 返回 true。

`workLoopConcurrent` 退出，`renderRootConcurrent` 返回 `RootInProgress`。

回到 `performConcurrentWorkOnRoot`：

```ts
if (exitStatus !== RootInProgress) {
	// 不进入
}

if (root.callbackNode === originalCallbackNode) {
	// root.callbackNode = task2
	// originalCallbackNode = task1
	// 不相等
	return performConcurrentWorkOnRoot.bind(null, root);
}

return null;
```

返回 null，task1 不再继续。

### 5.6 Step 5：高优先级渲染与提交

Scheduler 调度 task2，执行 `performConcurrentWorkOnRoot(root, false)`。

进入函数：

```ts
const originalCallbackNode = root.callbackNode; // task2

flushPassiveEffects();

const lanes = getNextLanes(root, NoLanes);
// lanes = InputContinuousLane（最高优先级）

const shouldTimeSlice = !includesBlockingLane(root, lanes) && !didTimeout;
// true

renderRootConcurrent(root, InputContinuousLane);
```

`renderRootConcurrent` 中：

```ts
if (root !== workInProgressRoot || lanes !== workInProgressRootRenderLanes) {
	prepareFreshStack(root, InputContinuousLane);
}
```

因为 `workInProgressRootRenderLanes` 是 `DefaultLane | TransitionLane1`，新的 lanes 是 `InputContinuousLane`，所以会重新调用 `prepareFreshStack`。

`prepareFreshStack` 做了什么？

```ts
function prepareFreshStack(root, lanes) {
	workInProgress = createWorkInProgress(
		root.current,
		root.current.pendingProps
	);
	workInProgressRoot = root;
	workInProgressRootRenderLanes = lanes;
}
```

它基于 `root.current`（屏幕上当前显示的树）创建新的 workInProgress。旧的 workInProgress（只渲染了一半的 Transition 树）被丢弃。

然后以 InputContinuousLane 重新 render 整棵树。

由于 InputContinuousLane 优先级高，且输入框渲染很快，这次 render 会快速完成。

`commitRoot(root)`：

- DOM 更新：输入框显示 'b'
- isPending 显示 Loading

`markRootFinished(root, InputContinuousLane)`：

```
root.pendingLanes = DefaultLane | TransitionLane1 | TransitionLane2
```

### 5.7 Step 6：低优先级恢复

`commitRoot` 末尾调用 `ensureRootIsScheduled(root)`：

```ts
const nextLanes = getHighestPriorityLane(root.pendingLanes);
// nextLanes = DefaultLane
```

调度 task3：`performConcurrentWorkOnRoot(root)`。

这次执行时，DefaultLane 很快完成。然后剩下 TransitionLane1 和 TransitionLane2。

`getNextLanes` 会跳过过时的 TransitionLane1（因为对应的 update 已经被新的 update 覆盖），只处理 TransitionLane2。

最终：

```ts
renderRootConcurrent(root, TransitionLane2);
```

渲染 query='b' 的列表。

完成后 commit，列表显示 5000 个 'b' 相关的矩形。

### 5.8 状态变化表

| 阶段            | pendingLanes                                                             | callbackNode | callbackPriority    | workInProgressRoot | workInProgressRootRenderLanes  | 说明                     |
| --------------- | ------------------------------------------------------------------------ | ------------ | ------------------- | ------------------ | ------------------------------ | ------------------------ |
| 输入 'a'        | DefaultLane \| TransitionLane1                                           | task1        | DefaultLane         | root               | DefaultLane \| TransitionLane1 | 开始渲染                 |
| 渲染中          | DefaultLane \| TransitionLane1                                           | task1        | DefaultLane         | root               | DefaultLane \| TransitionLane1 | 处理 SearchResults       |
| 输入 'b'        | DefaultLane \| TransitionLane1 \| InputContinuousLane \| TransitionLane2 | task2        | InputContinuousLane | root               | DefaultLane \| TransitionLane1 | 取消 task1               |
| 原任务退出      | 同上                                                                     | task2        | InputContinuousLane | root               | DefaultLane \| TransitionLane1 | 返回 null                |
| 高优先级 render | InputContinuousLane                                                      | task2        | InputContinuousLane | root               | InputContinuousLane            | prepareFreshStack 重置   |
| 高优先级 commit | DefaultLane \| TransitionLane1 \| TransitionLane2                        | task3        | DefaultLane         | null               | -                              | markRootFinished         |
| Transition 恢复 | TransitionLane2                                                          | task3        | DefaultLane         | root               | TransitionLane2                | 丢弃过时 TransitionLane1 |
| Transition 完成 | 0                                                                        | null         | NoLane              | null               | -                              | 列表显示 'b'             |

### 5.9 关键判定原理解析

#### 为什么 `root.callbackNode === originalCallbackNode` 能判断是否被打断？

因为 `ensureRootIsScheduled` 在更高优先级更新到来时，会：

1. 取消旧的 callbackNode
2. 创建新的 callbackNode
3. 更新 `root.callbackNode`

如果当前正在执行的 callback 发现自己保存的 `originalCallbackNode` 不等于 `root.callbackNode`，说明自己已经被"替换"了，应该让出执行权。

#### 为什么旧的 workInProgress 可以直接丢弃？

因为 workInProgress 还没有 commit，对用户不可见。丢弃它不会影响 DOM 状态。高优先级 render 会基于 `root.current` 重新创建新的 workInProgress。

#### 为什么 pendingLanes 中过时的 TransitionLane1 最终不会影响结果？

因为 `setQuery('b')` 的 update 进入 queue 后，新的 render 会消费 TransitionLane2 的 update，得到 query='b'。TransitionLane1 的 update 虽然还在 queue 中，但 render 时只会消费与当前 render lane 匹配的 update。

---

## 第 6 章 哪些阶段会被跳过、哪些会重新执行

### 6.1 被打断时不会 commit

```ts
function performConcurrentWorkOnRoot(root, didTimeout) {
	// ...
	const exitStatus = renderRootConcurrent(root, lanes);

	if (exitStatus !== RootInProgress) {
		// 只有渲染完成才会 commit
		commitRoot(root);
	}

	// 如果被打断，这里不 commit
}
```

`RootInProgress` 表示渲染被中断但还没完成。此时不会进入 commit。

### 6.2 已经 beginWork 过的 Fiber 需要重新做

高优先级 `prepareFreshStack` 会创建全新的 workInProgress 树，从头开始遍历。这意味着：

- 之前低优先级已经 beginWork 的 Fiber 被丢弃
- 新的 render 会重新执行这些 Fiber 的 beginWork

为什么会这样？

因为 React 要保证高优先级更新基于最新的 props 和 state。低优先级 render 过程中可能基于旧状态做了很多计算，如果直接复用，可能会出现不一致。

### 6.3 bailout 条件：props 没变化时复用 subtree

虽然 workInProgress 被重置，但 React 会通过 `bailoutOnAlreadyFinishedWork` 跳过没有变化的子树：

```ts
function beginWork(current, workInProgress, renderLanes) {
	if (current !== null) {
		const oldProps = current.memoizedProps;
		const newProps = workInProgress.pendingProps;

		if (oldProps !== newProps || hasContextChanged()) {
			didReceiveUpdate = true;
		} else {
			// props 没有变化，检查 childLanes
			if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
				// 子树没有待处理更新，直接复用
				return bailoutOnAlreadyFinishedWork(
					current,
					workInProgress,
					renderLanes
				);
			}
			didReceiveUpdate = false;
		}
	}

	// ...
}
```

bailout 的条件：

1. `current !== null`（不是首次 mount）
2. `oldProps === newProps`（props 引用相同）
3. 子树的 `childLanes` 不包含当前 renderLanes

如果满足条件，React 会直接复用 current 的子树，不需要重新创建 Fiber。

### 6.4 childLanes 如何帮助跳过子树

每个 Fiber 节点都有 `lanes` 和 `childLanes`：

- `lanes`：该 Fiber 自身有待处理的 update lane
- `childLanes`：该 Fiber 的子树中有待处理的 update lane

当渲染某个 lane 时，React 会检查：

```ts
if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
	// 子树不需要更新
	return null; // 跳过
}
```

这就是 React 能跳过未变化子树的原理。

### 6.5 被打断和恢复时的 lanes 变化

**被打断前**：

```
Fiber.lanes = TransitionLane1
Fiber.childLanes = TransitionLane1
```

**被打断后**：

高优先级 render 以 InputContinuousLane 重新遍历。对于不需要更新的子树，childLanes 不包含 InputContinuousLane，所以跳过。

**恢复后**：

新的 TransitionLane2 render 遍历。因为 props/state 变化了，所以不能直接 bailout，需要重新 render。

### 6.6 哪些阶段会跳过

| 阶段                         | 是否跳过 | 原因                                  |
| ---------------------------- | -------- | ------------------------------------- |
| 低优先级的 commit            | 是       | 被打断，未进入 commit                 |
| 低优先级的部分 beginWork     | 是       | prepareFreshStack 重置 workInProgress |
| 高优先级 render 中未变化子树 | 是       | bailout / childLanes 判断             |
| 高优先级的 commit            | 否       | 必须更新 DOM                          |
| 恢复后的 Transition render   | 否       | 状态已变，必须重新 render             |

---

## 第 7 章 全局状态与源码速查

### 7.1 FiberRoot 字段速查

| 字段                         | 类型              | 作用                      |
| ---------------------------- | ----------------- | ------------------------- |
| current                      | FiberNode         | 当前显示树的根            |
| pendingLanes                 | Lanes             | 所有待处理 lane           |
| suspendedLanes               | Lanes             | 被 Suspense 挂起的 lane   |
| pingedLanes                  | Lanes             | 被 ping 恢复的 lane       |
| expiredLanes                 | Lanes             | 已过期的 lane             |
| finishedWork                 | FiberNode \| null | 本次完成的 workInProgress |
| finishedLane / finishedLanes | Lane / Lanes      | 本次完成的 lane           |
| callbackNode                 | any               | Scheduler 当前任务        |
| callbackPriority             | Lane              | 当前任务优先级            |

### 7.2 全局变量速查

| 变量                          | 类型                  | 作用                       |
| ----------------------------- | --------------------- | -------------------------- |
| workInProgress                | FiberNode \| null     | 当前处理的 Fiber           |
| workInProgressRoot            | FiberRootNode \| null | 当前 render 的 root        |
| workInProgressRootRenderLanes | Lanes                 | 当前 render 的 lanes       |
| executionContext              | ExecutionContext      | 当前执行上下文             |
| renderLanes                   | Lanes                 | 当前 render 消费的 lanes   |
| wipRootRenderLane             | Lane                  | 本次更新 lane（big-react） |

### 7.3 关键函数速查

| 函数                        | 职责                      |
| --------------------------- | ------------------------- |
| requestUpdateLane           | 为更新分配 lane           |
| getHighestPriorityLane      | 取最高优先级 lane         |
| markRootUpdated             | 把 lane 加入 pendingLanes |
| markRootFinished            | 从 pendingLanes 清除 lane |
| ensureRootIsScheduled       | 根据优先级调度任务        |
| performSyncWorkOnRoot       | 同步渲染入口              |
| performConcurrentWorkOnRoot | 并发渲染入口              |
| renderRootSync              | 同步 render               |
| renderRootConcurrent        | 并发 render               |
| workLoopSync                | 同步工作循环              |
| workLoopConcurrent          | 并发工作循环              |
| prepareFreshStack           | 准备新的 workInProgress   |
| commitRoot                  | 提交 DOM 更新             |
| shouldYield                 | 是否让出主线程            |

### 7.4 Lane 优先级速查

| Lane                | 优先级 | 触发方式                         |
| ------------------- | ------ | -------------------------------- |
| SyncLane            | 最高   | flushSync、离散事件              |
| InputContinuousLane | 高     | 连续输入事件                     |
| DefaultLane         | 中     | 普通 setState                    |
| TransitionLane      | 低     | useTransition / useDeferredValue |
| IdleLane            | 最低   | 闲时任务                         |

---

## 第 8 章 实战选型

### 8.1 startTransition vs useDeferredValue

| 维度               | startTransition | useDeferredValue |
| ------------------ | --------------- | ---------------- |
| 控制粒度           | 一段代码        | 一个值           |
| 使用位置           | 事件处理函数    | 组件 render      |
| 是否需要 isPending | 是              | 否               |
| 侵入性             | 需要改事件处理  | 只需要改 props   |
| 底层机制           | TransitionLane  | TransitionLane   |

### 8.2 选型决策树

```
这个更新是用户主动触发的吗？
├── 是
│   ├── 需要 Loading 状态？
│   │   ├── 是 → useTransition
│   │   └── 否 → startTransition（也能用 isPending=false）
│   └── 更新是否涉及多个状态？
│       ├── 是 → useTransition
│       └── 否 → useTransition 或 useDeferredValue
└── 否（是 props/state 频繁变化）
    └── 子组件渲染重吗？
        ├── 是 → useDeferredValue
        └── 否 → 不需要优化
```

### 8.3 与 Suspense 配合

```tsx
function App() {
	const [tab, setTab] = useState('home');

	return (
		<Suspense fallback={<Spinner />}>
			<button
				onClick={() => {
					startTransition(() => {
						setTab('photos');
					});
				}}
			>
				Photos
			</button>
			<TabContent tab={tab} />
		</Suspense>
	);
}
```

Transition + Suspense 的优势：

- 点击按钮后立即响应
- 旧 Tab 继续显示，新 Tab 内容在后台准备
- 不会立即显示 fallback，避免闪烁
- 如果准备时间过长， fallback 才出现

### 8.4 与 useOptimistic 配合

```tsx
function Thread({ messages }) {
	const [optimisticMessages, addOptimisticMessage] = useOptimistic(
		messages,
		(state, newMessage) => [...state, { ...newMessage, sending: true }]
	);

	async function sendMessage(formData) {
		const message = formData.get('message');
		addOptimisticMessage({ text: message });
		await api.sendMessage(message);
	}

	return (
		<form action={sendMessage}>
			{optimisticMessages.map((msg) => (
				<div key={msg.id} style={{ opacity: msg.sending ? 0.5 : 1 }}>
					{msg.text}
				</div>
			))}
			<input name="message" />
		</form>
	);
}
```

`useOptimistic` 是 React 18 的另一个 concurrent hook，用于乐观更新。它和 transition 一样底层也是基于 `ReactCurrentBatchConfig.transition`。

### 8.5 性能测试与验证

#### 1. 使用 React DevTools Profiler

- 开启"Record why each component rendered"
- 观察 render 阶段耗时
- 确认 transition 更新被标记为低优先级

#### 2. 使用 Performance 面板

- 对比使用 transition 前后的长任务数量
- 观察 input 事件的响应时间
- 确认 5ms 时间切片的存在

#### 3. 使用 Chrome DevTools 的 Frame Rendering Stats

- 观察帧率是否稳定在 60fps
- 确认没有掉帧

### 8.6 常见踩坑

#### 坑 1：在 transition 回调中读取最新 state

```tsx
startTransition(() => {
	setQuery(value);
	console.log(query); // 还是旧值
});
```

解决：使用函数式更新或 useEffect。

#### 坑 2：transition 中执行副作用

```tsx
startTransition(() => {
	fetchData(); // 副作用！
	setQuery(value);
});
```

解决：副作用放在 useEffect 中。

#### 坑 3：认为 transition 一定异步

如果当前只有 TransitionLane 一个更新，它可能同步执行。

#### 坑 4：过度使用 useDeferredValue

```tsx
function LightComponent({ value }) {
	const deferredValue = useDeferredValue(value); // 不需要！
	return <span>{deferredValue}</span>;
}
```

解决：只有子树渲染重时才使用。

#### 坑 5：忘记 createRoot

```tsx
ReactDOM.render(<App />, root); // LegacyRoot，transition 无效！
```

解决：使用 `createRoot`。

---

# 文档二结束

这两篇文章从"自下而上的知识体系"和"生命周期螺旋式追踪"两个角度，完整讲解了 React 18 并发优先级的实现原理。建议先读文档一建立基础概念，再读文档二跟随源码链路加深理解。
