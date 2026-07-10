# appendPlacementNodeIntoContainer 深度解析：为什么 sibling 处理只在 Case 2

## 核心问题

```typescript
function appendPlacementNodeIntoContainer(
  finishedWork: FiberNode,
  hostParent: Container
) {
  // Case 1：当前是 HostComponent / HostText（有真实 DOM 节点）
  if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
    appendChildToContainer(hostParent, finishedWork.stateNode);
    return; // ← ❓ 为什么不处理 siblings 就直接返回了？
  }
  // Case 2：当前不是 HostComponent / HostText（没有真实 DOM 节点）
  const child = finishedWork.child;
  if (child !== null) {
    appendPlacementNodeIntoContainer(child, hostParent);
    let sibling = child.sibling;
    while (sibling !== null) {          // ← ⚠️ 这里用 while 循环处理 siblings
      appendPlacementNodeIntoContainer(sibling, hostParent);
      sibling = sibling.sibling;
    }
  }
}
```

两个分支的处理方式**不对称**——Case 1 直接 return，Case 2 用 while 处理 siblings。为什么？

---

## 前置知识：Fiber 节点 ≠ DOM 节点

```mermaid
flowchart TB
    subgraph "🧬 Fiber Tag 对照表"
        direction TB

        HOSTC["HostComponent (tag=5)<br/>如 &lt;div&gt; &lt;span&gt;<br/>stateNode = 真实 DOM ✅"]
        HOSTT["HostText (tag=6)<br/>'文本内容'<br/>stateNode = Text 节点 ✅"]
        FC["FunctionComponent (tag=0)<br/>如 &lt;App&gt; &lt;Wrapper&gt;<br/>stateNode = null ❌"]
        HR["HostRoot (tag=3)<br/>虚拟根节点<br/>stateNode = FiberRootNode ⚠️"]
    end

    classDef host fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef nohost fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef root fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    class HOSTC,HOSTT host
    class FC nohost
    class HR root
```

---

## 函数本质：递归找"顶级 DOM 节点"

```mermaid
flowchart TB
    START(["appendPlacementNodeIntoContainer(finishedWork, hostParent)"]) --> JUDGE{finishedWork 有真实 DOM?}
    JUDGE -->|"✅ Case 1: HostComponent / HostText"| C1["把自己插入 hostParent<br/>appendChildToContainer(stateNode, hostParent)"]
    C1 --> C1_RETURN["return ⭐<br/>✨ 这里的 child 在 completeWork 阶段<br/>已经作为子 DOM 挂在自己身上了<br/>✨ sibling 由调用方 Case 2 处理<br/>✨ 只插自己不插 siblings"]

    JUDGE -->|"❌ Case 2: FunctionComponent / HostRoot"| C2["自身没有 DOM<br/>需要向下找'顶级 DOM 节点'"]
    C2 --> C2_CHILD["递归处理 child<br/>appendPlacementNodeIntoContainer(child, hostParent)"]
    C2_CHILD --> C2_SIBLING["while 循环处理所有 siblings<br/>appendPlacementNodeIntoContainer(sibling, hostParent)"]
    C2_SIBLING --> C2_RETURN["处理完毕<br/>✨ 扩散逻辑：把 child 链上所有可能产 DOM 的分支都挖出来"]

    classDef case1 fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef case2 fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    classDef decision fill:#FFD700,stroke:#333,color:black
    class C1,C1_RETURN case1
    class C2,C2_CHILD,C2_SIBLING,C2_RETURN case2
    class JUDGE decision
```

---

## 示例 1：简单场景 —— FunctionComponent 包含两个 HostComponent

```jsx
<App>                 {/* FunctionComponent → 无 DOM */}
  <div>A</div>        {/* HostComponent → 有 DOM = divA */}
  <div>B</div>        {/* HostComponent → 有 DOM = divB */}
</App>
```

### Fiber 树结构

```mermaid
flowchart TB
    APP["AppFiber<br/>FunctionComponent (tag=0)<br/>stateNode=null"]
    DIVA["divA_Fiber<br/>HostComponent (tag=5)<br/>stateNode=divA"]
    DIVB["divB_Fiber<br/>HostComponent (tag=5)<br/>stateNode=divB"]

    APP -->|child| DIVA
    DIVA -->|sibling| DIVB

    classDef func fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef host fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    class APP func
    class DIVA,DIVB host
```

