# commitMutationEffect 深度解析：用 Mermaid 可视化每一行代码

## 一个生动的例子

```jsx
function App() {
  return (
    <div>
      <span>big-react</span>
    </div>
  );
}
```

等价于：

```js
App() → <div><span>big-react</span></div>
```

生成 5 个 fiber 节点：**HostRoot → App → div → span → 文本**

---

## Part 1: fiber 树的"体检报告" — 谁被打上了 Placement 标记？

```mermaid
flowchart TB
    subgraph fiber树[完成 beginWork+completeWork 后的 fiber 树]
        HR[HostRoot<br/>tag=3<br/>flags=NoFlags<br/><b>subtreeFlags=Placement</b>]
        APP[AppFiber<br/>tag=0<br/><b>flags=Placement</b><br/>subtreeFlags=NoFlags]
        DIV[divFiber<br/>tag=5<br/>flags=NoFlags<br/>subtreeFlags=NoFlags<br/>stateNode=&lt;div&gt;...&lt;/div&gt;]
        SPAN[spanFiber<br/>tag=5<br/>flags=NoFlags<br/>subtreeFlags=NoFlags]
        TXT[文本Fiber<br/>tag=6<br/>flags=NoFlags<br/>subtreeFlags=NoFlags]
    end

    HR -->|child| APP
    APP -->|child| DIV
    DIV -->|child| SPAN
    SPAN -->|child| TXT

    TXT -.->|return| SPAN
    SPAN -.->|return| DIV
    DIV -.->|return| APP
    APP -.->|return| HR

    style HR fill:#1e293b,stroke:#3b82f6,color:white,stroke-width:3
    style APP fill:#dc2626,stroke:#ef4444,color:white,stroke-width:3
    style DIV fill:#334155,stroke:#64748b,color:#94a3b8
    style SPAN fill:#334155,stroke:#64748b,color:#94a3b8
    style TXT fill:#334155,stroke:#64748b,color:#94a3b8
```

**关键观察**：只有 **AppFiber** (tag=0) 有 `flags = Placement`。其他 fiber 都没有。

为什么？

| 层级 | `wip.alternate` | 使用的 reconciler | 结果 |
|------|----------------|-------------------|------|
| HostRoot | **≠ null** (指向原始 HostRoot) | `reconcilerChildFibers(true)` | AppFiber 被打上 Placement ✅ |
| AppFiber | **= null** (新建，无 current) | `mountChildFibers(false)` | divFiber **无** ❌ |
| divFiber | **= null** | `mountChildFibers(false)` | spanFiber **无** ❌ |
| spanFiber | **= null** | `mountChildFibers(false)` | 文本Fiber **无** ❌ |

---

## Part 2: 逐行模拟执行 — 用时间线证明没有死循环

### 2.1 先看代码的"游戏规则"

```mermaid
flowchart TD
    A[开始: nextEffect = finishedWork<br/>finishedWork = HostRoot] --> B{nextEffect ≠ null?}
    B -->|是| C[child = nextEffect.child]
    C --> D{subtreeFlags & MutationMask ≠ 0<br/>并且 child ≠ null?}
    D -->|是| E[下钻: nextEffect = child]
    E --> B
    D -->|否| F[进入 up 循环]
    F --> F1[commitMutationEffectOnFiber<br/>处理当前节点的 flags]
    F1 --> F2{有 sibling 兄弟?}
    F2 -->|有兄弟| F3[跳到兄弟: nextEffect = sibling<br/>break up → 回 outer 循环]
    F3 --> B
    F2 -->|无兄弟| F4[向上回溯: nextEffect = .return]
    F4 --> F5{nextEffect ≠ null?}
    F5 -->|是| F1
    F5 -->|否| B

    style A fill:#1e293b,stroke:#3b82f6,color:white
    style B fill:#f59e0b,stroke:#d97706,color:white,stroke-width:2
    style D fill:#f59e0b,stroke:#d97706,color:white,stroke-width:2
    style E fill:#22c55e,stroke:#16a34a,color:white
    style F fill:#8b5cf6,stroke:#7c3aed,color:white
    style F1 fill:#ef4444,stroke:#dc2626,color:white
    style F3 fill:#22c55e,stroke:#16a34a,color:white
    style F4 fill:#06b6d4,stroke:#0891b2,color:white
```

### 2.2 开始执行：用序列图看清每一步

