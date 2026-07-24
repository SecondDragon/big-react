## 第 3 章 Scheduler 与时间切片

### 3.1 Scheduler 的作用

Scheduler 是 React 18 并发渲染的底层基础设施。它负责两件事：

1. **任务调度**：根据优先级把任务放入队列，高优先级任务先执行
2. **时间切片**：让低优先级任务在每一帧执行一小段时间后主动让出主线程

你可以把 Scheduler 理解成一个浏览器版的"协作式多任务调度器"。React 把一次渲染拆成很多小任务，Scheduler 负责决定：

- 现在该执行哪个任务？
- 这个任务已经执行多久了？
- 是否需要让出主线程给浏览器绘制？

### 3.2 unstable_scheduleCallback：把任务加入队列

```js
// React 18 官方源码风格（简化版）

function unstable_scheduleCallback(priorityLevel, callback, options) {
  const currentTime = getCurrentTime();
  const startTime =
    typeof options === 'object' && options !== null && options.delay != null
      ? currentTime + options.delay
      : currentTime;

  let timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = -1;
      break;
    case UserBlockingPriority:
      timeout = 250;
      break;
    case IdlePriority:
      timeout = maxSigned31BitInt;
      break;
    case LowPriority:
      timeout = 10000;
      break;
    case NormalPriority:
    default:
      timeout = 5000;
      break;
  }

  const expirationTime = startTime + timeout;

  const newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1
  };

  if (startTime > currentTime) {
    // 延迟任务，放入 timerQueue
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);

    // 如果 taskQueue 为空且当前任务是 timerQueue 里最早的，注册定时器
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      if (isHostTimeoutScheduled) {
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 立即执行的任务，放入 taskQueue
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);

    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}
```

关键点：

1. **startTime**：任务什么时候开始可以被执行。如果 `options.delay` 存在，则延迟启动。
2. **timeout**：根据优先级决定的超时时间。优先级越低，timeout 越大，过期时间越晚。
3. **expirationTime**：`startTime + timeout`，任务最晚什么时候必须执行。
4. **sortIndex**：最小堆的排序依据。对于 taskQueue，按 `expirationTime` 排序；对于 timerQueue，按 `startTime` 排序。

优先级与 timeout 的关系：

| 优先级 | timeout | 含义 |
|--------|---------|------|
| ImmediatePriority | -1 | 立即过期，必须马上执行 |
| UserBlockingPriority | 250ms | 用户阻塞型任务，很快过期 |
| NormalPriority | 5000ms | 普通任务，5 秒内必须执行 |
| LowPriority | 10000ms | 低优先级任务 |
| IdlePriority | 最大整数 | 永远不强制过期，等主线程空闲 |

### 3.3 最小堆

Scheduler 使用最小堆（min-heap）管理 taskQueue 和 timerQueue。堆顶是 sortIndex 最小的任务。

```js
// 最小堆简化版

function push(heap, node) {
  const index = heap.length;
  heap.push(node);
  siftUp(heap, node, index);
}

function peek(heap) {
  return heap.length === 0 ? null : heap[0];
}

function pop(heap) {
  if (heap.length === 0) return null;
  const first = heap[0];
  const last = heap.pop();
  if (last !== first) {
    heap[0] = last;
    siftDown(heap, last, 0);
  }
  return first;
}
```

最小堆保证：

- 取堆顶 `peek()` 是 O(1)
- 插入 `push()` 和弹出 `pop()` 是 O(log n)

### 3.4 unstable_shouldYield：是否让出主线程

```js
// React 18 官方源码风格（简化版）

function unstable_shouldYield() {
  const currentTime = getCurrentTime();
  const firstTask = peek(taskQueue);

  return (
    // 有更高优先级任务到期
    (firstTask !== null &&
      firstTask.expirationTime > 0 &&
      firstTask.expirationTime <= currentTime) ||
    // 当前帧时间片用尽
    shouldYieldToHost()
  );
}

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  return timeElapsed >= yieldInterval; // yieldInterval 默认 5ms
}
```

`unstable_shouldYield` 返回 true 的两种情况：

1. **有更高优先级任务到期**：堆顶任务的 `expirationTime <= currentTime`，说明它已经过期，必须让出当前任务让更高优先级任务先执行。
2. **当前帧时间片用尽**：从当前 Scheduler 任务开始执行到现在已经超过 `yieldInterval`（默认 5ms），让出主线程给浏览器绘制。