### 调用链追踪

```mermaid
sequenceDiagram
    participant L1 as Lv1: App(Case 2)
    participant L2 as Lv2: divA(Case 1)
    participant L3 as Lv2: divB(Case 1)
    participant DOM as container DOM

    L1->>L1: child = divA_Fiber
    L1->>L2: appendPlacementNodeIntoContainer(divA_Fiber, container)

    L2->>L2: divA.tag = HostComponent ✅
    L2->>DOM: appendChildToContainer(divA, container)
    Note over L2: 插入 divA
    L2->>L2: return ⭐

    L1->>L1: sibling = child.sibling = divB_Fiber
    Note over L1: ⭐ 回到 Case 2，处理 sibling！
    L1->>L3: appendPlacementNodeIntoContainer(divB_Fiber, container)

    L3->>L3: divB.tag = HostComponent ✅
    L3->>DOM: appendChildToContainer(divB, container)
    Note over L3: 插入 divB
    L3->>L3: return ⭐

    L1->>L1: sibling = null → while 结束 ✅
    Note over L1,DOM: 结果：divA 和 divB 都被插入 container，没有重复
```

---

## 示例 2：嵌套的 FunctionComponent（多层 Case 2 递归）

```jsx
<App>                 {/* FunctionComponent → 无 DOM */}
  <Wrapper>           {/* FunctionComponent → 无 DOM */}
    <div>C</div>      {/* HostComponent → 有 DOM = divC */}
  </Wrapper>
  <div>D</div>        {/* HostComponent → 有 DOM = divD */}
</App>
```

### Fiber 树结构

```mermaid
flowchart TB
    APP["AppFiber (tag=0)"]
    WRP["WrapperFiber (tag=0)"]
    DIVC["divC_Fiber (tag=5)<br/>stateNode=divC"]
    DIVD["divD_Fiber (tag=5)<br/>stateNode=divD"]

    APP -->|child| WRP
    WRP -->|child| DIVC
    WRP -.->|sibling| DIVD

    classDef func fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef host fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    class APP,WRP func
    class DIVC,DIVD host
```

### 调用链追踪

```mermaid
sequenceDiagram
    participant L1 as Lv1: App(Case 2)
    participant L2 as Lv2: Wrapper(Case 2)
    participant L3 as Lv3: divC(Case 1)
    participant L2B as Lv2-2: divD(Case 1)
    participant DOM as container DOM

    L1->>L1: child = WrapperFiber
    L1->>L2: appendPlacementNodeIntoContainer(WrapperFiber, container)

    L2->>L2: Wrapper.tag = FunctionComponent → Case 2
    L2->>L2: child = divC_Fiber
    L2->>L3: appendPlacementNodeIntoContainer(divC_Fiber, container)

    L3->>L3: divC.tag = HostComponent ✅
    L3->>DOM: appendChildToContainer(divC, container)
    L3->>L3: return ⭐

    L2->>L2: sibling = child.sibling = null → while 跳过
    L2->>L2: return ⭐ Wrapper 完成

    L1->>L1: sibling = child.sibling = divD_Fiber
    Note over L1: ⭐ 回到 App 的 Case 2！
    L1->>L2B: appendPlacementNodeIntoContainer(divD_Fiber, container)

    L2B->>L2B: divD.tag = HostComponent ✅
    L2B->>DOM: appendChildToContainer(divD, container)
    L2B->>L2B: return ⭐

    L1->>L1: sibling = null → while 结束 ✅
    Note over L1,DOM: 结果：divC 和 divD 都插入了。Wrapper 是"管道"，自身无 DOM
```

---

## 如果再在 Case 1 加 sibling 循环会怎样？

假设我们这样写：

```typescript
// ❌ 错误的写法
if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
  appendChildToContainer(finishedWork.stateNode, hostParent);
  // 如果这里再加 siblings 循环...
  let sibling = finishedWork.sibling;
  while (sibling !== null) {
    appendPlacementNodeIntoContainer(sibling, hostParent);
    sibling = sibling.sibling;
  }
  return;
}
```

对于示例 1 的 Fiber 树，追踪：

