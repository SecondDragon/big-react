# 为什么 mount 时只执行一次 Placement？

## 一个具体的例子

我们的 Demo 代码：

```jsx
import React from 'react';
import ReactDOM from 'react-dom';

function App({ children }) {
  return <div>{children}</div>;
}

const jsx = <App><div><span>big-react</span></div></App>;

ReactDOM.createRoot(document.getElementById('root')).render(jsx);
```

这段代码会生成如下 fiber 树（5 层深度）：

```
🔴 HostRoot (虚拟根节点, tag=3)
  └─ 🟢 AppFiber (函数组件, tag=0)
       └─ 🔵 divFiber (HostComponent, tag=5)
            └─ 🔵 spanFiber (HostComponent, tag=5)
                 └─ ⚪ "big-react" (HostText, tag=6)
```

---

## 第一部分：整个流程的总览

```mermaid
flowchart TB
    subgraph "🎬 阶段 1: beginWork（递）"
        direction TB
        BW1["HostRoot beginWork<br/>从updateQueue取出ReactElement"]
        BW2["reconcilerChildren<br/>判断 wip.alternate"]
        BW3["创建子Fiber树"]
    end

    subgraph "🏗️ 阶段 2: completeWork（归）"
        direction TB
        CW1["自底向上<br/>创建真实DOM节点"]
        CW2["appendAllChildren<br/>拼接DOM子树"]
        CW3["bubbleProperties<br/>标记冒泡"]
    end

    subgraph "✋ 阶段 3: commit（提交）"
        direction TB
        CR1["commitMutationEffect<br/>深度优先遍历"]
        CR2["检查 flags & Placement"]
        CR3["appendChild 挂载"]
    end

    BW1 --> BW2 --> BW3
    BW3 --> CW1 --> CW2 --> CW3
    CW3 --> CR1 --> CR2 --> CR3

    classDef phase fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef sub fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    class BW1,BW2,BW3 sub
    class CW1,CW2,CW3 sub
    class CR1,CR2,CR3 sub
```

---

## 第二部分：阶段 1 —— beginWork，谁被打上了 Placement？

### 2.1 核心判断函数