```mermaid
sequenceDiagram
    participant O as outer 循环
    participant U as up 循环
    participant C as commitMutationEffectOnFiber
    participant N as nextEffect 指针

    Note over N: 初始值 = HostRoot

    O->>N: Round 1: nextEffect = HostRoot
    O->>O: child = AppFiber ≠ null
    O->>O: subtreeFlags=Placement ✅ → 下钻
    O->>N: nextEffect = AppFiber

    O->>N: Round 2: nextEffect = AppFiber
    O->>O: child = divFiber ≠ null
    O->>O: subtreeFlags=NoFlags ❌ → 进入 up

    O->>U: 进入 up 循环

    U->>N: up #1: nextEffect = AppFiber
    U->>C: commitMutationEffectOnFiber(AppFiber)
    C->>C: flags & Placement = Placement ✅
    C->>C: commitPlacement(AppFiber) → 插入 DOM
    C->>C: flags &= ~Placement (清除标记)
    U->>U: sibling = null → 向上
    U->>N: nextEffect = AppFiber.return = HostRoot

    U->>N: up #2: nextEffect = HostRoot
    U->>C: commitMutationEffectOnFiber(HostRoot)
    C->>C: flags = NoFlags → 什么也不做
    U->>U: sibling = null → 向上
    U->>N: nextEffect = HostRoot.return = null

    U->>N: up #3: nextEffect = null → 退出 up 循环
    U-->>O: up 循环结束

    O->>N: Round 3: nextEffect = null → 退出 outer ✅
    Note over O: 完成！没有死循环！
```

### 2.3 同一过程用状态机看

```mermaid
stateDiagram-v2
    direction LR
    state "🎬 初始化" as INIT
    state "Round 1<br/>HostRoot" as R1
    state "Round 2<br/>AppFiber" as R2
    state "up #1<br/>AppFiber" as U1
    state "up #2<br/>HostRoot" as U2
    state "up #3<br/>null" as U3
    state "✅ 结束" as END

    [*] --> INIT: nextEffect = HostRoot
    INIT --> R1: outer 检查<br/>subtreeFlags≠0 → 下钻
    R1 --> R2: nextEffect = AppFiber
    R2 --> U1: subtreeFlags=0 → 进入 up

    U1 --> U1: commitPlacement(AppFiber) 🎯
    U1 --> U2: sibling=null → .return=HostRoot

    U2 --> U2: HostRoot.flags=NoFlags → 无操作
    U2 --> U3: sibling=null → .return=null

    U3 --> END: nextEffect=null → outer 退出

    note right of U1: 唯一一次真正的 DOM 操作
    note right of U3: 回到 outer 时 nextEffect=null<br/>外层循环条件不成立 → 立即退出
```

---

## Part 3: 为什么不会死循环？— 用"打地鼠"来理解

```mermaid
flowchart TD
    subgraph 想象[想象一个'打地鼠'游戏机]
        H0[地鼠洞 0: outer 循环<br/>每次检查:洞里还有地鼠吗]
        H1[地鼠洞 1: up 循环<br/>真-办事的地方]
    end

    subgame[游戏过程:]
    G0[outer 看到 subtreeFlags≠0<br/>→ 把球扔给 child] --> G1[child 拿到球<br/>发现 subtreeFlags=0<br/>→ 进入 up 处理]
    G1 --> G2[up 处理完自己<br/>→ 往上看父亲<br/>→ 父亲也没事<br/>→ 再往上... 直到 null]
    G2 --> G3[回到 outer 时手上是 null<br/>→ outer: 没球了，收工！]

    style H0 fill:#f59e0b,stroke:#d97706,color:white
    style H1 fill:#8b5cf6,stroke:#7c3aed,color:white
    style G0 fill:#334155,stroke:#475569,color:#94a3b8
    style G1 fill:#334155,stroke:#475569,color:#94a3b8
    style G2 fill:#1e293b,stroke:#3b82f6,color:white
    style G3 fill:#22c55e,stroke:#16a34a,color:white
```

**关键理解**：

```
outer 的职责很轻 —— 只负责 "向下钻"
up 的职责很重 —— "所有 dirty work 都在 up 里完成，一口气处理到根"

outer 的逻辑：看 subtreeFlags → 非零就下钻
up   的逻辑：处理当前 → 有兄弟跳兄弟 → 没兄弟一直 pop 到 null

如果 up 因为兄弟跳出了（break up），outer 拿到的 nextEffect 
  是兄弟节点 → 继续下钻（没问题）
如果 up 没有兄弟，就 .return 一路 pop 到 null
  → outer 拿到 null → 退出（不会重复下钻！）
```

### 为什么不会回到 HostRoot 重新下钻？

这是最容易误解的地方。让我们精确追踪：

```
up 循环中：
  up 第 1 次: nextEffect = AppFiber → 处理 AppFiber
             sibling = null → nextEffect = AppFiber.return = HostRoot

  up 第 2 次: nextEffect = HostRoot（← 仍然在 up 循环内部！）
             处理 HostRoot
             sibling = null → nextEffect = HostRoot.return = null

  up 第 3 次: nextEffect = null → 退出 up 循环
```