`yieldInterval` 为什么是 5ms？因为浏览器一帧通常 16.6ms（60fps），React 给自己留了 5ms 做 JS 计算，剩下的时间给浏览器做样式计算、布局、绘制。这样可以保证用户体验流畅。

### 3.5 flushWork 与 workLoop

```js
// React 18 官方源码风格（简化版）

function flushWork(hasTimeRemaining, initialTime) {
  isHostCallbackScheduled = false;

  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;

  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentTask = null;
    currentPriorityLevel = NormalPriority;
    isPerformingWork = false;
  }
}

function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);

  while (currentTask !== null) {
    // 任务还没到期，退出
    if (
      currentTask.expirationTime > 0 &&
      currentTask.expirationTime > currentTime
    ) {
      break;
    }

    // 时间片用尽，退出
    if (!hasTimeRemaining || shouldYieldToHost()) {
      break;
    }

    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;

      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();

      if (typeof continuationCallback === 'function') {
        // 任务没做完，保存 continuation 下次继续
        currentTask.callback = continuationCallback;
      } else {
        // 任务完成，弹出
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }

      advanceTimers(currentTime);
    } else {
      pop(taskQueue);
    }

    currentTask = peek(taskQueue);
  }

  if (currentTask !== null) {
    return true; // 还有任务没做完
  } else {
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false; // 任务全部完成
  }
}
```

关键点：

1. **advanceTimers**：把 timerQueue 中 startTime 到期的任务移到 taskQueue。
2. **callback(didUserCallbackTimeout)**：执行 React 的任务，比如 `performConcurrentWorkOnRoot`。
3. **continuationCallback**：如果 React 的任务没做完（时间片用尽），返回一个函数，Scheduler 下次继续调度。
4. **return true / false**：告诉 Scheduler 是否还需要继续调度。

### 3.6 时间切片如何让出主线程

假设一个 Transition 更新需要渲染 1000 个 Fiber。如果没有时间切片，React 会一直执行直到整棵树渲染完成，期间主线程被阻塞。

有了时间切片，流程变成：

1. Scheduler 调度 `performConcurrentWorkOnRoot`
2. React 进入 `workLoopConcurrent`
3. 每处理一个 Fiber，检查 `shouldYield()`
4. 如果 5ms 到了，退出 `workLoopConcurrent`
5. `performConcurrentWorkOnRoot` 返回一个 continuation 函数
6. 浏览器有机会绘制一帧
7. Scheduler 下一帧继续调度 continuation

这样，一个 200ms 的渲染任务被拆成 40 个 5ms 的小任务，中间浏览器可以处理用户输入和动画。

---

## 第 4 章 同步渲染 vs 并发渲染

### 4.1 两种渲染入口

React 18 有两条渲染路径：

1. **同步渲染**：`performSyncWorkOnRoot` → `renderRootSync` → `workLoopSync`
2. **并发渲染**：`performConcurrentWorkOnRoot` → `renderRootConcurrent` → `workLoopConcurrent`

它们的区别主要在 `workLoop`：

```ts
// 同步工作循环
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

// 并发工作循环
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

`workLoopSync` 会一直跑到 `workInProgress === null`，也就是整棵树渲染完成。`workLoopConcurrent` 会在时间片用尽时退出。

### 4.2 performSyncWorkOnRoot

```ts
// big-react 风格简化版

function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
  const nextLane = getHighestPriorityLane(root.pendingLanes);
  if (nextLane !== SyncLane) {
    // 当前最高优先级不是同步，走并发调度
    ensureRootIsScheduled(root);
    return;
  }

  prepareFreshStack(root, lane);

  do {
    try {
      workLoopSync();
      break;
    } catch (error) {
      workInProgress = null;
    }
  } while (true);

  const finishedWork = root.current.alternate;
  root.finishedWork = finishedWork;
  root.finishedLane = lane;

  commitRoot(root);
}
```

同步渲染一旦开始就不会停。即使 render 阶段耗时很长，也会一直执行到 commit。

### 4.3 performConcurrentWorkOnRoot

```ts
// React 18 官方源码风格（简化版）

