# commitWork.ts 流程分析

## 1. 整体架构概述

三个核心函数在 commit 阶段中的定位：

- **`commitMutationEffect`**：深度优先遍历 finishedWork 树，逐个 fiber 分派操作
- **`commitMutationEffectOnFiber`**：检查当前 fiber 的 flags，执行对应的操作
- **`commitPlacement`**（`Placement` flag）：将新插入的 fiber 对应的 DOM 节点挂到父容器
- **`commitUpdate`**（`Update` flag）：更新已有 fiber 对应的 DOM 节点（目前仅处理 `HostText` 的文本更新）
- **`commitDeletion`**（`ChildDeletion` flag）：从 DOM 中删除整个子 fiber 子树

三个核心函数的职责：

| 函数 | 触发的 flag | 作用 |
|------|------------|------|
| `commitPlacement` | `Placement` | 将新插入的 fiber 对应的 DOM 节点挂到父容器 |
| `commitUpdate` | `Update` | 更新已有 fiber 对应的 DOM 节点（目前仅处理 `HostText` 的文本更新） |
| `commitDeletion` | `ChildDeletion` | 从 DOM 中删除整个子 fiber 子树 |

## 2. commitNestedComponent 的遍历算法

这是理解删除流程的核心函数。它是一种特殊的深度优先遍历（DFS）。

关键区别（与标准 DFS 相比）：

- 标准 DFS 通常用递归或显式栈。而这个版本是用迭代 + 指针操作实现的。
- 它在回溯时不从 `node.return` 指向的父节点重新开始，而是先找兄弟，找不到兄弟才向上回溯。
- 遇到 `node.return === root` 时直接返回，表示整个子树遍历完毕。

## 3. 具体例子 —— 逐步推演

### 场景假设

假设有以下 React 组件，更新后 `<Parent />` 被删除：

**更新前：**

```jsx
function Child1() {
  return <span id="c1">Child1 Text</span>;
}

function Parent() {
  return (
    <div id="parent">
      <Child1 />
      <span id="c2">Child2 Text</span>
    </div>
  );
}

function App() {
  return (
    <div id="app">
      <Parent />
      <footer id="footer">Footer</footer>
    </div>
  );
}
```

**更新后** `<Parent />` 被移除，于是 `div#app` 的 deletions 列表包含 `Parent` 这个 FunctionComponent fiber。

### Fiber 树结构

此时的内存中的 Fiber 树如下（用 `→` 表示 `child`，`↓` 表示 `sibling`）：

```
HostRoot
  └── App (FunctionComponent) → stateNode: 无
        └── div#app (HostComponent) → stateNode: <div id="app"> DOM
              │  ═══ flags: ChildDeletion, deletions = [Parent] ═══
              ├── Parent (FunctionComponent) ← childToDelete
              │     └── div#parent (HostComponent) → stateNode: <div id="parent">
              │           ├── Child1 (FunctionComponent)
              │           │     └── span#c1 (HostComponent) → stateNode: <span id="c1">
              │           │           └── "Child1 Text" (HostText) → stateNode: #text
              │           └── span#c2 (HostComponent) → stateNode: <span id="c2">
              │                 └── "Child2 Text" (HostText) → stateNode: #text
              └── footer#footer (HostComponent) → stateNode: <footer id="footer">
                    └── "Footer" (HostText) → stateNode: #text
```

### 完整文字逐步推演

#### 准备：被删除的子树的 Fiber 结构

```
root = Parent (FunctionComponent)
  └── child → div#parent (HostComponent)
        ├── child → Child1 (FunctionComponent)
        │     └── child → span#c1 (HostComponent)
        │           └── child → "Child1 Text" (HostText)
        └── sibling → span#c2 (HostComponent)
              └── child → "Child2 Text" (HostText)
```

#### 逐步骤跟踪代码执行

对照 `commitNestedComponent` 的代码：

```typescript
function commitNestedComponent(
    root: FiberNode,
    onCommitUnmount: (fiber: FiberNode) => void
) {
    let node = root;                              // ①  node = Parent
    while (true) {
        onCommitUnmount(node);                     // ② 每次先调用回调
        if (node.child !== null) {                 // ③ 有 child 就向下
            node.child.return = node;
            node = node.child;
            continue;
        }
        if (node === root) { return; }             // ④ 回到 root 就结束
        while (node.sibling === null) {            // ⑤ 无兄弟就向上回溯
            if (node.return === null || node.return === root) return;
            node = node.return;
        }
        node.sibling.return = node.return;         // ⑥ 有兄弟就水平移动
        node = node.sibling;
    }
}
```

---

#### 第 1 步：`node = Parent`

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount(Parent)` | 回调检测到 tag = `FunctionComponent`，`rootHostNode = Parent` **(首次命中！)** |
| `node.child !== null`? | **有**，child 是 `div#parent` |
| `node.child.return = node` | 设置 `div#parent.return = Parent` |
| `node = node.child` | **`node = div#parent`**，`continue` |

---

