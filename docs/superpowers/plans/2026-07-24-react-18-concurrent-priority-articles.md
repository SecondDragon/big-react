# React 18 并发优先级实现深度解析 —— 双文档撰写计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 React 18 官方源码，撰写两篇 10000+ 字的技术长文，深入讲解低优先级更新、高优先级打断、`useTransition` 和 `useDeferredValue` 的实现原理，演示代码采用「官方源码 + big-react 风格简化版」对照。

**Architecture:** 文档一采用自下而上结构建立 Lane/Scheduler/并发渲染知识体系；文档二采用生命周期螺旋式结构追踪 API 调用链路。两篇共享同一组实战场景和源码约定。

**Tech Stack:** Markdown、React 18 源码、big-react 仓库代码风格（TypeScript + Prettier）。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `docs/articles/react-18-concurrent-priority-foundations.md` | 文档一：自下而上完整教程 |
| `docs/articles/react-18-concurrent-priority-lifecycle.md` | 文档二：生命周期螺旋式源码追踪 |

---

### Task 1: 创建输出目录

**Files:**
- Create: `docs/articles/`

- [ ] **Step 1: 创建目录**

Run:
```bash
mkdir -p docs/articles
```

Expected: 目录存在，无报错。

- [ ] **Step 2: Commit**

```bash
git add docs/articles
# 空目录通常不会被 git 跟踪，等 Task 2 创建文件后一起 commit
```

---

### Task 2: 撰写文档一第 1-2 章

**Files:**
- Create: `docs/articles/react-18-concurrent-priority-foundations.md`

- [ ] **Step 1: 写入第 1 章「为什么需要并发更新」**

内容要点：
- 同步长任务阻塞主线程的 Performance 火焰图说明
- LegacyRoot 与 ConcurrentRoot 的区别
- expirationTime 模型的问题与 Lane 模型的诞生背景

- [ ] **Step 2: 写入第 2 章「Lane 模型：位运算视角的优先级」**

必须包含的代码片段：

```ts
// big-react 风格简化版
export type Lane = number;
export type Lanes = number;

export const SyncLane = 0b00001;
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}
```

必须包含的函数讲解：
- `requestUpdateLane`
- `getHighestPriorityLane`
- `markRootUpdated` 与 `markRootFinished`
- `requestTransitionLane`

必须包含状态变化表：多个 lane 共存时 `pendingLanes` 的值变化。

- [ ] **Step 3: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-foundations.md
```

Expected: 当前累计至少 2000 字（约 4000 字节以上中文）。

- [ ] **Step 4: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-foundations.md
git commit -m "docs: foundations ch1-ch2 lane model"
```

---

### Task 3: 撰写文档一第 3-4 章

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-foundations.md`

- [ ] **Step 1: 写入第 3 章「Scheduler 与时间切片」**

必须包含的代码片段：

```js
// Scheduler 简化版
function unstable_scheduleCallback(priorityLevel, callback, options) {
  const currentTime = getCurrentTime();
  const startTime = options?.delay ? currentTime + options.delay : currentTime;
  let timeout;
  switch (priorityLevel) {
    case ImmediatePriority: timeout = -1; break;
    case UserBlockingPriority: timeout = 250; break;
    case IdlePriority: timeout = maxSigned31BitInt; break;
    case LowPriority: timeout = 10000; break;
    default: timeout = 5000; break;
  }
  const expirationTime = startTime + timeout;
  const newTask = { id: taskIdCounter++, callback, priorityLevel, startTime, expirationTime, sortIndex: -1 };
  if (startTime > currentTime) {
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
  } else {
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
  }
  return newTask;
}
```

- [ ] **Step 2: 写入第 4 章「同步渲染 vs 并发渲染」**

必须包含的代码片段：

```ts
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

必须解释：
- `performSyncWorkOnRoot` 与 `performConcurrentWorkOnRoot` 的差异
- `shouldTimeSlice` 判断条件
- `prepareFreshStack` 的作用

- [ ] **Step 3: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-foundations.md
```

Expected: 当前累计至少 5000 字。

- [ ] **Step 4: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-foundations.md
git commit -m "docs: foundations ch3-ch4 scheduler and work loop"
```

---