function performConcurrentWorkOnRoot(root, didTimeout) {
  const originalCallbackNode = root.callbackNode;

  // 1. 先清空上一轮 passive effects
  flushPassiveEffects();

  // 2. 重新读取最新的 lanes
  let lanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes
  );

  if (lanes === NoLanes) {
    return null;
  }

  // 3. 判断是否需要时间切片
  const shouldTimeSlice = !includesBlockingLane(root, lanes) && !didTimeout;

  // 4. 执行 render
  const exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes);

  if (exitStatus !== RootInProgress) {
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLanes = lanes;

    commitRoot(root);
  }

  // 5. 判断当前 callback 是否被替换
  if (root.callbackNode === originalCallbackNode) {
    return performConcurrentWorkOnRoot.bind(null, root);
  }

  return null;
}
```

关键点：

1. **`originalCallbackNode`**：进入函数时保存当前 root.callbackNode。如果 render 过程中被更高优先级任务替换，这个值会不等于新的 root.callbackNode。
2. **`flushPassiveEffects`**：在并发 render 前先把上一轮 useEffect 执行掉，避免 effect 中的 setState 影响当前 render。
3. **`getNextLanes`**：重新读取 pendingLanes，因为 flushPassiveEffects 可能触发了新的更新。
4. **`shouldTimeSlice`**：如果包含阻塞型 lane（如 SyncLane）或者已经超时，就回退到同步渲染。
5. **返回值**：如果当前 callbackNode 没有被替换，返回一个 continuation 函数，Scheduler 下次继续调度。

### 4.4 renderRootConcurrent

```ts
// React 18 官方源码风格（简化版）

function renderRootConcurrent(root, lanes) {
  // 如果已经在渲染中且 lanes 相同，继续
  if (root !== workInProgressRoot || lanes !== workInProgressRootRenderLanes) {
    prepareFreshStack(root, lanes);
  }

  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;

  do {
    try {
      workLoopConcurrent();
      break;
    } catch (thrownValue) {
      handleError(root, thrownValue);
    }
  } while (true);

  executionContext = prevExecutionContext;

  if (workInProgress !== null) {
    // 渲染被中断，但工作还在进行中
    return RootInProgress;
  }

  // 渲染完成
  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;
  return workInProgressRootExitStatus;
}
```

`renderRootConcurrent` 的核心是 `workLoopConcurrent`：

```ts
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

如果 `workInProgress !== null` 但循环退出，说明时间片用尽，渲染被中断。此时 `renderRootConcurrent` 返回 `RootInProgress`，`performConcurrentWorkOnRoot` 不会进入 commit，而是返回 continuation 等待下一次调度。

### 4.5 prepareFreshStack：准备工作栈

```ts
// big-react 风格简化版

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
  workInProgress = createWorkInProgress(
    root.current,
    root.current.pendingProps
  );
  workInProgressRoot = root;
  workInProgressRootRenderLanes = lane;
  wipRootRenderLane = lane;
}
```

`prepareFreshStack` 做三件事：

1. 基于 `root.current` 创建 workInProgress 树
2. 设置 `workInProgressRoot` 为当前 root
3. 设置 `workInProgressRootRenderLanes` 为本次要渲染的 lanes

这一步是 render 的起点。如果之前已经有一个正在进行的低优先级 render，新的高优先级更新到来时会重新调用 `prepareFreshStack`，丢弃旧的 workInProgress。

### 4.6 executionContext 与 RenderContext

`executionContext` 是一个位掩码，表示当前 React 处于什么执行上下文：

```ts
const NoContext = /*             */ 0b000;
const BatchedContext = /*        */ 0b001;
const RenderContext = /*         */ 0b010;
const CommitContext = /*         */ 0b100;
```

进入 render 阶段时：

```ts
executionContext |= RenderContext;
```

退出 render 阶段时：

```ts
executionContext = prevExecutionContext;
```

`requestUpdateLane` 会检查 `executionContext === RenderContext`，如果在 render 阶段触发更新，返回 `renderLanes`，避免优先级混乱。

### 4.7 同步 vs 并发的选择条件

React 18 默认走并发，但在以下情况会回退同步：

1. **LegacyRoot**：老版入口强制同步
2. **包含 SyncLane**：`includesBlockingLane(root, lanes)` 为 true
3. **任务超时**：`didTimeout` 为 true，Scheduler 发现这个任务已经过期，必须立即执行
4. **主动调用 `flushSync`**

