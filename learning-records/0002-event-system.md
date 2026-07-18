# 学习记录 0002: 浏览器事件流与 big-react 合成事件系统

## 决策

在 SyntheticEvent.ts 中实现事件委托（委托在容器上）+ 自实现捕获/冒泡遍历 + Scheduler 优先级映射的合成事件系统。

## 关键洞察

### 1. 浏览器原生事件三阶段是合成事件的"地基"

- **捕获阶段** (eventPhase=1)：从 Window 向下到达目标。addEventListener(fn, true) 在此阶段触发。
- **目标阶段** (eventPhase=2)：事件到达实际点击的元素。此阶段按注册顺序触发，不受 capture 参数影响。
- **冒泡阶段** (eventPhase=3)：从目标向上回到 Window。addEventListener(fn, false) 的默认行为。

口诀："祖先捕获向下走，到达目标执行后，再从子向上冒泡回"。

### 2. React 合成事件用 unshift/push 模拟捕获/冒泡顺序

collectPaths 从 target 向上遍历（先遇到内层，后遇到外层）：
- 捕获回调用 `unshift`（倒序插入）→ 保证从外到内执行
- 冒泡回调用 `push`（正序插入）→ 保证从内到外执行

这和浏览器原生行为完全一致。

### 3. __stopPropagation 标记的双重检查是精妙设计

createSyntheticEvent 覆盖了原生 stopPropagation，加入了 React 自己的 `__stopPropagation` 标记。这个标记被检查了两次：

- triggerEventFlow 的 for 循环中（L93）：阶段内中断，阻止同阶段剩余的监听器执行
- dispatchEvent 中（L80）：阶段间中断，捕获阶段如果被阻止，跳过整个冒泡阶段

这对应了浏览器原生行为的两个层面：用户调用 stopPropagation 后，原生事件不再冒泡（区间间中断），同元素后续监听器不受影响（由 stopImmediatePropagation 负责）。

### 4. React 16 和 React 18 合成事件的核心区别

- **React 16**：合成事件用于"批处理收集更新"——事件回调中多次 setState 只触发一次渲染。
- **React 18**：合成事件转型为"优先级分配器"——根据事件类型（click vs scroll）分配不同的 Scheduler 优先级，支撑并发渲染的"交互不卡顿"体验。

### 5. 事件委托能工作的前提是该事件会冒泡

focus/blur/mouseenter/mouseleave/load/error/scroll 等事件不冒泡，无法委托给祖先。focus/blur 用 focusin/focusout 替代，mouseenter/leave 用 mouseover/out 替代。scroll 用 passive 选项优化但不能委托。

## 影响范围

- 所有通过 onClick/onClickCapture 等 React 事件绑定的用户回调
- Scheduler 的 runWithPriority 调用——事件类型影响更新优先级
- hostConfig.ts 中的 updateFiberProps→DOM.__props 存储 React props 供事件系统读取

## 关联文件

- `packages/react-dom/src/SyntheticEvent.ts` — 合成事件核心实现
- `packages/react-dom/src/hostConfig.ts` — 通过 updateFiberProps 将 props 写入 DOM
- `packages/react-reconciler/src/completeWork.ts` — 更新时调用 updateFiberProps
- `reference/event-flow-reference.html` — 事件流速查表
- `lessons/0001-event-capture-bubble-synthetic.html` — 配套课程