### Task 4: 撰写文档一第 5-6 章

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-foundations.md`

- [ ] **Step 1: 写入第 5 章「useTransition：把更新包成低优先级」**

必须包含完整可运行示例：搜索输入 + 10000 行列表。

必须包含的代码片段：

```ts
// mountTransition 简化版
function mountTransition() {
  const [isPending, setPending] = mountState(false);

  const start = (callback, options) => {
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

必须解释：
- `dispatchSetState(true)` 为什么能让 isPending 立即更新
- 用户回调内 `setQuery` 为什么走 Transition lane
- `requestUpdateLane` 如何检测 transition 上下文

- [ ] **Step 2: 写入第 6 章「useDeferredValue：让子树滞后更新」**

必须包含完整可运行示例：受控输入 + 5000 个矩形图表。

必须包含的代码片段：

```ts
function useDeferredValue(value, initialValue) {
  const [prevValue, setValue] = useState(value);

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

必须解释：
- 为什么用 useEffect 触发 setValue
- mount 和 update 阶段返回值的差异
- 与 useTransition 的异同

- [ ] **Step 3: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-foundations.md
```

Expected: 当前累计至少 8000 字。

- [ ] **Step 4: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-foundations.md
git commit -m "docs: foundations ch5-ch6 transition and deferred value"
```

---

### Task 5: 撰写文档一第 7-9 章

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-foundations.md`

- [ ] **Step 1: 写入第 7 章「高优先级打断低优先级全过程」**

必须包含状态变化表：
| 阶段 | pendingLanes | callbackNode | callbackPriority | workInProgressRoot | 触发函数 |
|------|--------------|--------------|------------------|--------------------|----------|
| Transition 开始 | TransitionLane | task1 | TransitionLane | root | scheduleCallback |
| 输入事件到达 | TransitionLane \| InputContinuousLane | task2 | InputContinuousLane | null | ensureRootIsScheduled |
| 高优先级 commit | TransitionLane | task3 | TransitionLane | root | ensureRootIsScheduled |

必须解释：
- `originalCallbackNode !== root.callbackNode` 的判定
- `prepareFreshStack` 如何丢弃旧 workInProgress
- 为什么用户看不到半成品 UI

- [ ] **Step 2: 写入第 8 章「全局状态与标志位总览」**

必须包含三张表：
- FiberRoot 并发相关字段表
- render 阶段全局变量表
- Hook 内部 transition 状态表

- [ ] **Step 3: 写入第 9 章「最佳实践与踩坑」**

必须包含：
- `startTransition` vs `useDeferredValue` 选型
- `isPending` 与 Loading UI
- Suspense + transition
- `flushSync` 逃生舱
- 常见误区

- [ ] **Step 4: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-foundations.md
```

Expected: 当前累计至少 10000 字。

- [ ] **Step 5: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-foundations.md
git commit -m "docs: foundations ch7-ch9 interruption and best practices"
```

---

### Task 6: 撰写文档二第 1-2 章

**Files:**
- Create: `docs/articles/react-18-concurrent-priority-lifecycle.md`

- [ ] **Step 1: 写入第 1 章「开场：一个会卡的页面」**

内容要点：
- 搜索输入 + 大数据列表场景
- 不用并发时的掉帧原因
- 并发模式心智模型：车道 + 时间切片 + 双缓冲

- [ ] **Step 2: 写入第 2 章「先补够用的基础」**

只讲本节需要的 Lane：`SyncLane`、`InputContinuousLane`、`DefaultLane`、`TransitionLanes`。

必须包含 big-react 风格简化版：

```ts
function requestUpdateLane() {
  const isTransition = ReactCurrentBatchConfig.transition !== null;
  if (isTransition) {
    return TransitionLane;
  }
  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
  return schedulerPriorityToLane(currentSchedulerPriority);
}

function ensureRootIsScheduled(root) {
  const updateLane = getHighestPriorityLane(root.pendingLanes);
  if (updateLane === NoLane) return;
  if (updateLane === SyncLane) {
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
    scheduleMicroTask(flushSyncCallbacks);
  } else {
    scheduleCallback(NormalPriority, performConcurrentWorkOnRoot.bind(null, root));
  }
}
```

- [ ] **Step 3: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-lifecycle.md
```

Expected: 当前累计至少 2000 字。

- [ ] **Step 4: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-lifecycle.md
git commit -m "docs: lifecycle ch1-ch2 introduction and basics"
```

---

### Task 7: 撰写文档二第 3 章 useTransition 完整生命周期

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-lifecycle.md`

- [ ] **Step 1: 写入 Step 1-2：Hook 创建与用户触发**

必须包含代码片段：
- `mountTransition` 源码
- `startTransition` 闭包绑定 `setPending`
- `dispatchSetState(fiber, queue, true)` 让 isPending 立即更新

- [ ] **Step 2: 写入 Step 3-4：调度与并发渲染**

必须包含代码片段：
- `scheduleUpdateOnFiber` → `markRootUpdated` → `ensureRootIsScheduled`
- `performConcurrentWorkOnRoot` 入口
- `renderRootConcurrent` 与 `workLoopConcurrent`

- [ ] **Step 3: 写入 Step 5-6：提交与 isPending 复位**

必须包含状态变化表：列出 6 个步骤中 `pendingLanes`、`callbackNode`、`wipRootRenderLane`、`workInProgress` 的值变化。

- [ ] **Step 4: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-lifecycle.md
```

Expected: 当前累计至少 6000 字。

- [ ] **Step 5: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-lifecycle.md
git commit -m "docs: lifecycle ch3 useTransition full lifecycle"
```

---

### Task 8: 撰写文档二第 4-5 章

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-lifecycle.md`

- [ ] **Step 1: 写入第 4 章「useDeferredValue 完整生命周期」**

必须包含：
- `mountDeferredValue` 与 `updateDeferredValue` 源码差异
- mount 阶段返回 value
- update 阶段先以旧值 render，commit 后 effect 触发 Transition lane 更新
- 与 useTransition 的差异表

- [ ] **Step 2: 写入第 5 章「高优先级打断低优先级专题」**

必须包含 6 个步骤：
1. 低优先级渲染中
2. 新事件到达
3. 调度器重新排队
4. 原任务让出
5. 高优先级渲染与提交
6. 低优先级恢复

必须包含详细状态变化表：每个 FiberRoot 字段和全局变量在两轮调度中的变化。

- [ ] **Step 3: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-lifecycle.md
```

Expected: 当前累计至少 9000 字。

- [ ] **Step 4: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-lifecycle.md
git commit -m "docs: lifecycle ch4-ch5 deferred value and interruption"
```

---

### Task 9: 撰写文档二第 6-8 章

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-lifecycle.md`

- [ ] **Step 1: 写入第 6 章「哪些阶段会被跳过、哪些会重新执行」**

必须解释：
- `workInProgressRoot` 被重置后旧 render 结果不提交
- 已 beginWork 的 Fiber 为什么需要重新做
- `didReceiveUpdate`、`bailout` 条件
- `childLanes` 如何帮助跳过子树
- `lanes`、`childLanes` 在被打断和恢复时的变化

- [ ] **Step 2: 写入第 7 章「全局状态与源码速查」**

必须包含：
- 字段、类型、作用、变化时机表
- 关键函数索引

- [ ] **Step 3: 写入第 8 章「实战选型」**

必须包含：
- `startTransition` vs `useDeferredValue` 选型
- 与 Suspense、`useOptimistic` 的配合
- 性能测试与验证方法

- [ ] **Step 4: 检查字数与格式**

Run:
```bash
wc -c docs/articles/react-18-concurrent-priority-lifecycle.md
```

Expected: 当前累计至少 10000 字。

- [ ] **Step 5: Commit**

```bash
git add docs/articles/react-18-concurrent-priority-lifecycle.md
git commit -m "docs: lifecycle ch6-ch8 bailout and best practices"
```

---

### Task 10: 交叉检查与质量校验

**Files:**
- Modify: `docs/articles/react-18-concurrent-priority-foundations.md`
- Modify: `docs/articles/react-18-concurrent-priority-lifecycle.md`

- [ ] **Step 1: 检查两篇文档的关键概念一致性**

检查项：
- Lane 定义是否一致
- `requestUpdateLane` 逻辑是否一致
- `useTransition` 执行链路是否一致
- `useDeferredValue` 执行链路是否一致
- 状态变化表中的字段名是否一致

- [ ] **Step 2: 扫描占位符与 TODO**

Run:
```bash
grep -n "TODO\|TBD\|待补充\|稍后" docs/articles/react-18-concurrent-priority-foundations.md docs/articles/react-18-concurrent-priority-lifecycle.md
```

Expected: 无匹配。

- [ ] **Step 3: 运行 Markdown lint（如有）**

Run:
```bash
# 仓库使用 Prettier，对 Markdown 同样适用
npx prettier --check "docs/articles/*.md"
```

Expected: 无格式错误。

- [ ] **Step 4: 最终提交**

```bash
git add docs/articles/
git commit -m "docs: complete React 18 concurrent priority articles"
```

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 两篇文档各 10000+ 字 | Task 5 Step 4、Task 9 Step 4 |
| 每个源码函数配 big-react 风格简化版 | Task 2 Step 2、Task 3 Step 1-2、Task 4 Step 1-2、Task 6 Step 2、Task 7 Step 1-3、Task 8 Step 1 |
| 每个关键阶段有状态变化表 | Task 4 Step 1、Task 5 Step 1、Task 7 Step 3、Task 8 Step 2 |
| 例子可运行，覆盖 mount/update/打断/恢复 | Task 4 Step 1-2、Task 7 Step 1-3、Task 8 Step 2 |
| 文字解释说明「为什么这样变」 | 所有写入任务均需满足 |

### 2. Placeholder scan

无 `TODO`、`TBD`、`待补充`、`稍后` 等占位符。

### 3. Type consistency

- `Lane` / `Lanes` 类型在文档一第 2 章和文档二第 2 章一致。
- `pendingLanes`、`callbackNode`、`callbackPriority`、`workInProgressRoot` 等字段名在两篇文档中一致。
- `TransitionLane` 在两篇文档中表示同一概念。