```mermaid
sequenceDiagram
    participant L1 as Lv1: App(Case 2)
    participant L2 as Lv2: divA(Case 1)  ← 加了 sibling 循环
    participant L2B as Lv2-1: divB 由 divA 处理
    participant L2C as Lv2-2: divB 由 App 处理
    participant DOM as container DOM

    L1->>L1: child = divA_Fiber
    L1->>L2: appendPlacementNodeIntoContainer(divA_Fiber, container)

    L2->>DOM: appendChildToContainer(divA, container)
    Note over L2: 第 1 次插入 divA ✅

    L2->>L2: sibling = divB_Fiber ← 在 Case 1 也处理 sibling！
    L2->>L2B: appendPlacementNodeIntoContainer(divB_Fiber, container)
    L2B->>DOM: appendChildToContainer(divB, container)
    Note over L2B: 第 1 次插入 divB ✅
    L2B->>L2B: return

    L2->>L2: return ⭐ divA 处理完毕

    L1->>L1: sibling = child.sibling = divB_Fiber
    Note over L1: ⭐ 回到 App 的 Case 2！
    L1->>L2C: appendPlacementNodeIntoContainer(divB_Fiber, container)
    L2C->>DOM: appendChildToContainer(divB, container)
    Note over L2C: ❌ 第 2 次插入 divB！重复了！
    L2C->>L2C: return

    Note over L2C,DOM: ❌ divB 被插入了两次！<br/>浏览器会报错或出现奇怪行为！
```

**divB 被插入了两次！** 这就是为什么 sibling 的处理必须只在 Case 2 进行。

---

## 函数设计哲学

```mermaid
flowchart LR
    subgraph "📋 调用者职责"
        CALLER["Case 2（调用者）<br/>在 while 循环中遍历 siblings<br/>逐个调用本函数"]
    end

    subgraph "📋 被调用者职责"
        CALLEE["Case 1（被调用者）<br/>插自己就 return<br/>不管 siblings"]
    end

    CALLER -->|"调用"| CALLEE
    CALLEE -->|"return"| CALLER
    CALLER -->|"下一个 sibling"| CALLEE

    classDef caller fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    classDef callee fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    class CALLER caller
    class CALLEE callee
```

| 角色 | 职责 | 为什么 |
|------|------|--------|
| **Case 1** (HostComponent/HostText) | **只插自己**，立即 return | 它的 child 已在 completeWork 阶段挂在自己 DOM 上；它的 sibling 由调用者（Case 2）管理，自己不能越权 |
| **Case 2** (非 host) | **扩散逻辑**——遍历 child 链上所有分支 | 自身无 DOM，必须通过递归把所有可能产 DOM 的子孙挖出来 |

---

## 一张图记住所有

```mermaid
flowchart TB
    START(["被调用<br/>finishedWork 来了"]) --> TAG{finishedWork.tag?}

    TAG -->|"HostComponent / HostText<br/>✅ 有真实 DOM"| C1["👤 我是一个 DOM 节点<br/>我直接把自己插入容器<br/>我的孩子已经在我身上了<br/>我的兄弟应该由调用者管理"]
    C1 --> C1_END["return ⭐"]

    TAG -->|"FunctionComponent / HostRoot<br/>❌ 无真实 DOM"| C2["👥 我是一个容器层<br/>我没有 DOM 节点<br/>我需要找到我的 child 链上<br/>所有有 DOM 的子孙"]
    C2 --> C2_CHILD["递归第一个 child"]
    C2_CHILD --> C2_SIBLING["while 循环处理<br/>child 的所有 siblings"]
    C2_SIBLING --> C2_END["全部处理完毕 ✅"]

    classDef case1 fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef case2 fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
    classDef decision fill:#FFD700,stroke:#333,color:black
    class C1,C1_END case1
    class C2,C2_CHILD,C2_SIBLING,C2_END case2
    class TAG decision
```

---

## 一句话总结

| | Case 1 (HostComponent/HostText) | Case 2 (FunctionComponent 等) |
|---|---|---|
| 自身 DOM | ✅ 有 | ❌ 无 |
| 做什么 | 插自己，return | 向下递归找"顶级 DOM 节点" |
| sibling 处理 | ❌ 不管 | ✅ while 循环处理 child.sibling |
| 为什么这样设计 | sibling 由调用方管理，否则重复插入 | 自身无 DOM，必须遍历 child 链挖出所有 DOM |