```ts
const shouldTimeSlice = !includesBlockingLane(root, lanes) && !didTimeout;
```

这就是 React 18 "默认并发，但紧急时同步" 的核心逻辑。

---

## 第 5 章 useTransition：把更新包成低优先级

### 5.1 一个真实的卡顿场景

页面有一个搜索框，下面是一个大数据列表。用户每输入一个字符，列表就要重新过滤和渲染。如果列表有 10000 行，渲染一次可能需要 100-200ms。

在没有 `useTransition` 的情况下：

```tsx
function App() {
  const [query, setQuery] = useState('');

  const handleChange = (e) => {
    setQuery(e.target.value); // 普通 setState，DefaultLane
  };

  return (
    <div>
      <input value={query} onChange={handleChange} />
      <SearchResults query={query} />
    </div>
  );
}
```

每次输入都会触发 DefaultLane 更新。由于 React 的默认批处理，更新不会阻塞到下一次事件循环，但 render 阶段仍然是同步的。输入框和列表会一起重新渲染，用户会感觉到输入"跟手性"变差。

使用 `useTransition` 后：

```tsx
function App() {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleChange = (e) => {
    const value = e.target.value;
    setInputValue(value); // 高优先级：输入框立即更新
    startTransition(() => {
      setQuery(value); // 低优先级：列表稍后更新
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

效果：

- 输入框的值立即更新（InputContinuousLane 或 DefaultLane）
- 列表的更新被包裹成 TransitionLane，低优先级
- 如果用户输入很快，多个 Transition 更新可以合并，只有最后一个会真正渲染
- `isPending` 为 true 时可以显示 Loading 状态

### 5.2 useTransition 的 API 形态

```ts
function useTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void
]
```

返回一个元组：

- `isPending`：当前是否有 transition 更新在进行中
- `startTransition`：开始一个 transition 的函数

### 5.3 mountTransition 源码

```ts
// React 18 官方源码风格（简化版）

function mountTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void
] {
  const stateHook = mountStateImpl(false);
  const [isPending, setPending] = mountState(false);

  const start = startTransition.bind(null, setPending);

  mountEffect(() => {
    // 用来检测 transition 的优先级变化
    const transition = ReactCurrentBatchConfig.transition;
    // ...
  }, [isPending]);

  return [isPending, start];
}
```

简化一下，它的本质就是：

```ts
// big-react 风格简化版