**HostRoot 是在 up 循环内部被处理的**，所以当 up 循环结束时，nextEffect 已经是 null 了。outer 不会再"重新看到" HostRoot。

---

## Part 4: 更复杂的例子 — 有兄弟节点时

```mermaid
flowchart TB
    HR[HostRoot<br/>subtreeFlags=Placement+Update]
    DIV[divFiber<br/>flags=Placement<br/>subtreeFlags=Update]
    SPAN[spanFiber<br/>flags=Update<br/>subtreeFlags=NoFlags]
    P[pFiber<br/>flags=Placement<br/>subtreeFlags=NoFlags]

    HR -->|child| DIV
    DIV -->|child| SPAN
    SPAN -->|sibling| P

    style HR fill:#1e293b,stroke:#3b82f6,color:white,stroke-width:3
    style DIV fill:#f59e0b,stroke:#d97706,color:white,stroke-width:3
    style SPAN fill:#22c55e,stroke:#16a34a,color:white,stroke-width:3
    style P fill:#dc2626,stroke:#ef4444,color:white,stroke-width:3
```

```mermaid
sequenceDiagram
    participant O as outer 循环
    participant U as up 循环
    participant C as commitMutationEffectOnFiber
    participant N as nextEffect

    Note over N: 初始 = HostRoot

    O->>N: HostRoot: subtreeFlags≠0, child≠null → 下钻
    O->>N: next = divFiber

    O->>N: divFiber: subtreeFlags≠0, child≠null → 下钻
    O->>N: next = spanFiber

    O->>N: spanFiber: subtreeFlags=0 → 进入 up
    O->>U: ──── 进入 up ────

    U->>C: spanFiber → flags=Update → 处理 Update
    U->>U: sibling = pFiber ≠ null!
    U->>N: next = pFiber (兄弟节点)
    U-->>O: break up → 回到 outer

    O->>N: pFiber (是兄弟，不是父)
    O->>O: subtreeFlags=0 → 进入 up
    O->>U: ──── 进入 up ────

    U->>C: pFiber → flags=Placement → 处理 Placement ✅
    U->>U: sibling = null → 向上
    U->>N: next = pFiber.return = divFiber

    U->>C: divFiber → flags=Placement → 处理 Placement ✅
    U->>U: sibling = null → 向上
    U->>N: next = divFiber.return = HostRoot

    U->>C: HostRoot → flags=NoFlags → 无操作
    U->>U: sibling = null → 向上
    U->>N: next = HostRoot.return = null

    U->>N: next = null → 退出 up
    U-->>O: up 结束

    O->>N: next = null → 退出 outer ✅
    Note over O,C: 完成！span、p、div 都被处理了！
```

关键点：`break up` 后 nextEffect 指向的是 **兄弟节点 pFiber**，不是父节点。outer 继续下钻时是正常流程。

---

## Part 5: 为什么 commitMutationEffect 要设计成"迭代DFS"而不是递归

### 用流程图直观对比两种方案

```mermaid
flowchart TB
    subgraph left["递归方案 naiveDFS — React 15"]
        R1["naiveDFS(HostRoot)"] --> R2["naiveDFS(FunctionComponent)"]
        R2 --> R3["naiveDFS(div)"]
        R3 --> R4["naiveDFS(span)"]
        R4 --> R5["commitMutationEffectOnFiber(span)"]
        R4 --> R6["naiveDFS(p)"]
        R6 --> R7["commitMutationEffectOnFiber(p)"]
        R3 --> R8["commitMutationEffectOnFiber(div)"]
        R2 --> R9["commitMutationEffectOnFiber(Func)"]
    end

    subgraph right["迭代方案 commitMutationEffect — React 18"]
        I1[outer: nextEffect = HostRoot] --> I2{条件判断}
        I2 -->|下钻| I3[nextEffect = child]
        I3 --> I2
        I2 -->|进入 up| I4[up 循环处理]
        I4 --> I5[commitMutationEffectOnFiber<br/>处理当前]
        I5 --> I6{有兄弟?}
        I6 -->|是| I7[跳到兄弟]
        I7 --> I2
        I6 -->|否| I8[.return 向上]
        I8 --> I4
    end

    style R1 fill:#dc2626,stroke:#ef4444,color:white
    style R2 fill:#dc2626,stroke:#ef4444,color:white
    style R3 fill:#dc2626,stroke:#ef4444,color:white
    style R4 fill:#dc2626,stroke:#ef4444,color:white
    style R5 fill:#22c55e,stroke:#16a34a,color:white
    style R6 fill:#dc2626,stroke:#ef4444,color:white
    style R7 fill:#22c55e,stroke:#16a34a,color:white
    style R8 fill:#f59e0b,stroke:#d97706,color:white
    style R9 fill:#f59e0b,stroke:#d97706,color:white

    style I1 fill:#1e293b,stroke:#3b82f6,color:white
    style I2 fill:#f59e0b,stroke:#d97706,color:white
    style I3 fill:#22c55e,stroke:#16a34a,color:white
    style I4 fill:#8b5cf6,stroke:#7c3aed,color:white
    style I5 fill:#22c55e,stroke:#16a34a,color:white
    style I6 fill:#f59e0b,stroke:#d97706,color:white
    style I7 fill:#22c55e,stroke:#16a34a,color:white
    style I8 fill:#06b6d4,stroke:#0891b2,color:white
```