#### 第 2 步：`node = div#parent`

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount(div#parent)` | tag = `HostComponent`，但 `rootHostNode` 已经不为 null，**跳过** |
| `node.child !== null`? | **有**，child 是 `Child1` |
| `node.child.return = node` | `Child1.return = div#parent` |
| `node = node.child` | **`node = Child1`**，`continue` |

---

#### 第 3 步：`node = Child1`

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount(Child1)` | tag = `FunctionComponent`，`rootHostNode` 已存在，**跳过** |
| `node.child !== null`? | **有**，child 是 `span#c1` |
| `node.child.return = node` | `span#c1.return = Child1` |
| `node = node.child` | **`node = span#c1`**，`continue` |

---

#### 第 3b 步：`node = span#c1`

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount(span#c1)` | HostComponent，跳过 |
| `node.child !== null`? | **有**，"Child1 Text" |
| `node = node.child` | **`node = "Child1 Text"`** |

---

#### 第 3c 步：`node = "Child1 Text"`（叶子节点）

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount("Child1 Text")` | HostText，跳过 |
| `node.child !== null`? | **没有** |
| `node === root`? | 否 |
| `node.sibling === null`? | **没有 sibling** → 进入回溯 while 循环 |
| `node.return === root`? | `"Child1 Text".return = span#c1`。`span#c1 === Parent`? **否** |
| `node = node.return` | **`node = span#c1`** |
| `span#c1.sibling === null`? | **没有 sibling** → 继续 while |
| `span#c1.return === root`? | `span#c1.return = Child1`。`Child1 === Parent`? **否** |
| `node = node.return` | **`node = Child1`** |
| `Child1.sibling === null`? | Child1 在 `div#parent` 下，div#parent 有 child→Child1, sibling→span#c2。所以 `Child1.sibling` 指向 `span#c2`！**`sibling !== null`** → **跳出 while** |

| `node.sibling.return = node.return` | `span#c2.return = Child1.return = div#parent` |
| `node = node.sibling` | **`node = span#c2`**，回到 while 顶部 |

---

#### 第 4 步：`node = span#c2`

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount(span#c2)` | HostComponent，跳过 |
| `node.child !== null`? | **有**，"Child2 Text" |
| `node = node.child` | **`node = "Child2 Text"`** |

---

#### 第 5 步：`node = "Child2 Text"`（叶子节点）

| 代码行 | 状态 |
|--------|------|
| `onCommitUnmount("Child2 Text")` | HostText，跳过 |
| `node.child !== null`? | **没有** |
| `node === root`? | 否 |
| `node.sibling === null`? | **没有 sibling** → 进入回溯 |
| `"Child2 Text".return === root`? | `"Child2 Text".return = span#c2`。`span#c2 === Parent`? **否** |
| `node = node.return = span#c2` | |
| `span#c2.sibling === null`? | **没有 sibling** → 继续 |
| `span#c2.return === root`? | `span#c2.return = div#parent`。`div#parent === Parent`? **否** |
| `node = node.return = div#parent` | |
| `div#parent.sibling === null`? | **没有 sibling** → 继续 |
| `div#parent.return === root`? | `div#parent.return = Parent`。**`Parent === root` → 是！** |
| **`return`** | **遍历结束！** |

---

### 遍历完成后的执行

commitNestedComponent 结束，回到 `commitDeletion`：

```typescript
// rootHostNode = Parent (FunctionComponent)
if (rootHostNode !== null) {
    const hostParent = getHostParent(childToDelete);
    // hostParent = div#app 的 DOM 节点
    if (hostParent !== null) {
        removeChild(rootHostNode, hostParent);
        // 从 <div id="app"> 中移除对应的 DOM 节点
    }
}
childToDelete.return = null;   // 断开 Parent 与父 fiber 的连接
childToDelete.child = null;    // 断开 Parent 与子 fiber 的连接
```

## 4. 核心总结

### commitNestedComponent 的本质

它是一个自定义的 DFS（深度优先遍历），专门遍历某个根 fiber 下的整个子树。其遍历顺序是前序遍历（Pre-order）：

```
Parent → div#parent → Child1 → span#c1 → "Child1 Text" → span#c2 → "Child2 Text"
```

### 三个关键作用

| 作用 | 说明 |
|------|------|
| **回调机制** | 对每个 fiber 调用 `onCommitUnmount`，实现"解绑"逻辑的扩展点（目前只记录了第一个 DOM 节点的位置） |
| **找到顶层 DOM 节点** | DFS 首先访问的就是 `root` 节点自身，所以回调的第一个有效命中必然是子树中最顶层的 DOM 承载节点 |
| **断开节点连接** | 遍历结束后，`childToDelete.return = null` 和 `childToDelete.child = null` 把被删除子树从 Fiber 树中摘除 |

### 为什么 DFS 的第一个命中就是"最顶层"的 DOM 节点？

因为这是前序遍历（Pre-order）。对于这个例子：

- 如果 `root` 本身就是 `HostComponent`（如删除 `<div>`），第一次回调就命中了
- 如果 `root` 是 `FunctionComponent`（如删除 `<Section />`），第一次回调就是 `root` 本身，所以 `rootHostNode = root`
- 即使继续深钻，`rootHostNode` 已经设置，不会再被覆盖

### commitUpdate 的作用

`commitUpdate` 目前只处理了 `HostText` 类型：

```typescript
case HostText:
    const text = fiber.memoizedProps?.content;
    commitTextUpdate(fiber.stateNode, text);
    // → textInstance.textContent = content;  直接更新 DOM 文本内容
```

它的作用是：当 fiber 的 `flags` 中含有 `Update` 标记时，将 fiber 上的 `memoizedProps` 同步到真实的 DOM 节点上（文本内容的更新）。

### 一句话总结

- **`commitUpdate`**：把 fiber 上的新数据同步到已存在的 DOM 节点（目前只做了文本更新）
- **`commitDeletion`**：用 `commitNestedComponent` DFS 遍历被删除的整个子树，找到最顶层的 DOM 承载节点，然后一句 `removeChild` 从浏览器 DOM 中一次性移除整个子树（浏览器会自动回收所有子孙 DOM 节点）
- **`commitNestedComponent`** 是这个删除流程中负责"把整个子树走一遍"的遍历器——它的核心价值在于可扩展的回调机制，目前只做了找顶层 DOM 节点，未来可以在回调里添加解绑 ref、清理 useEffect 等逻辑