这是整个机制最关键的地方——[beginWork.ts:53](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/beginWork.ts#L53) 的 `reconcilerChildren`：

```typescript
function reconcilerChildren(wip: FiberNode, children?: ReactElementType) {
  const current = wip.alternate;      // ← 决定命运的一行

  if (current !== null) {
    // ✅ wip.alternate 不为 null → 这是"更新"流程
    // 用 reconcilerChildFibers(true) → 会调用 placeSingleChild → 会标记 Placement
    wip.child = reconcilerChildFibers(wip, current.child, children);
  } else {
    // ❌ wip.alternate 为 null → 这是"挂载"流程（新增节点）
    // 用 mountChildFibers(false) → placeSingleChild 中 shouldTrackSideEffects=false → 不标记
    wip.child = mountChildFibers(wip, null, children);
  }
}
```

[childFibers.ts:32](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/childFibers.ts#L32) 的 `placeSingleChild`：

```typescript
function placeSingleChild(fiber: FiberNode) {
  // shouldTrackSideEffects === true → 是 reconcilerChildFibers
  // shouldTrackSideEffects === false → 是 mountChildFibers
  if (shouldTrackSideEffects && fiber.alternate === null) {
    fiber.flags |= Placement;   // 标记 Placement
  }
  return fiber;
}
```

### 2.2 为什么只有 AppFiber 有 Placement？

`createWorkInProgress` 创建 wip 树时，HostRoot 的 wip 的 `alternate` 指向原始 HostRoot（不为 null）；HostRoot 的儿子 AppFiber 是**新建**的，`alternate` 为 null。

```mermaid
flowchart TD
    subgraph "🔍 关键：wip.alternate 决定一切"
        direction TB
        note["prepareFreshStack 通过<br/>createWorkInProgress 创建 wip 树<br/>HostRoot 的 wip 保留了 alternate<br/>子 fiber 都是新建的, alternate = null"]
    end

    HR["HostRoot wip<br/>alternate = 原始 HostRoot ✅<br/>→ reconcilerChildFibers(true)"]
    APP["AppFiber wip<br/>alternate = null ❌<br/>→ mountChildFibers(false)"]
    DIV["divFiber wip<br/>alternate = null ❌<br/>→ mountChildFibers(false)"]
    SPAN["spanFiber wip<br/>alternate = null ❌<br/>→ mountChildFibers(false)"]
    TXT["文本Fiber wip<br/>alternate = null ❌<br/>→ mountChildFibers(false)"]

    HR -->|"recon(true) → 会标记 Placement ✅"| APP
    APP -->|"mount(false) → 不标记 ❌"| DIV
    DIV -->|"mount(false) → 不标记 ❌"| SPAN
    SPAN -->|"mount(false) → 不标记 ❌"| TXT

    classDef root fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef hasPlacement fill:#FFB6C1,stroke:#DC143C,stroke-width:3px,color:black
    classDef noPlacement fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    class HR root
    class APP hasPlacement
    class DIV,SPAN,TXT noPlacement
```

### 2.3 完整执行路径

```mermaid
sequenceDiagram
    participant HR as HostRoot beginWork
    participant APP_BW as AppFiber beginWork
    participant C as childFibers
    participant F as fiber.flags

    HR->>HR: updateHostRoot(): 从 updateQueue 取出 ReactElement
    HR->>HR: reconcilerChildren(wip, nextChildren)
    HR->>HR: wip.alternate = 原始HostRoot ≠ null
    HR->>C: 调用 reconcilerChildFibers(true)
    C->>C: reconcileSingleElement() → 创建 AppFiber
    C->>C: placeSingleChild(AppFiber)
    Note over C: shouldTrackSideEffects=true<br/>AppFiber.alternate=null
    C->>F: AppFiber.flags |= Placement ✅
    HR->>HR: return AppFiber (flags = Placement)

    APP_BW->>APP_BW: updateFunctionComponent()
    APP_BW->>APP_BW: reconcilerChildren(wip, divElement)
    APP_BW->>APP_BW: wip.alternate = null（AppFiber 是新建的）
    APP_BW->>C: 调用 mountChildFibers(false)
    C->>C: reconcileSingleElement() → 创建 divFiber
    C->>C: placeSingleChild(divFiber)
    Note over C: shouldTrackSideEffects=false → 不标记 ❌
    C->>F: divFiber.flags = NoFlags
    APP_BW->>APP_BW: return divFiber (flags = NoFlags)

    Note over HR,F: 只有 AppFiber 有 Placement！<br/>div、span、文本都没有。
```

---

## 第三部分：阶段 2 —— completeWork，DOM 树在内存中拼接

### 3.1 appendAllChildren 的拼接过程

[completeWork.ts:71](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/completeWork.ts#L71) 的 `appendAllChildren` **自底向上**遍历子 fiber 树，把所有 HostComponent 和 HostText 节点的 DOM 拼接到父节点上：

```mermaid
sequenceDiagram
    participant TXT_CW as completeWork("big-react" 文本)
    participant SPAN_CW as completeWork(span)
    participant DIV_CW as completeWork(div)
    participant APP_CW as completeWork(App)
    participant HR_CW as completeWork(HostRoot)

    Note over TXT_CW: 第 1 个完成
    TXT_CW->>TXT_CW: createTextInstance("big-react")
    TXT_CW->>TXT_CW: stateNode = "big-react" 文本节点
    TXT_CW->>TXT_CW: bubbleProperties → subtreeFlags=NoFlags

    Note over SPAN_CW: 第 2 个完成
    SPAN_CW->>SPAN_CW: createInstance("span")
    SPAN_CW->>SPAN_CW: appendAllChildren(spanDOM, spanFiber)
    SPAN_CW->>SPAN_CW: span.appendChild(文本节点) ✅
    SPAN_CW->>SPAN_CW: stateNode = <span>big-react</span>
    SPAN_CW->>SPAN_CW: bubbleProperties → subtreeFlags=NoFlags

    Note over DIV_CW: 第 3 个完成
    DIV_CW->>DIV_CW: createInstance("div")
    DIV_CW->>DIV_CW: appendAllChildren(divDOM, divFiber)
    DIV_CW->>DIV_CW: div.appendChild(span) ✅
    DIV_CW->>DIV_CW: stateNode = <div><span>big-react</span></div>
    DIV_CW->>DIV_CW: bubbleProperties → subtreeFlags=NoFlags

    Note over APP_CW: 第 4 个完成
    APP_CW->>APP_CW: FunctionComponent: 没有 DOM 操作
    APP_CW->>APP_CW: bubbleProperties → subtreeFlags=Placement
    Note over APP_CW: divFiber 的 flags=Placement<br/>冒泡到 AppFiber.subtreeFlags

    Note over HR_CW: 第 5 个完成
    HR_CW->>HR_CW: bubbleProperties → subtreeFlags=Placement
    Note over HR_CW: AppFiber 的 flags=Placement<br/>冒泡到 HostRoot.subtreeFlags
```

**第 3 阶段结束时，内存中的 DOM 树：**

```
<div id="root"></div>   ← 页面上的真实 #root，空的

内存中（离屏）：
<div>                   ← divFiber.stateNode（完整子树！）
  <span>                ← spanFiber.stateNode
    "big-react"          ← 文本Fiber.stateNode
  </span>
</div>
```

**div 的 `stateNode` 已经是一棵完整的 DOM 子树了。**

### 3.2 bubbleProperties 的作用

[completeWork.ts:96](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/completeWork.ts#L96) 的 `bubbleProperties`：

```typescript
function bubbleProperties(wip: FiberNode) {
  let subtreeFlags = NoFlags;
  let child = wip.child;

  while (child !== null) {
    subtreeFlags |= child.subtreeFlags;  // 子树自己的 flags
    subtreeFlags |= child.flags;         // 子节点自身的 flags
    child = child.sibling;
  }
  wip.subtreeFlags |= subtreeFlags;      // 冒泡到父级
}
```

```
冒泡过程：
  文本Fiber:       flags=NoFlags,  subtreeFlags=NoFlags
  → spanFiber:     flags=NoFlags,  subtreeFlags=NoFlags | NoFlags = NoFlags
  → divFiber:      flags=NoFlags,  subtreeFlags=NoFlags | NoFlags = NoFlags
  → AppFiber:      flags=Placement, subtreeFlags=NoFlags | NoFlags = NoFlags
                             ↑ 自身的 Placement
  → HostRoot:      flags=NoFlags,  subtreeFlags=Placement | NoFlags = Placement
                                    ↑ AppFiberPlacement 冒泡上来了
```

**`subtreeFlags` 告诉 commit："你的子树里有需要处理的标记。"**

---

## 第四部分：阶段 3 —— commit，只执行 1 次 appendChild

### 4.1 commitRoot 的入口判断

[workLoop.ts:79](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/workLoop.ts#L79) 的 `commitRoot`：

```typescript
function commitRoot(root: FiberRootNode) {
  const finishedWork = root.finishedWork; // HostRoot (wip 树的根)

  const subtreeHasEffect =
    (finishedWork.subtreeFlags & MutationMask) !== NoFlags;
  const rootHasEffect = finishedWork.flags & MutationMask;

  if (subtreeHasEffect || rootHasEffect) {
    commitMutationEffect(finishedWork);   // 进入 commit 遍历
  }
}
```

因为 `HostRoot.subtreeFlags = Placement`，所以 `subtreeHasEffect = true`，进入 commit。

### 4.2 commitMutationEffect 的遍历过程

[commitWork.ts:8](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/commitWork.ts#L8) 的 `commitMutationEffect`：

```mermaid
sequenceDiagram
    participant OUTER as outer 循环
    participant INNER as up 循环
    participant F as commitMutationEffectOnFiber

    Note over OUTER: nextEffect = HostRoot

    OUTER->>OUTER: HostRoot.subtreeFlags = Placement ≠ 0 ✅
    OUTER->>OUTER: child = AppFiber ≠ null ✅
    OUTER->>OUTER: → 下钻: nextEffect = AppFiber

    OUTER->>OUTER: AppFiber.subtreeFlags = NoFlags ❌
    OUTER->>INNER: → 进入 up 循环

    INNER->>F: commitMutationEffectOnFiber(AppFiber)
    F->>F: AppFiber.flags & Placement = Placement ✅
    F->>F: → commitPlacement(AppFiber)
    F->>F:   → getHostParent → #root
    F->>F:   → appendPlacementNodeIntoContainer(AppFiber, #root)
    Note over F:     AppFiber.tag = FunctionComponent (0)<br/>不是 HostComponent<br/>→ 需要向下找真实 DOM
    F->>F:   → 递归 child → divFiber
    F->>F:     divFiber.tag = HostComponent ✅
    F->>F:     → appendChild(#root, divFiber.stateNode)
    F->>F:     → return 🎯 完成！
    F->>F: finishedWork.flags &= ~Placement (清除标记)

    INNER->>INNER: AppFiber.sibling = null → 向上
    INNER->>INNER: nextEffect = HostRoot

    INNER->>F: commitMutationEffectOnFiber(HostRoot)
    F->>F: HostRoot.flags = NoFlags → 无操作

    INNER->>INNER: HostRoot.sibling = null → 向上
    INNER->>INNER: nextEffect = null → 退出 up

    OUTER->>OUTER: nextEffect = null → 退出 outer ✅
    Note over OUTER,F: 完成！只执行了 1 次 appendChild !
```

### 4.3 appendPlacementNodeIntoContainer 的关键逻辑

[commitWork.ts:90](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/commitWork.ts#L90) 的 `appendPlacementNodeIntoContainer`：

```typescript
function appendPlacementNodeIntoContainer(
  finishedWork: FiberNode,
  hostParent: Container
) {
  // ✅ 如果 finishedWork 本身就是 HostComponent 或 HostText
  //    直接拿它的 stateNode（已经是完整子树！）
  if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
    appendChildToContainer(hostParent, finishedWork.stateNode);
    return;
  }

  // 如果不是（比如 FunctionComponent、HostRoot），
  // 才需要递归向下找真实 DOM 节点
  const child = finishedWork.child;
  if (child !== null) {
    appendPlacementNodeIntoContainer(child, hostParent);
    // ... 处理兄弟节点
  }
}
```

**关键理解：**

| 入参 | `tag` | 走哪个分支 | 效果 |
|------|-------|-----------|------|
| `AppFiber` | FunctionComponent (0) | else 分支 → 递归 | 下钻到 div |
| `divFiber` | HostComponent (5) | `if` 分支 → **直接 return** | `appendChild(#root, div.stateNode)` |

**为什么 div 直接 return 就够了？** 因为 div 的 `stateNode` 已经是 `<div><span>big-react</span></div>` —— 整棵子树在 completeWork 的 `appendAllChildren` 阶段就已经拼好了。

---

## 第五部分：核心机制总结

### 三个阶段的"搭积木"比喻

```mermaid
flowchart LR
    subgraph "① 打标记"
        A["只在 alternate≠null 的层<br/>才标记 Placement<br/>→ 只有 AppFiber 有标记"]
    end

    subgraph "② 拼积木"
        B["completeWork<br/>appendAllChildren<br/>自底向上拼接<br/>DOM 已是一棵完整子树"]
    end

    subgraph "③ 端过去"
        C["commit<br/>只对有标记的 fiber 操作<br/>HostComponent 直接 appendChild<br/>一次挂整棵"]
    end

    A --> B --> C

    classDef mark fill:#FFB6C1,stroke:#DC143C,color:black
    classDef build fill:#90EE90,stroke:#333,color:darkgreen
    classDef commit fill:#87CEEB,stroke:#333,color:darkblue
    class A mark
    class B build
    class C commit
```

### 为什么只执行一次 Placement？

```mermaid
flowchart TB
    subgraph 原因[三点原因]
        R1["🎯 原因 1: 标记只打一层<br/>hostRoot.alternate ≠ null → recon(true)<br/>AppFiber 被打上 Placement<br/>但 AppFiber.alternate = null → mount(false)<br/>子节点 div/span/文本 不被打标记"]
        R2["🏗️ 原因 2: DOM 树早已拼好<br/>completeWork 阶段 appendAllChildren<br/>已经把所有子 DOM 拼到了父 DOM 上<br/>div.stateNode = &lt;div&gt;&lt;span&gt;big-react&lt;/span&gt;&lt;/div&gt;"]
        R3["✋ 原因 3: commit 精准命中<br/>只有带 Placement 的 fiber 才被处理<br/>AppFiber 不是 HostComponent → 递归下钻<br/>div 是 HostComponent → 直接 appendChild → return"]
    end

    R1 --> R2 --> R3

    classDef reason fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    class R1,R2,R3 reason
```

### 对比：如果有多个 Placement 会怎样？

如果每个节点都打了 Placement，commit 时会重复 append：

```
❌ 错误场景：

#root.appendChild(div)     ← div 下已有 span 和文本
#root.appendChild(span)    ← span 还在 div 里，又被 append 到 #root！
#root.appendChild(文本)     ← 文本节点也重复了！

结果 DOM：
<div id="root">
  <div><span>big-react</span></div>  ← 正确的
  <span>big-react</span>             ← 多余的！
  "big-react"                        ← 多余的！
</div>
```

**所以，只给最外层打 Placement 标记，是 React 性能优化的核心设计。**

---

## 附录：完整的事故报告

### fiber 树的完整标记情况

| 层级 | Fiber | `wip.alternate` | 使用的 reconciler | 自身 `flags` | `subtreeFlags` |
|------|-------|----------------|-------------------|-------------|---------------|
| 1 | HostRoot | **≠ null** (原始 HostRoot) | 无（不创建自己的子） | `NoFlags` | `Placement` |
| 2 | AppFiber | **= null** (新建) | `recon(true)` ← **会标记** | **`Placement`** | `NoFlags` |
| 3 | divFiber | **= null** (新建) | `mount(false)` ← **不标记** | `NoFlags` | `NoFlags` |
| 4 | spanFiber | **= null** (新建) | `mount(false)` | `NoFlags` | `NoFlags` |
| 5 | 文本Fiber | **= null** (新建) | `mount(false)` | `NoFlags` | `NoFlags` |

### 代码路径索引

| 关键函数 | 文件 | 行号 |
|---------|------|------|
| `reconcilerChildren` (选择器) | [beginWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/beginWork.ts) | L53 |
| `placeSingleChild` (标记器) | [childFibers.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/childFibers.ts) | L32 |
| `ChildReconciler` (工厂函数) | [childFibers.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/childFibers.ts) | L13 |
| `appendAllChildren` (DOM 拼接) | [completeWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/completeWork.ts) | L71 |
| `bubbleProperties` (标记冒泡) | [completeWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/completeWork.ts) | L96 |
| `commitMutationEffect` (遍历) | [commitWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/commitWork.ts) | L8 |
| `commitMutationEffectOnFiber` (处理) | [commitWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/commitWork.ts) | L36 |
| `appendPlacementNodeIntoContainer` (提交) | [commitWork.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/commitWork.ts) | L90 |
| `createWorkInProgress` (双缓冲) | [fiber.ts](file:///d:/BaiduNetdiskDownload/B%E7%AB%99%E5%8D%A1%E9%A2%82%E4%BB%8E0%E5%AE%9E%E7%8E%B0React18/big-react/packages/react-reconciler/src/fiber.ts) | L96 |