function mountTransition() {
  // 1. 创建一个 state 表示是否 pending
  const [isPending, setPending] = mountState(false);

  // 2. 返回 startTransition 函数
  const start = (callback) => {
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

关键点：

1. `mountState(false)` 创建一个 Hook 保存 `isPending`
2. `startTransition` 闭包持有 `setPending` 和 queue
3. 执行用户回调前设置 `ReactCurrentBatchConfig.transition = {}`
4. 用户回调执行完后恢复 `ReactCurrentBatchConfig.transition = prevTransition`

### 5.4 startTransition 的执行链路

当用户调用 `startTransition(() => setQuery(value))` 时，内部发生了什么？

#### 第一步：setPending(true)

```ts
setPending(true);
```

这其实就是 `dispatchSetState(fiber, queue, true)`。这次更新发生在 transition 上下文建立之前，所以它走什么 lane？

答案是：**走普通 lane**（DefaultLane 或 SyncLane，取决于调用时机）。因为此时 `ReactCurrentBatchConfig.transition` 还没有被设置。

#### 第二步：设置 transition 上下文

```ts
const prevTransition = ReactCurrentBatchConfig.transition;
ReactCurrentBatchConfig.transition = {};
```

`ReactCurrentBatchConfig.transition` 是一个全局对象。只要它不为 null，`requestUpdateLane` 就会返回 Transition lane。

#### 第三步：执行用户回调

```ts
callback();
```

在回调中调用 `setQuery(value)`，触发 `dispatchSetState`：

```ts
function dispatchSetState(fiber, queue, action) {
  const lane = requestUpdateLane(fiber);
  // lane === TransitionLane
  const update = createUpdate(action, lane);
  enqueueUpdate(queue, update);
  scheduleUpdateOnFiber(fiber, lane);
}
```

因为 `ReactCurrentBatchConfig.transition !== null`，`requestUpdateLane` 返回 TransitionLane。

#### 第四步：恢复 transition 上下文

```ts
ReactCurrentBatchConfig.transition = prevTransition;
setPending(false);
```

`setPending(false)` 再次触发一次更新，这次同样可能走普通 lane。

### 5.5 为什么 isPending 能立即更新？

注意 `setPending(true)` 发生在设置 `ReactCurrentBatchConfig.transition = {}` 之前。这意味着：

1. `setPending(true)` 走普通 lane，高优先级
2. 用户回调里的 `setQuery(value)` 走 TransitionLane，低优先级
3. `setPending(false)` 发生在 finally 中，transition 上下文已恢复，走普通 lane

所以实际调度顺序是：

1. 高优先级：isPending = true
2. 低优先级：query = value（TransitionLane）
3. 高优先级：isPending = false

但 React 18 的自动批处理会把同一个事件循环里的 `setPending(true)` 和 `setPending(false)` 合并。所以用户通常只会看到一次 isPending 从 false 到 true 再到 false 的完整过程。

更准确地说，在 React 18 源码中，`startTransition` 对 `setPending(true)` 和 `setPending(false)` 的处理有特殊优化。它会先把 pending 状态改为 true，然后执行 transition 回调，回调执行完后再把 pending 改回 false。这两个 setState 都会被调度，但由于 transition 回调内部的更新是低优先级，isPending 的变化会优先渲染。

### 5.6 状态变化表：useTransition 一次调用

假设初始状态：

```
pendingLanes = 0b00000
isPending = false
query = ''
```

用户输入 'a'，触发 `handleChange`：

| 步骤 | 操作 | pendingLanes | isPending（queue 中） | query（queue 中） | lane |
|------|------|--------------|----------------------|-------------------|------|
| 1 | setInputValue('a') | DefaultLane | - | inputValue='a' | DefaultLane |
| 2 | setPending(true) | DefaultLane \| SyncLane | true | - | SyncLane/ DefaultLane |
| 3 | ReactCurrentBatchConfig.transition = {} | - | - | - | - |
| 4 | setQuery('a') | DefaultLane \| SyncLane \| TransitionLane1 | true | 'a' | TransitionLane1 |
| 5 | ReactCurrentBatchConfig.transition = prev | - | - | - | - |
| 6 | setPending(false) | DefaultLane \| SyncLane \| TransitionLane1 | false | 'a' | DefaultLane |

注意：实际源码中 `setPending(true)` 和 `setPending(false)` 的 lane 可能不同，取决于事件系统和 Scheduler 优先级。这里简化为普通 lane。

### 5.7 requestTransitionLane：从哪条 TransitionLane 开始

```ts
// React 18 官方源码风格（简化版）

let currentTransitionLane: Lane = SomeTransitionLane;

export function requestTransitionLane(): Lane {
  const lane = currentTransitionLane;
  currentTransitionLane <<= 1;
  if ((currentTransitionLane & TransitionLanes) === NoLanes) {
    currentTransitionLane = SomeTransitionLane;
  }
  return lane;
}
```

第一次调用返回 `SomeTransitionLane`，第二次返回它左移一位后的 lane，依次循环。

为什么要用 16 条 TransitionLane？

- 如果只有一条，多个并行的 transition 会互相覆盖 pendingLanes
- 多条可以让 React 区分"这是第几个 transition"，便于饥饿处理和取消旧 transition

### 5.8 useTransition 的本质

`useTransition` 的本质是：

1. 提供一个 state `isPending`
2. 提供一个函数 `startTransition`，在这个函数内部把 `ReactCurrentBatchConfig.transition` 设置为非 null
3. 这样用户回调里的 setState 都会被标记为 TransitionLane，变成低优先级
4. isPending 的 true/false 变化是高优先级，可以立即反映到 UI

它不是魔法，只是巧妙地利用了 `requestUpdateLane` 对 transition 上下文的检测。

---

## 第 6 章 useDeferredValue：让子树滞后更新

### 6.1 另一个卡顿场景

还是搜索输入 + 大数据列表，但这次我们想延迟的不是状态更新，而是某个子树的渲染。

```tsx
function App() {
  const [value, setValue] = useState('');
  const deferredValue = useDeferredValue(value);

  return (
    <div>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      <SearchResults query={deferredValue} />
    </div>
  );
}
```

效果：

- 输入框的值立即更新（value）
- 列表使用 `deferredValue`，滞后更新
- 用户输入时，列表保持旧值，等用户停止输入后再更新到新值

### 6.2 useDeferredValue 的 API 形态

```ts
function useDeferredValue<T>(value: T, initialValue?: T): T
```

- `value`：最新的值
- `initialValue`（可选）：首次渲染时使用的值
- 返回值：当前应该使用的值，可能是旧值也可能是新值

### 6.3 mountDeferredValue 源码

```ts
// React 18 官方源码风格（简化版）

function mountDeferredValue<T>(value: T, initialValue?: T): T {
  const hook = mountWorkInProgressHook();
  return mountDeferredValueImpl(hook, value, initialValue);
}

function mountDeferredValueImpl(hook, value, initialValue) {
  if (enableUseDeferredValueInitialArg) {
    // 如果提供了 initialValue，首次渲染用它
    const [prevValue, setValue] = mountState(
      initialValue !== undefined ? initialValue : value
    );
  } else {
    const [prevValue, setValue] = mountState(value);
  }

  mountEffect(() => {
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

简化版：

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

### 6.4 为什么用 useEffect 触发 setValue？

这是 `useDeferredValue` 最精妙的地方。

第一次渲染（mount）：

```ts
const [prevValue, setValue] = useState(value);
// prevValue === value
return prevValue;
```

直接返回 `value`。

后续更新：

1. 父组件传入新的 `value`
2. 组件重新 render
3. `useState(value)` 的 `value` 参数被忽略，因为 state 已经存在，所以 `prevValue` 仍然是旧值
4. 组件以旧值 render 完成
5. commit 阶段后，useEffect 执行
6. useEffect 中 `setValue(value)`，触发 TransitionLane 更新
7. 下一次 render 时，`prevValue` 变成新值

所以 `useDeferredValue` 的效果是：

- 第一次 render：返回新值
- 后续 update：先返回旧值，然后在 effect 中触发低优先级更新，下一次 render 再返回新值

如果没有 useEffect，直接在 render 中 setState 会造成死循环（render → setState → render）。useEffect 把 setState 推迟到 commit 之后，避免了这个问题。

### 6.5 initialValue 的处理

```ts
const [prevValue, setValue] = useState(
  initialValue !== undefined ? initialValue : value
);
```

如果提供了 `initialValue`，首次渲染返回 `initialValue` 而不是 `value`。这有什么用？

场景：一个弹窗组件，弹窗里的内容很重。可以传入 `initialValue=''`，让弹窗第一次出现时先渲染空内容，然后再用 Transition 渲染真实内容。这样弹窗动画不会被阻塞。

### 6.6 useDeferredValue 与 useTransition 的对比

| 特性 | useTransition | useDeferredValue |
|------|---------------|------------------|
| 控制对象 | 一段代码（startTransition 回调） | 一个值（props / state） |
| 是否提供 isPending | 是 | 否 |
| 使用方式 | 主动包裹 setState | 自动延迟某个值的变化 |
| 底层 lane | TransitionLane | TransitionLane |
| 适用场景 | 按钮点击、Tab 切换等主动触发 | 输入框、props 传递等被动变化 |

它们的底层实现都依赖 `ReactCurrentBatchConfig.transition`，都会生成 TransitionLane 更新。

### 6.7 useDeferredValue 状态变化表

初始 mount：

```
value = ''
prevValue = ''
deferredValue = ''
```

用户输入 'a'：

| 阶段 | value | prevValue | 触发更新 | lane | UI 显示 |
|------|-------|-----------|----------|------|---------|
| 第一次 render | 'a' | ''（旧值） | setValue('a') | DefaultLane | 输入框 'a'，列表 '' |
| commit + effect | 'a' | 未变 | setValue('a') 触发 | TransitionLane1 | 输入框 'a'，列表 '' |
| 第二次 render | 'a' | 'a' | 无 | TransitionLane1 | 输入框 'a'，列表 'a' |

### 6.8 连续输入时的合并

假设用户快速输入 'a'、'b'、'c'。

每次输入都会触发：

1. 高优先级 render：输入框更新，列表保持旧值
2. TransitionLane 更新：列表更新到新值

但如果上一次 TransitionLane 更新还没开始渲染，新的 TransitionLane 又到了，React 会：

- 取消旧的 TransitionLane 更新（通过更新 pendingLanes）
- 只保留最新的 TransitionLane 更新

这样列表最终只会渲染一次，显示 'c' 对应的结果。

---

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

| 阶段 | pendingLanes | callbackNode | callbackPriority | workInProgressRoot | 说明 |
|------|--------------|--------------|------------------|--------------------|------|
| 初始 | 0 | null | NoLane | null | 无更新 |
| 输入 'a' | DefaultLane \| TransitionLane1 | task1 | DefaultLane | root | 调度 DefaultLane 任务 |
| 开始渲染 | DefaultLane \| TransitionLane1 | task1 | DefaultLane | root | originalCallbackNode = task1 |
| 输入 'b' | DefaultLane \| TransitionLane1 \| InputContinuousLane \| TransitionLane2 | task2 | InputContinuousLane | root | 取消 task1，调度 task2 |
| 原任务退出 | 同上 | task2 | InputContinuousLane | root | callbackNode !== originalCallbackNode，返回 null |
| 高优先级 render | InputContinuousLane | task2 | InputContinuousLane | root | prepareFreshStack 重置 workInProgress |
| 高优先级 commit | DefaultLane \| TransitionLane1 \| TransitionLane2 | task3 | DefaultLane | null | markRootFinished 清除 InputContinuousLane |
| Transition 完成 | 0 | null | NoLane | null | 列表显示 'b' |

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

| 字段 | 类型 | 作用 | 变化时机 |
|------|------|------|----------|
| current | FiberNode | 当前屏幕显示树的根节点 | commitRoot 后切换 |
| pendingLanes | Lanes | 所有待处理更新的 lane 集合 | markRootUpdated / markRootFinished |
| suspendedLanes | Lanes | 被 Suspense 挂起的 lane | Suspense 触发时 |
| pingedLanes | Lanes | 被 ping 恢复的 lane | Suspense 恢复时 |
| expiredLanes | Lanes | 已过期的 lane（饥饿处理） | markStarvedLanesAsExpired |
| mutableReadLanes | Lanes | useMutableSource 读取的 lane | useMutableSource 更新时 |
| entangledLanes | Lanes | 纠缠在一起的 lanes | entangleTransitions |
| finishedWork | FiberNode \| null | 本次完成渲染的 workInProgress | render 完成后赋值 |
| finishedLane / finishedLanes | Lane / Lanes | 本次完成渲染的 lane | render 完成后赋值 |
| callbackNode | any | Scheduler 当前调度的任务节点 | ensureRootIsScheduled |
| callbackPriority | Lane | 当前回调的优先级 | ensureRootIsScheduled |

### 8.2 render 阶段全局变量

| 变量 | 类型 | 作用 | 变化时机 |
|------|------|------|----------|
| workInProgress | FiberNode \| null | 当前正在处理的 Fiber | prepareFreshStack / performUnitOfWork |
| workInProgressRoot | FiberRootNode \| null | 当前 render 的 root | prepareFreshStack / render 完成 |
| workInProgressRootRenderLanes | Lanes | 当前 render 的 lanes | prepareFreshStack |
| workInProgressRootExitStatus | ExitStatus | 当前 render 的退出状态 | render 完成时 |
| executionContext | ExecutionContext | 当前执行上下文 | 进入/退出 render/commit |
| renderLanes | Lanes | 当前 render 消费的 lanes | renderRootSync / renderRootConcurrent |
| wipRootRenderLane | Lane | 本次更新的 lane（big-react 中） | prepareFreshStack |

### 8.3 Hook 内部 transition 状态

| 字段/变量 | 类型 | 作用 | 变化时机 |
|-----------|------|------|----------|
| ReactCurrentBatchConfig.transition | object \| null | 当前是否处于 transition 上下文 | startTransition 设置 |
| currentTransitionLane | Lane | 当前分配的 TransitionLane | requestTransitionLane |
| isPending state | boolean | useTransition 返回的 pending 状态 | setPending(true/false) |

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

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| 主动触发一个耗时状态更新 | startTransition | 可以控制 isPending Loading UI |
| 被动接收一个频繁变化的值 | useDeferredValue | 不需要修改数据源，延迟子树渲染 |
| 输入框 + 大数据列表 | 两者皆可 | useTransition 拆分 input 和 list state；useDeferredValue 直接延迟 list 的 props |
| Tab 切换 | startTransition | 需要 isPending 显示切换中状态 |

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
    setCount(c => c + 1);
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
