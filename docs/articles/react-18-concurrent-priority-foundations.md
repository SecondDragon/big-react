## 第 7 章 高优先级打断低优先级全过程

### 7.1 场景构造

回到 `useTransition` 的例子：

```tsx
function App() {
	const [inputValue, setInputValue] = useState('');
	const [query, setQuery] = useState('');
	const [isPending, startTransition] = useTransition();

	const handleChange = (e) => {
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

假设用户输入了一个字符 'a'，Transition 更新开始渲染列表。渲染到一半时，用户又输入了 'b'。

这时会发生什么？

1. Transition 更新正在以 TransitionLane 渲染列表（低优先级）
2. 输入事件触发 `setInputValue('b')`，获得 InputContinuousLane（高优先级）
3. React 必须打断当前 Transition 渲染，先处理高优先级更新
4. 输入框立即显示 'b'
5. Transition 更新被取消，新的 Transition 更新（query='b'）重新调度
6. 列表最终渲染 'b' 的结果

### 7.2 ensureRootIsScheduled：重新评估优先级

每次有新的更新时，都会调用 `ensureRootIsScheduled`：

```ts
// big-react 风格简化版

function ensureRootIsScheduled(root: FiberRootNode) {
	const existingCallbackNode = root.callbackNode;

	// 1. 获取下一个要处理的 lane
	const nextLanes = getHighestPriorityLane(root.pendingLanes);
	if (nextLanes === NoLanes) {
		if (existingCallbackNode !== null) {
			cancelCallback(existingCallbackNode);
		}
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}

	const newCallbackPriority = nextLanes;
	const existingCallbackPriority = root.callbackPriority;

	// 2. 如果优先级相同，复用已有 callback
	if (
		existingCallbackNode !== null &&
		newCallbackPriority === existingCallbackPriority
	) {
		return;
	}

	// 3. 取消旧的 callback
	if (existingCallbackNode !== null) {
		cancelCallback(existingCallbackNode);
	}

	// 4. 根据优先级调度新的 callback
	let newCallbackNode;
	if (newCallbackPriority === SyncLane) {
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, nextLanes));
		scheduleMicroTask(flushSyncCallbacks);
		newCallbackNode = null;
	} else {
		const schedulerPriorityLevel = laneToSchedulerPriority(newCallbackPriority);
		newCallbackNode = scheduleCallback(
			schedulerPriorityLevel,
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}

	root.callbackPriority = newCallbackPriority;
	root.callbackNode = newCallbackNode;
}
```

关键点：

1. 保存 `existingCallbackNode`
2. 获取 `nextLanes`（最高优先级的 lane）
3. 如果新优先级高于旧优先级，取消旧 callback，调度新 callback
4. 更新 `root.callbackPriority` 和 `root.callbackNode`

### 7.3 输入事件打断 Transition 的完整流程

**初始状态**：

```
pendingLanes = 0b00000
callbackNode = null
callbackPriority = NoLane
workInProgressRoot = null
```

**Step 1：用户输入 'a'，触发 startTransition**

```ts
setInputValue('a'); // DefaultLane
startTransition(() => setQuery('a')); // TransitionLane1
```

调度后：

```
pendingLanes = DefaultLane | TransitionLane1
callbackPriority = DefaultLane
callbackNode = task1
```

注意：虽然同时有 DefaultLane 和 TransitionLane1，但 DefaultLane 优先级更高，所以先调度 DefaultLane 的 callback。

实际上，由于 `setInputValue` 和 `setPending(true)`、`setQuery('a')`、`setPending(false)` 都在同一个事件回调里，React 18 的自动批处理会把它们一起处理。最终 `pendingLanes` 会包含 DefaultLane 和 TransitionLane1。

Scheduler 根据最高优先级（DefaultLane）调度 `performConcurrentWorkOnRoot`。但 render 开始前，React 会调用 `getNextLanes` 获取所有 lanes。

**Step 2：开始渲染**

```ts
performConcurrentWorkOnRoot(root, false);
```

进入函数：

```ts
const originalCallbackNode = root.callbackNode; // task1
```

调用 `flushPassiveEffects()`，假设没有 pending effects。

调用 `getNextLanes`，得到 `DefaultLane | TransitionLane1`。

判断 `shouldTimeSlice = !includesBlockingLane(root, lanes) && !didTimeout`。

假设没有阻塞 lane，走并发渲染。

```ts
renderRootConcurrent(root, DefaultLane | TransitionLane1);
```

`prepareFreshStack` 创建新的 workInProgress。

`workLoopConcurrent` 开始遍历 Fiber 树。

**Step 3：Transition 渲染到一半，用户输入 'b'**

此时 `workLoopConcurrent` 正在处理某个 Fiber，但 5ms 时间片还没到，继续执行。

浏览器 onChange 事件触发，调用 `handleChange`：

```ts
setInputValue('b'); // InputContinuousLane
startTransition(() => setQuery('b')); // TransitionLane2
```

`dispatchSetState` 触发 `scheduleUpdateOnFiber`：

```ts
scheduleUpdateOnFiber(fiber, InputContinuousLane);
```

内部调用 `markRootUpdated(root, InputContinuousLane)`：

```
pendingLanes = DefaultLane | TransitionLane1 | InputContinuousLane | TransitionLane2
```

然后调用 `ensureRootIsScheduled(root)`：

- `existingCallbackNode = task1`
- `nextLanes = InputContinuousLane`（最高优先级）
- `newCallbackPriority = InputContinuousLane`
- `existingCallbackPriority = DefaultLane`
- 新优先级更高，取消 task1
- 调度 task2：`scheduleCallback(UserBlockingPriority, performConcurrentWorkOnRoot)`

更新后：

```
callbackNode = task2
callbackPriority = InputContinuousLane
```

**Step 4：原任务发现 callbackNode 被替换**

当前正在执行的 `performConcurrentWorkOnRoot` 还在 `renderRootConcurrent` 的 `workLoopConcurrent` 中。它继续执行，直到：

- 处理完当前 Fiber
- 下一次循环检查 `shouldYield()`
- `shouldYield()` 可能返回 true，因为时间片到了，或者 taskQueue 里有更高优先级的任务

`workLoopConcurrent` 退出，`renderRootConcurrent` 返回 `RootInProgress`。

回到 `performConcurrentWorkOnRoot`：

```ts
if (exitStatus !== RootInProgress) {
	// 不会进入 commit
}