### 调用栈深度对比

```mermaid
flowchart LR
    subgraph 递归方案[递归DFS — 调用栈深度 = 树深度]
        FR1[帧1: HostRoot<br/>⬆️ 等待子返回] --> FR2[帧2: FunctionComponent<br/>⬆️ 等待]
        FR2 --> FR3[帧3: div<br/>⬆️ 等待]
        FR3 --> FR4[帧4: span<br/>⬆️ 等待]
        FR4 --> FR5[帧5: p<br/>完成]
        FR5 -.->|返回| FR4
        FR4 -.->|返回| FR3
        FR3 -.->|返回| FR2
        FR2 -.->|返回| FR1
    end

    subgraph 迭代方案[迭代DFS — 调用栈始终 = 1]
        I1[while 循环<br/>nextEffect: HostRoot→Func→div→span→p]
    end

    style FR1 fill:#dc2626,stroke:#ef4444,color:white
    style FR2 fill:#dc2626,stroke:#ef4444,color:white
    style FR3 fill:#dc2626,stroke:#ef4444,color:white
    style FR4 fill:#dc2626,stroke:#ef4444,color:white
    style FR5 fill:#22c55e,stroke:#16a34a,color:white
    style I1 fill:#22c55e,stroke:#16a34a,color:white,stroke-width:3
```

### 最坏情况对比：1000 层嵌套

```mermaid
gantt
    title 调用栈深度对比（1000 层嵌套）
    dateFormat X
    axisFormat %s

    section 递归方案
    栈帧 1 ~ 500   :a1, 0, 500
    栈帧 501 ~ 1000 :a2, 500, 500
    完全执行完毕后逐层返回 :a3, 1000, 500

    section 迭代方案
    while 循环始终只有 1 帧 :b1, 0, 1500
```

| 方案 | 1000 层嵌套时调用栈 | 风险 | 暂停能力 |
|------|-------------------|------|---------|
| 递归 DFS | 1000 层 | ⚠️ 栈溢出 | ❌ 不能暂停 |
| 迭代 DFS | **1 层** | ✅ 安全 | ✅ 可以 `requestIdleCallback` 分片执行 |

---

## Part 6: 核心优势 — 为并发模式铺路

```mermaid
sequenceDiagram
    participant D as 开发者代码
    participant S as Scheduler
    participant C as commitMutationEffect

    Note over D,C: 同步模式（现在的代码）
    D->>S: render(<App/>)
    S->>C: commitMutationEffect(finishedWork)
    C->>C: 一口气遍历完所有 fiber ✅
    C-->>D: 渲染完成

    Note over D,C: 未来：并发模式
    D->>S: render(<BigApp/>)
    S->>C: commitMutationEffect 执行中...
    C->>C: 处理了 5ms
    C-->>S: ⏱ 时间片到，暂停
    S-->>D: 其他任务执行...
    S->>C: requestIdleCallback → 继续
    C->>C: 处理剩余 fiber
    C-->>D: 渲染完成
```

**关键区别**：`nextEffect` 是**模块级全局变量**，它的值在函数调用之间是保留的。这意味着：

```typescript
let nextEffect = null; // ← 外部变量

export const commitMutationEffect = (finishedWork) => {
    nextEffect = finishedWork;
    while (nextEffect !== null) {
        // 处理一个节点后...
        if (时间到) {
            requestIdleCallback(commitMutationEffect); // 下次继续
            return; // ← 现在退出，但 nextEffect 的值保留了进度！
        }
    }
};
```

而递归版本做不到这一点——递归调用栈在函数退出时就全部销毁了，无法"记住"进度。

---

## 一句话记住全部

```
    outer ── 只看路标（subtreeFlags），不做实际工作
    up    ── 做实际工作，一口气干到根
    nextEffect ── 一个指针，走完整个树只用 1 层调用栈
    不会死循环 ── 因为 up 回到 outer 时 nextEffect 已经是 null
    为什么存在 ── 为并发模式保留暂停点，同时防止栈溢出
```