if (root.callbackNode === originalCallbackNode) {
	return performConcurrentWorkOnRoot.bind(null, root);
}

return null;
```

此时 `root.callbackNode` 已经是 task2，而 `originalCallbackNode` 是 task1，不相等。所以返回 `null`。

这意味着：原任务放弃继续执行，让 Scheduler 调度新的高优先级任务。

**Step 5：高优先级任务执行**

Scheduler 调度 task2：`performConcurrentWorkOnRoot(root, false)`。

进入函数：

```ts
const originalCallbackNode = root.callbackNode; // task2
```

调用 `flushPassiveEffects()`，假设没有。

调用 `getNextLanes`，得到 `InputContinuousLane`。

`prepareFreshStack(root, InputContinuousLane)`：

- 创建新的 workInProgress
- 丢弃旧的 workInProgress
- `workInProgressRoot = root`
- `workInProgressRootRenderLanes = InputContinuousLane`

`renderRootConcurrent` 以 InputContinuousLane 重新渲染整棵树。

由于 InputContinuousLane 优先级高，React 会尽可能快地完成 render 并 commit。

输入框显示 'b'，isPending 可能显示 Loading。

**Step 6：高优先级 commit 后重新调度 Transition**

`commitRoot(root)` 完成 DOM 更新后：

```ts
markRootFinished(root, InputContinuousLane);
// pendingLanes = DefaultLane | TransitionLane1 | TransitionLane2
```

`commitRoot` 末尾调用 `ensureRootIsScheduled(root)`：

- `nextLanes = DefaultLane`（最高优先级）
- 调度 task3：`performConcurrentWorkOnRoot(root)`

实际上，DefaultLane 可能已经包含在之前的 pendingLanes 中，需要进一步处理。但通常 transition 是主要剩余任务。

假设 DefaultLane 也很快完成，最终剩下 TransitionLane1 和 TransitionLane2。

```
pendingLanes = TransitionLane1 | TransitionLane2
```

由于 TransitionLane2 更新，旧的 TransitionLane1 已经不需要了。React 会通过 lane 更新机制，只保留最新的 TransitionLane。

实际上，`setQuery('b')` 会替换 `query` state，所以下一次 render 会以 `query='b'` 为准。TransitionLane1 对应的是 query='a'，已经过时。

React 如何处理过时的 TransitionLane？它通过 `entanglements` 和 `updateQueue` 的处理来实现。在 processUpdateQueue 中，只有 lane 匹配的 update 才会被消费。

**Step 7：新的 Transition 完成**

Scheduler 调度 task3，执行 `performConcurrentWorkOnRoot`。

`getNextLanes` 得到 TransitionLane2。

`renderRootConcurrent` 渲染列表，query='b'。

完成后 `commitRoot`，列表显示 'b' 的结果。

### 7.4 状态变化表

| 阶段            | pendingLanes                                                             | callbackNode | callbackPriority    | workInProgressRoot | 说明                                             |
| --------------- | ------------------------------------------------------------------------ | ------------ | ------------------- | ------------------ | ------------------------------------------------ |
| 初始            | 0                                                                        | null         | NoLane              | null               | 无更新                                           |
| 输入 'a'        | DefaultLane \| TransitionLane1                                           | task1        | DefaultLane         | root               | 调度 DefaultLane 任务                            |
| 开始渲染        | DefaultLane \| TransitionLane1                                           | task1        | DefaultLane         | root               | originalCallbackNode = task1                     |
| 输入 'b'        | DefaultLane \| TransitionLane1 \| InputContinuousLane \| TransitionLane2 | task2        | InputContinuousLane | root               | 取消 task1，调度 task2                           |
| 原任务退出      | 同上                                                                     | task2        | InputContinuousLane | root               | callbackNode !== originalCallbackNode，返回 null |
| 高优先级 render | InputContinuousLane                                                      | task2        | InputContinuousLane | root               | prepareFreshStack 重置 workInProgress            |
| 高优先级 commit | DefaultLane \| TransitionLane1 \| TransitionLane2                        | task3        | DefaultLane         | null               | markRootFinished 清除 InputContinuousLane        |
| Transition 完成 | 0                                                                        | null         | NoLane              | null               | 列表显示 'b'                                     |

### 7.5 为什么用户看不到半成品 UI？

这是并发渲染的关键保证。低优先级的 render 被打断后：

1. **不会进入 commit 阶段**：只有 `exitStatus !== RootInProgress` 才会 commit。被打断时返回 `RootInProgress`，不会 commit。
2. **workInProgress 被丢弃**：高优先级 `prepareFreshStack` 会创建新的 workInProgress，旧的 workInProgress 不再被使用。
3. **DOM 保持旧状态**：直到新的高优先级 render 完成并 commit，DOM 才会更新。

所以用户始终看到的是一致的 UI：要么是旧值，要么是新值，不会看到"半新半旧"的状态。

### 7.6 被打断的 Transition 如何恢复？

低优先级 lane 仍然保留在 `pendingLanes` 中。高优先级 commit 后，`ensureRootIsScheduled` 会再次调度。

这次调度时：

- `pendingLanes` 中可能有过时的 TransitionLane1 和新的 TransitionLane2
- `getNextLanes` 会取最高优先级的 lane
- React 会跳过过时的 update（通过 `updateQueue` 的 lane 匹配）

最终只渲染最新的 transition 结果。

---

## 第 8 章 全局状态与标志位总览

### 8.1 FiberRoot 并发相关字段

| 字段                         | 类型              | 作用                          | 变化时机                           |
| ---------------------------- | ----------------- | ----------------------------- | ---------------------------------- |
| current                      | FiberNode         | 当前屏幕显示树的根节点        | commitRoot 后切换                  |
| pendingLanes                 | Lanes             | 所有待处理更新的 lane 集合    | markRootUpdated / markRootFinished |
| suspendedLanes               | Lanes             | 被 Suspense 挂起的 lane       | Suspense 触发时                    |
| pingedLanes                  | Lanes             | 被 ping 恢复的 lane           | Suspense 恢复时                    |
| expiredLanes                 | Lanes             | 已过期的 lane（饥饿处理）     | markStarvedLanesAsExpired          |
| mutableReadLanes             | Lanes             | useMutableSource 读取的 lane  | useMutableSource 更新时            |
| entangledLanes               | Lanes             | 纠缠在一起的 lanes            | entangleTransitions                |
| finishedWork                 | FiberNode \| null | 本次完成渲染的 workInProgress | render 完成后赋值                  |
| finishedLane / finishedLanes | Lane / Lanes      | 本次完成渲染的 lane           | render 完成后赋值                  |
| callbackNode                 | any               | Scheduler 当前调度的任务节点  | ensureRootIsScheduled              |
| callbackPriority             | Lane              | 当前回调的优先级              | ensureRootIsScheduled              |

### 8.2 render 阶段全局变量

| 变量                          | 类型                  | 作用                            | 变化时机                              |
| ----------------------------- | --------------------- | ------------------------------- | ------------------------------------- |
| workInProgress                | FiberNode \| null     | 当前正在处理的 Fiber            | prepareFreshStack / performUnitOfWork |
| workInProgressRoot            | FiberRootNode \| null | 当前 render 的 root             | prepareFreshStack / render 完成       |
| workInProgressRootRenderLanes | Lanes                 | 当前 render 的 lanes            | prepareFreshStack                     |
| workInProgressRootExitStatus  | ExitStatus            | 当前 render 的退出状态          | render 完成时                         |
| executionContext              | ExecutionContext      | 当前执行上下文                  | 进入/退出 render/commit               |
| renderLanes                   | Lanes                 | 当前 render 消费的 lanes        | renderRootSync / renderRootConcurrent |
| wipRootRenderLane             | Lane                  | 本次更新的 lane（big-react 中） | prepareFreshStack                     |

### 8.3 Hook 内部 transition 状态

| 字段/变量                          | 类型           | 作用                              | 变化时机               |
| ---------------------------------- | -------------- | --------------------------------- | ---------------------- |
| ReactCurrentBatchConfig.transition | object \| null | 当前是否处于 transition 上下文    | startTransition 设置   |
| currentTransitionLane              | Lane           | 当前分配的 TransitionLane         | requestTransitionLane  |
| isPending state                    | boolean        | useTransition 返回的 pending 状态 | setPending(true/false) |

---

## 第 9 章 最佳实践与踩坑

### 9.1 什么时候用 startTransition

适用场景：

- Tab 切换时延迟加载新 Tab 内容
- 搜索输入时延迟过滤大数据列表
- 路由切换时延迟加载新页面
- 任何"状态更新可以慢一点，但交互必须立即响应"的场景

不适用场景：

- 需要立即反馈的输入（如受控输入框的 value）
- 动画相关状态
- 会导致后续逻辑依赖最新状态的操作

### 9.2 什么时候用 useDeferredValue

适用场景：

- 父组件向子组件传递一个会频繁变化的值
- 子组件渲染很重，希望用旧值先渲染
- 不想修改子组件内部逻辑，只想从外部延迟某个 props

不适用场景：

- 这个值是用户直接看到的输入框 value
- 这个值变化后需要立即执行副作用

### 9.3 startTransition vs useDeferredValue 选型

| 场景                     | 推荐方案         | 原因                                                                            |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------- |
| 主动触发一个耗时状态更新 | startTransition  | 可以控制 isPending Loading UI                                                   |
| 被动接收一个频繁变化的值 | useDeferredValue | 不需要修改数据源，延迟子树渲染                                                  |
| 输入框 + 大数据列表      | 两者皆可         | useTransition 拆分 input 和 list state；useDeferredValue 直接延迟 list 的 props |
| Tab 切换                 | startTransition  | 需要 isPending 显示切换中状态                                                   |

### 9.4 isPending 与 Loading UI

```tsx
function App() {
	const [isPending, startTransition] = useTransition();

	return (
		<div>
			<button
				onClick={() => {
					startTransition(() => {
						setTab('photos');
					});
				}}
			>
				Photos
			</button>
			{isPending && <Spinner />}
			<TabContent tab={tab} />
		</div>
	);
}
```

`isPending` 的好处：

- 让用户知道有一个耗时更新在进行中
- 可以配合 Skeleton 或 Spinner 提升体验
- 避免用户重复点击

### 9.5 Suspense + transition

```tsx
function App() {
	const [tab, setTab] = useState('home');

	return (
		<Suspense fallback={<Spinner />}>
			<TabButton
				onClick={() => {
					startTransition(() => {
						setTab('photos');
					});
				}}
			/>
			<TabContent tab={tab} />
		</Suspense>
	);
}
```

React 18 中，transition 配合 Suspense 可以实现：

- 旧 UI 继续显示，新 UI 准备中
- 不会显示"一闪而过"的 fallback
- 如果新 UI 准备时间超过阈值，再显示 fallback

这是 React 18 "Concurrent UI Patterns" 的重要组成部分。

### 9.6 flushSync 逃生舱

如果你确定某个更新必须立即同步执行，可以使用 `flushSync`：

```tsx
import { flushSync } from 'react-dom';

function handleClick() {
	flushSync(() => {
		setCount((c) => c + 1);
	});
	// 到这里 DOM 已经更新
	console.log(ref.current.textContent);
}
```

`flushSync` 会强制走 SyncLane，同步 render + commit。应谨慎使用，会打破并发优化。

### 9.7 常见误区

**误区 1：在 startTransition 里做副作用**

```tsx
startTransition(() => {
	fetchData(); // 错误！副作用不应该在这里
	setQuery(value);
});
```

正确做法：副作用放在 useEffect 中。

**误区 2：认为 transition 更新一定异步**

如果 transition 更新是最高优先级（没有其他高优先级更新），它仍然可能同步执行。

**误区 3：过度使用 useDeferredValue**

如果子组件渲染并不重，使用 `useDeferredValue` 反而会增加一次 render。

**误区 4：在 transition 中读取最新 state**

```tsx
startTransition(() => {
	setQuery(value);
	console.log(query); // 可能还是旧值
});
```

React 18 的自动批处理会让 `query` 仍然是旧值。

---

# 文档一结束

下一篇文档将从生命周期螺旋式角度，完整追踪 `useTransition`、`useDeferredValue` 和高优先级打断的源码执行链路。
