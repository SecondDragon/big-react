import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
	ChildDeletion,
	Flags,
	MutationMask,
	NoFlags,
	PassiveEffect,
	PassiveMask,
	Placement,
	Update
} from './fiberFlags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import {
	appendChildToContainer,
	commitUpdate,
	Container,
	insertChildToContainer,
	Instance,
	removeChild
} from 'hostConfig';
import { Effect, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';

let nextEffect: FiberNode | null = null;

/**
 * commit 阶段 Mutation 子阶段的入口。深度优先遍历整棵 finishedWork 树，
 * 对每个自身或子树带有 MutationMask 副作用标记的 fiber 执行 commitMutationEffectOnFiber。
 *
 * 执行流程：
 * 1. 从 HostRoot 出发，优先向下钻取：只要当前 fiber 的 subtreeFlags 命中 MutationMask
 *    且存在 child，就进入 child（跳过无副作用子树）
 * 2. 钻到叶子 / 无副作用子树的根后，进入"向上"阶段：
 *    对当前 fiber 执行 commitMutationEffectOnFiber
 * 3. 处理完当前 fiber 后，若有 sibling → 跳到 sibling 继续步骤 1（处理兄弟子树）
 * 4. 若无 sibling → 向上回溯到 return，重复步骤 2-4，直到回溯到 null
 *
 * 具体举例：
 *   假设本次 render 阶段产生的副作用如下：
 *     - li#2 文本从 'b' 改成 'B' → li#2.flags = Update
 *     - p#new 是新插入节点      → p#new.flags = Placement
 *     - div#old 被删除          → ul（其父）.flags = ChildDeletion，ul.deletions = [div#old]
 *
 *   fiber 树（只画出关键路径）：
 *     HostRoot (subtreeFlags = MutationMask)
 *       └── div#app (subtreeFlags = MutationMask)
 *             └── ul (flags = ChildDeletion, subtreeFlags = MutationMask)
 *                   ├── li#1 (flags = NoFlags, subtreeFlags = NoFlags)
 *                   ├── li#2 (flags = Update)        ← 目标 1
 *                   ├── li#3 (flags = NoFlags, subtreeFlags = MutationMask)
 *                   │     └── p#new (flags = Placement) ← 目标 2
 *                   └── (deletions: [div#old])       ← 目标 3
 *
 * 逐步骤推演（nextEffect 的移动轨迹）：
 *   ① HostRoot: subtreeFlags 命中 → nextEffect = div#app
 *   ② div#app:  subtreeFlags 命中 → nextEffect = ul
 *   ③ ul:       subtreeFlags 命中 → nextEffect = li#1
 *   ④ li#1:     subtreeFlags 不命中（NoFlags），进入 up 循环
 *               commitMutationEffectOnFiber(li#1) → flags=NoFlags，什么都不做
 *               li#1.sibling = li#2 → nextEffect = li#2，break up
 *   ⑤ li#2:     subtreeFlags 不命中，进入 up 循环
 *               commitMutationEffectOnFiber(li#2) → 执行 Update ✅
 *               li#2.sibling = li#3 → nextEffect = li#3，break up
 *   ⑥ li#3:     subtreeFlags 命中（因子节点 p#new）→ nextEffect = p#new
 *   ⑦ p#new:    无 child，进入 up 循环
 *               commitMutationEffectOnFiber(p#new) → 执行 Placement ✅
 *               p#new.sibling = null → nextEffect = li#3.return = ul
 *   ⑧ ul:       commitMutationEffectOnFiber(ul) → 执行 ChildDeletion ✅
 *               ul.sibling = null → nextEffect = ul.return = div#app
 *   ⑨ div#app:  commitMutationEffectOnFiber → NoFlags 跳过
 *               div#app.sibling = null → nextEffect = HostRoot
 *   ⑩ HostRoot: commitMutationEffectOnFiber → NoFlags 跳过
 *               HostRoot.sibling = null → nextEffect = HostRoot.return = null → 循环结束
 *
 * 结论：
 *   通过 subtreeFlags 预判，整棵 NoFlags 子树（如 li#1）会被直接跳过，
 *   不会触发 commitMutationEffectOnFiber 之外的任何判断。这是 render 阶段
 *   "冒泡" subtreeFlags 的核心收益——commit 阶段的遍历成本只和"有副作用的路径"成正比。
 *
 * @param finishedWork 构建完成的 HostRoot fiber（workInProgress 树的根）
 * @param root FiberRootNode，向下传递给 commitMutationEffectOnFiber，最终供 commitPassiveEffect 使用
 */
export const commitMutationEffect = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	nextEffect = finishedWork;

	while (nextEffect !== null) {
		const child: FiberNode | null = nextEffect.child;
		// 向下钻
		if (
			(nextEffect.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags &&
			child !== null
		) {
			nextEffect = child;
		} else {
			// 	钻到了叶子节点或者 subtreeFlags 确实为 NoFlags 的节点，但是这个节点的flags的值还不确定
			// 现在开始向上遍历
			up: while (nextEffect !== null) {
				commitMutationEffectOnFiber(nextEffect, root);
				const sibling: FiberNode | null = nextEffect.sibling;
				if (sibling !== null) {
					nextEffect = sibling;
					break up;
				}
				// 如果sibling为null，就向上
				nextEffect = nextEffect.return;
			}
		}
	}
};

/**
 * 在 Mutation 子阶段对单个 fiber 执行其被标记的所有副作用操作。
 * 这是 commitMutationEffect 在遍历到每个 fiber 时的回调。
 *
 * 执行流程：
 * 1. 读取 finishedWork.flags，依次检测四种副作用位（顺序就是代码中的 if 顺序）
 * 2. 命中 Placement       → 调用 commitPlacement，随后 flags &= ~Placement 清除标记
 * 3. 命中 Update          → 调用 hostConfig.commitUpdate（更新 DOM 属性），随后清除 Update
 * 4. 命中 ChildDeletion   → 遍历 finishedWork.deletions 数组，对每个 childToDelete
 *    调用 commitDeletion，随后清除 ChildDeletion
 * 5. 命中 PassiveEffect   → 调用 commitPassiveEffect 收集 useEffect 回调（不立即执行），
 *    随后清除 PassiveEffect。这是 Passive 子阶段的入口，与 Mutation 的同步 DOM 操作不同
 *
 * 四个 if 相互独立、按位清除：一个 fiber 可能同时携带多个副作用
 * （例如 li 节点既被移动 Placement 又更新了 props Update）。
 *
 * 具体举例：
 *   场景 ①：li#2 仅文本更新（'a' → 'A'）
 *     li#2.flags = Update (0b0000010)
 *     执行过程：
 *       - Placement & Update = NoFlags → 跳过
 *       - Update 命中 → commitUpdate(li#2) → DOM textContent 改为 'A'
 *       - ChildDeletion & Update = NoFlags → 跳过
 *     结束时：li#2.flags = NoFlags
 *
 *   场景 ②：ul 既有子节点删除，又有自身属性更新
 *     ul.flags = Update | ChildDeletion (0b0000110)
 *     ul.deletions = [div#old]
 *     执行过程：
 *       - Placement 不命中 → 跳过
 *       - Update 命中 → commitUpdate(ul) 更新 className 等属性
 *       - ChildDeletion 命中 → 遍历 deletions，commitDeletion(div#old)
 *         → div#old 及其子树的 DOM 从 ul 中 removeChild
 *     结束时：ul.flags = NoFlags
 *
 *   场景 ③：p#new 是新插入的节点
 *     p#new.flags = Placement (0b0000001)
 *     执行过程：
 *       - Placement 命中 → commitPlacement(p#new)
 *         → getHostParent + getHostSibling + insertOrAppend 把 <p> 插入到父 DOM
 *       - Update / ChildDeletion 不命中 → 跳过
 *     结束时：p#new.flags = NoFlags
 *
 * 结论：
 *   该函数是 commit 阶段的"调度中心"，把 flags 位掩码翻译为具体的 DOM 操作。
 *   每个副作用处理完后立即用 &= ~X 清除标记，保证同一 fiber 在 commit 阶段
 *   不会被重复处理（例如 HostRoot 在向上回溯时会再次经过 commitMutationEffectOnFiber）。
 *
 * @param finishedWork 当前要处理的 fiber（由 commitMutationEffect 遍历得到）
 * @param root FiberRootNode，传递给 commitPassiveEffect / commitDeletion 用于访问 pendingPassiveEffects
 */
const commitMutationEffectOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const flags = finishedWork.flags;
	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork);
		// 非运算相当于移除Placement标记
		finishedWork.flags &= ~Placement;
	}

	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork);
		// 非运算相当于移除Update标记
		finishedWork.flags &= ~Update;
	}
	if ((flags & ChildDeletion) !== NoFlags) {
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete, root);
			});
		}
		// 非运算相当于移除ChildDeletion标记
		finishedWork.flags &= ~ChildDeletion;
	}
	if ((flags & PassiveEffect) !== NoFlags) {
		// 收集回调
		commitPassiveEffect(finishedWork, root, 'update');
		// 移除PassiveEffect
		finishedWork.flags &= ~PassiveEffect;
	}

	// 	flags update
	// 	flags ChildDeletion
};

/**
 * commit 阶段 Passive 子阶段的入口（useEffect 的回调执行）。
 *
 * 职责描述：
 *   对带有 PassiveEffect 标记的 fiber，将其对应的 useEffect 回调（create / destroy）
 *   收集到 FiberRootNode.pendingPassiveEffects 中，等待调度器在浏览器绘制后异步执行。
 *
 * ⚠️ TODO：当前函数体为空，是 Passive 阶段实现的占位。
 *   完整实现需要做两件事：
 *   1. 根据 type（'mount' | 'update' | 'unmount'）遍历 fiber.updateQueue.lastEffect
 *      环形链表，收集每个 Effect 的 create / destroy 回调
 *   2. 把收集到的回调推入 root.pendingPassiveEffects[type] 队列
 *
 * 调用位置：
 *   commitMutationEffectOnFiber 中，当 flags 命中 PassiveEffect 时被触发：
 *     commitPassiveEffect(finishedWork, root, 'update')
 *
 * 与 Mutation 子阶段的关系：
 *   - Mutation（本文件其它函数）：同步执行 DOM 修改，不可中断
 *   - Passive（本函数 + 后续调度）：异步执行 useEffect 回调，不阻塞绘制
 *
 * @param fiber
 * @param root FiberRootNode，用于访问 pendingPassiveEffects 队列
 * @param type 收集类型：'mount' 收集 create；'update' 收集 destroy + create；'unmount' 只收集 destroy
 */
function commitPassiveEffect(
	fiber: FiberNode,
	root: FiberRootNode,
	type: keyof PendingPassiveEffects
	// eslint-disable-next-line @typescript-eslint/no-empty-function
) {
	// update unmount
	if (
		fiber.tag !== FunctionComponent ||
		(type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
	) {
		return;
	}
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue !== null) {
		if (updateQueue.lastEffect === null && __DEV__) {
			console.error('当FC存在PassiveEffect flag时，不应该不存在effect');
		}
		root.pendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
	}
}

/**
 * 遍历 Effect 环形单向链表，对所有 tag 命中指定 flags 的 Effect 执行回调。
 * 这是 commitHookEffectListUnmount / Destroy / Create 三个函数的底层公共实现。
 *
 * 执行流程：
 * 1. 从 lastEffect.next（即链表的"头部"）开始遍历
 * 2. 对每个 Effect 做位运算 (effect.tag & flags) === flags：
 *    - 命中 → 调用 callback(effect)
 *    - 未命中 → 跳过（deps 未变化的 Effect 在 updateEffect 中被标记为 Passive 无 HasEffect，会在这里被过滤掉）
 * 3. effect = effect.next 继续前进
 * 4. 直到再次回到 lastEffect.next（环头），说明遍历完一整圈，结束
 *
 * 具体举例：
 *   某 FunctionComponent 内连续调用了 3 次 useEffect：
 *     useEffect(() => {...}, []);         // Effect_A
 *     useEffect(() => {...}, [count]);    // Effect_B
 *     useEffect(() => {...});             // Effect_C（无 deps）
 *
 *   fiber.updateQueue.lastEffect 环形链表结构（lastEffect 指向尾部 C）：
 *     A ──→ B ──→ C ──→ A
 *     ↑               |
 *     |_______________|
 *     lastEffect = C
 *
 *   各 Effect 的 tag：
 *     Effect_A: Passive | HookHasEffect = 0b0011（mount 时全部需要执行）
 *     Effect_B: Passive | HookHasEffect = 0b0011（deps 变化）
 *     Effect_C: Passive              = 0b0010（deps 未变化，updateEffect 没标 HasEffect）
 *
 * 逐步骤推演（调用方传入 flags = Passive | HookHasEffect = 0b0011）：
 *   ① effect = lastEffect.next = A（环头）
 *      (0b0011 & 0b0011) === 0b0011 ✅ → callback(A)
 *   ② effect = A.next = B
 *      (0b0011 & 0b0011) === 0b0011 ✅ → callback(B)
 *   ③ effect = B.next = C
 *      (0b0010 & 0b0011) = 0b0010 ≠ 0b0011 ❌ → 跳过（deps 未变化，不执行）
 *   ④ effect = C.next = A = lastEffect.next → 回到环头，do-while 退出
 *
 * 结论：
 *   通过环形链表 + lastEffect 指针，无需记录"头指针"也能遍历全部 Effect；
 *   通过位运算过滤 tag，把"是否执行"的判断从 render 阶段（updateEffect 的
 *   areHookInputsEqual）传递到了 commit 阶段，实现了跨阶段的状态通信。
 *
 * @param flags 目标副作用掩码（如 Passive | HookHasEffect）
 * @param lastEffect 环形链表的尾部 Effect（fiber.updateQueue.lastEffect）
 * @param callback 对命中 flags 的 Effect 要执行的操作
 */
function commitHookEffectList(
	flags: Flags,
	lastEffect: Effect,
	callback: (effect: Effect) => void
) {
	let effect = lastEffect.next as Effect;

	do {
		if ((effect.tag & flags) === flags) {
			callback(effect);
		}
		effect = effect.next as Effect;
	} while (effect !== lastEffect.next);
}

/**
 * 组件卸载时，遍历 Effect 链表执行所有 destroy（清理函数），并清除 HookHasEffect 标记。
 * 仅在组件被删除的场景调用（commitDeletion → commitPassiveEffect 收集 → flushPassiveEffects 触发）。
 *
 * 执行流程：
 * 1. 通过 commitHookEffectList 遍历链表，筛选 tag 命中 flags 的 Effect
 * 2. 若 effect.destroy 是函数 → 执行（如清除定时器、取消订阅）
 * 3. 执行后 effect.tag &= ~HookHasEffect 清除标记，防止同一 Effect 被重复清理
 *
 * 具体举例：
 *   组件代码：
 *     useEffect(() => {
 *       const timer = setInterval(() => console.log('tick'), 1000);
 *       return () => clearInterval(timer);   // destroy
 *     }, []);
 *
 *   组件被卸载时：
 *     → commitDeletion → commitPassiveEffect(fiber, root, 'unmount')
 *     → root.pendingPassiveEffects.unmount.push(lastEffect)
 *     → 浏览器绘制后，flushPassiveEffects 中：
 *       pendingPassiveEffects.unmount.forEach(effect =>
 *         commitHookEffectListUnmount(Passive, effect)
 *       )
 *
 * 逐步骤推演：
 *   ① 遍历到该 Effect，tag = Passive | HookHasEffect（mount 时被标记）
 *      但调用方传入的是 Passive（不带 HookHasEffect），所以筛选条件为：
 *      (effect.tag & Passive) === Passive ✅ → 命中
 *   ② destroy 是 clearInterval 的闭包 → 执行，定时器被清除
 *   ③ effect.tag &= ~HookHasEffect → tag 变为 Passive（即使后续误触也不会再执行 destroy）
 *
 * 结论：
 *   组件卸载时不关心 deps 是否变化，所有 Effect 的 destroy 都要执行。
 *   因此调用方传入的 flags 只包含 Passive（不区分 HasEffect）。
 *   tag &= ~HookHasEffect 是防御性操作：即使 lastEffect 因某种原因被再次遍历，
 *   destroy 也不会被执行第二次。
 *
 * @param flags 目标副作用掩码（flushPassiveEffects 传入的是 Passive，即 0b0010）
 * @param lastEffect 环形链表的尾部 Effect（fiber.updateQueue.lastEffect）
 */
export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
		// 彻底移除，因为这个组件已经被卸载了，在
		effect.tag &= ~HookHasEffect;
	});
}

/**
 * 组件更新时，在 create 执行之前先执行 destroy（清理上一次的副作用）。
 * 仅处理 deps 变化过的 Effect（tag 包含 HookHasEffect）。
 *
 * 执行流程：
 * 1. commitHookEffectList 筛选 tag 命中 flags 的 Effect
 * 2. 若 effect.destroy 是函数 → 执行（清理上一次渲染留下的副作用）
 *
 * 与 commitHookEffectListUnmount 的区别：
 *   - Unmount：组件卸载时调用，执行 destroy 后清除 HookHasEffect 标记
 *   - Destroy：组件更新时调用，仅执行 destroy，不清除标记
 *     （因为接下来的 commitHookEffectListCreate 还会再次命中同一 Effect）
 *
 * 具体举例：
 *   组件代码：
 *     const [count, setCount] = useState(0);
 *     useEffect(() => {
 *       console.log('effect', count);
 *       return () => console.log('cleanup', count);
 *     }, [count]);
 *
 *   第一次渲染（mount）：
 *     → commit 阶段执行 create()，打印 "effect 0"
 *     → destroy 被赋值为 cleanup 闭包（引用了 count=0）
 *
 *   点击按钮 setCount(1) 触发 update：
 *     → render 阶段 updateEffect：deps [1] ≠ [0]，tag |= HookHasEffect
 *     → commit 阶段 flushPassiveEffects 依次调用：
 *       ① commitHookEffectListDestroy(Passive | HookHasEffect, lastEffect)
 *          → 命中 → 执行 destroy → 打印 "cleanup 0" ✅
 *       ② commitHookEffectListCreate(Passive | HookHasEffect, lastEffect)
 *          → 命中 → 执行 create → 打印 "effect 1"
 *          → effect.destroy = create() 的返回值（新的 cleanup 闭包，引用 count=1）
 *
 * 结论：
 *   "先 destroy 再 create"的顺序保证了清理函数始终能看到上一次的闭包环境，
 *   新的副作用在干净的状态下启动。这也是 React 官方 useEffect 的行为契约。
 *
 * @param flags 目标副作用掩码（flushPassiveEffects 传入的是 Passive | HookHasEffect）
 * @param lastEffect 环形链表的尾部 Effect（fiber.updateQueue.lastEffect）
 */
export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
	});
}

/**
 * 执行 Effect 的 create 回调，并把返回值赋给 effect.destroy，作为下一次的清理函数。
 * 这是 useEffect 副作用真正"生效"的地方。
 *
 * 执行流程：
 * 1. commitHookEffectList 筛选 tag 命中 flags 的 Effect
 * 2. 若 effect.create 是函数 → 执行 create()
 * 3. 将 create 的返回值（清理函数）赋给 effect.destroy
 *    → 下一次 update 时 commitHookEffectListDestroy 会拿到并执行
 *
 * 具体举例：
 *   组件代码：
 *     useEffect(() => {
 *       const timer = setInterval(() => console.log('tick'), 1000);
 *       return () => clearInterval(timer);   // ← 这个返回值就是 destroy
 *     }, []);
 *
 *   mount 时：
 *     ① updateEffect / mountEffect 把 create 包装成 Effect 推入链表
 *     ② commit 阶段 commitHookEffectListCreate(Passive | HookHasEffect, lastEffect)
 *        → 命中 → 执行 create()
 *        → setInterval 启动，返回 cleanup 函数
 *        → effect.destroy = cleanup
 *
 *   下次 deps 变化或组件卸载时：
 *     → commitHookEffectListUnmount / Destroy 读取 effect.destroy
 *     → 执行 cleanup → clearInterval(timer)
 *
 * 逐步骤推演（链表指针变化）：
 *   执行前：effect = { tag, create: fn, destroy: undefined, deps, next }
 *   执行后：effect = { tag, create: fn, destroy: cleanupFn, deps, next }
 *                                          ↑
 *                          下一次 commit 时从这里读取并执行
 *
 * 结论：
 *   create() 的返回值作为 destroy 挂到同一个 Effect 对象上，形成
 *   "本次 create 产生副作用 → 下次 destroy 清理副作用" 的闭环。
 *   这就是注释中"就是在这里给下一轮的destroy赋值，哈哈"的含义——
 *   Effect 对象在 mount/update 之间被复用，destroy 字段在 commit 阶段被动态填充。
 *
 * @param flags 目标副作用掩码（flushPassiveEffects 传入的是 Passive | HookHasEffect）
 * @param lastEffect 环形链表的尾部 Effect（fiber.updateQueue.lastEffect）
 */
export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const create = effect.create;
		if (typeof create === 'function') {
			// 就是在这里给下一轮的destroy赋值，哈哈
			effect.destroy = create();
		}
	});
}

/**
 * 收集子树中需要从父 DOM 中移除的 Host fiber。
 *
 * 核心逻辑：只收集与上一个已收集节点在 fiber sibling 链上相连的 Host 节点。
 * 目的是跳过 FunctionComponent 内部嵌套的 Host 节点——这些节点无法通过一次
 * sibling 遍历到达，且它们可能共用同一个祖先 DOM，后续会被其他机制处理。
 *
 * 配合 Fragment 就能正常工作：
 *
 * fiber 树（Fragment 场景）：
 *   ul (删除目标)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)  ← sibling 链上连通
 *           ├── li#2 (HostComponent)  ← 同上
 *           └── li#3 (HostComponent)  ← 同上
 *
 * commitNestedComponent 遍历顺序：
 *   ul → Fragment → li#1 → li#2 → li#3
 *
 * recordHostChildrenToDelete 执行过程：
 *   ① li#1：childrenToDelete 为空 → 直接 push，得到 [li#1]
 *   ② li#2：从 li#1.sibling 出发 → li#1.sibling = li#2 → 找到，push → [li#1, li#2]
 *   ③ li#3：从 li#1.sibling 出发 → li#1.sibling = li#2, li#2.sibling = li#3 → 找到，push → [li#1, li#2, li#3]
 *   ✅ 全部收集成功，后续从 <ul> 中逐个 removeChild
 *
 * fiber 树（无 Fragment，FunctionComponent 嵌套）：
 *   div (删除目标)
 *     ├── p#1 (HostComponent)
 *     ├── Child (FunctionComponent)
 *     │     └── span (HostText)       ← 不在 p#1 的 sibling 链上
 *     └── p#2 (HostComponent)
 *
 * commitNestedComponent 遍历顺序：
 *   div → p#1 → Child → span → p#2
 *
 * recordHostChildrenToDelete 执行过程：
 *   ① p#1：childrenToDelete 为空 → 直接 push，得到 [p#1]
 *   ② span：从 p#1.sibling 出发 → p#1.sibling = Child，不是 span → 找不到，跳过 ❌
 *   ③ p#2：从 p#1.sibling 出发 → p#1.sibling = Child, Child.sibling = p#2 → 找到，push → [p#1, p#2]
 *   ⚠️ span 被遗漏，它的 stateNode 不会被 removeChild
 *   这意味着 FunctionComponent 子节点内部的宿主节点（如 span）无法被正确清理。
 *   这也是为什么 Fiber 树中推荐将 FunctionComponent 的多个兄弟节点用 Fragment 包裹的原因之一。
 *
 * @param childrenToDelete 收集结果的数组
 * @param unmountFiber 遍历到的 fiber，可能是 HostComponent / HostText
 */
function recordHostChildrenToDelete(
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) {
	const lastOne = childrenToDelete[childrenToDelete.length - 1];

	if (!lastOne) {
		childrenToDelete.push(unmountFiber);
	} else {
		let node = lastOne.sibling;
		while (node !== null) {
			if (node === unmountFiber) {
				childrenToDelete.push(unmountFiber);
			}
			node = node.sibling;
		}
	}
}

/**
 * 删除 fiber 子树，从父 DOM 中移除所有对应的真实 DOM 节点。
 *
 * 执行流程：
 * 1. 通过 commitNestedComponent 深度优先遍历整棵子树
 * 2. 对每个 HostComponent / HostText 调用 recordHostChildrenToDelete 收集
 * 3. 根据收集结果，从 getHostParent(childToDelete) 找到的父 DOM 容器中 removeChild
 *
 * ─── 场景 A ──────────────────────────────────
 * childToDelete 是 ul（HostComponent），例如：
 *   <div id="root">
 *     <ul>
 *       <li>1</li>
 *       <li>2</li>
 *       <li>3</li>
 *     </ul>
 *   </div>
 *
 * fiber 树（childToDelete = ul）：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent)
 *                 └── "3" (HostText)
 *
 * commitNestedComponent 遍历：ul → Fragment → li#1 → "1" → li#2 → "2" → li#3 → "3"
 *
 * recordHostChildrenToDelete 收集过程：
 *  ① ul：rootChildrenToDelete 为空 → push ul → [ul]
 *  ② li#1：lastOne = ul，ul.sibling = null → li#1 NOT 收集 ❌
 *  ③ 后续所有 li / text 同理被跳过
 *
 * rootChildrenToDelete = [ul]
 * getHostParent(ul) → ul.return 向上直到 HostRoot → 返回 <div id="root">
 *
 * 最终删除：
 *   removeChild(<ul>, <div id="root">)
 *   ✅ 直接把整个 <ul> 从 DOM 中移除
 *
 * ─── 场景 B ──────────────────────────────────
 * childToDelete 是 Fragment（当 Fragment 作为外层节点被删除时）：
 *
 * fiber 树（childToDelete = Fragment）：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)  ← childToDelete
 *           ├── li#1 (HostComponent, stateNode = <li>1</li>)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent, stateNode = <li>2</li>)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent, stateNode = <li>3</li>)
 *                 └── "3" (HostText)
 *
 * commitNestedComponent 遍历：Fragment → li#1 → "1" → li#2 → "2" → li#3 → "3"
 *
 * recordHostChildrenToDelete 收集过程：
 *  ① Fragment：tag=7 → default → 什么都不做
 *  ② li#1：rootChildrenToDelete 为空 → push li#1 → [li#1]
 *  ③ "1"：lastOne = li#1，li#1.sibling = li#2，li#2 !== "1" → NOT 收集 ❌
 *  ④ li#2：lastOne = li#1，li#1.sibling = li#2，li#2 === li#2 → push → [li#1, li#2]
 *  ⑤ "2"：lastOne = li#2，li#2.sibling = li#3，li#3 !== "2" → NOT 收集 ❌
 *  ⑥ li#3：lastOne = li#2，li#2.sibling = li#3，li#3 === li#3 → push → [li#1, li#2, li#3]
 *  ⑦ "3"：lastOne = li#3，li#3.sibling = null → NOT 收集 ❌
 *
 * rootChildrenToDelete = [li#1, li#2, li#3]
 * getHostParent(Fragment) → Fragment.return = ul (HostComponent) → 返回 <ul>
 *
 * 最终删除：
 *   removeChild(<li>1</li>, <ul>)
 *   removeChild(<li>2</li>, <ul>)
 *   removeChild(<li>3</li>, <ul>)
 *   ✅ Fragment 本身无 DOM，逐个移除其子 Host 节点（它们确实是 <ul> 的直接子 DOM）
 *
 * 核心结论：当 childToDelete 本身是 HostComponent 时直接 removeChild 它自己；
 * 当 childToDelete 是非 DOM 节点（Fragment / FunctionComponent）时，
 * 需要逐个移除其顶层 Host 子节点。
 *
 * @param childToDelete 需要被删除的子 fiber（已被父 fiber 的 deletions 数组引用）
 * @param root FiberRootNode，预留给后续 useEffect unmount 清理时访问 pendingPassiveEffects
 */
function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
	const rootChildrenToDelete: FiberNode[] = [];

	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// TODO:解绑ref
				return;
			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;
			case FunctionComponent:
				// TODO:useEffect unmount的处理
				commitPassiveEffect(unmountFiber, root, 'unmount');
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型', unmountFiber);
				}
		}
	});

	if (rootChildrenToDelete.length !== 0) {
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			rootChildrenToDelete.forEach((node) => {
				removeChild((node as FiberNode).stateNode, hostParent);
			});
		}
	}

	childToDelete.return = null;
	childToDelete.child = null;
}

/**
 * 深度优先遍历整棵 fiber 子树，在每个节点上调用 onCommitUnmount 回调。
 * 用于 commitDeletion 中逐个 fiber 执行卸载前的清理工作（收集 Host DOM / 未来解绑 ref / 触发 useEffect cleanup）。
 *
 * 遍历策略：标准的向下钻 + 水平移 + 向上回溯。
 *
 * 以 Fragment 场景为例：
 *   ul (删除目标)
 *     └── Fragment (tag=7)
 *           ├── li#1 (HostComponent)
 *           │     └── "1" (HostText)
 *           ├── li#2 (HostComponent)
 *           │     └── "2" (HostText)
 *           └── li#3 (HostComponent)
 *                 └── "3" (HostText)
 *
 * 遍历顺序：
 *   步骤  node          child?  sibling?  ↑/↓
 *   ─────────────────────────────────────────────
 *    ①   ul            → Fragment              回调:unmount(ul)
 *    ②   Fragment      → li#1                  回调:unmount(Fragment)
 *    ③   li#1          → "1"                   回调:unmount(li#1)
 *    ④   "1"           null    null             回调:unmount("1"), node!=root
 *                       └─向上: return=li#1, li#1.sibling=li#2 → 水平到 li#2
 *    ⑤   li#2          → "2"                   回调:unmount(li#2)
 *    ⑥   "2"           null    null
 *                       └─向上: return=li#2, li#2.sibling=li#3 → 水平到 li#3
 *    ⑦   li#3          → "3"                   回调:unmount(li#3)
 *    ⑧   "3"           null    null
 *                       └─向上: return=li#3, li#3.sibling=null
 *                         └─再向上: return=Fragment, Fragment.return=ul=root
 *                           └─回到 root → 结束
 *
 * @param root 子树的根 fiber（childToDelete）
 * @param onCommitUnmount 对每个 fiber 执行的回调
 */
function commitNestedComponent(
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) {
	let node = root;
	while (true) {
		onCommitUnmount(node);
		// 向下钻：只要有 child 就继续深入
		if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		// 回到根节点 → 遍历完成
		if (node === root) {
			return;
		}
		// 无 sibling → 向上回溯
		while (node.sibling === null) {
			if (node.return === null || node.return === root) return;
			node = node.return;
		}
		// 有 sibling → 水平移动
		node.sibling.return = node.return;
		node = node.sibling;
	}
}

/**
 * 执行 Placement 副作用：把 finishedWork 子树对应的真实 DOM 插入/移动到正确位置。
 *
 * 执行流程：
 * 1. getHostParent(finishedWork) → 向上找到最近的 Host 祖先对应的真实 DOM 容器
 * 2. getHostSibling(finishedWork) → 向右/向上找到当前 DOM 应插入到哪个兄弟节点之前
 * 3. insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling)
 *    - sibling 存在 → insertBefore
 *    - sibling 为 null → appendChild
 *
 * 具体举例：
 *   <ul>
 *     <li key="1">1</li>
 *     <li key="2">2</li>
 *     <li key="3">3</li>
 *   </ul>
 *   经过 diff 后 li#2 需要移动到末尾：
 *     旧 fiber 顺序：li#1 → li#2 → li#3
 *     新 fiber 顺序：li#1 → li#3 → li#2
 *     li#2.flags 被标记 Placement
 *
 *   fiber 树关键路径：
 *     HostRoot (stateNode = FiberRootNode)
 *       └── ul (HostComponent, stateNode = <ul>)
 *             ├── li#1 (stateNode = <li>1</li>, flags = NoFlags)
 *             ├── li#3 (stateNode = <li>3</li>, flags = NoFlags)
 *             └── li#2 (stateNode = <li>2</li>, flags = Placement) ← finishedWork
 *
 *   逐步骤推演：
 *   ① getHostParent(li#2)
 *      li#2.return = ul (HostComponent) → 返回 <ul>
 *
 *   ② getHostSibling(li#2)
 *      li#2.sibling = null → 向上找 parent
 *      ul 是 HostComponent 且无 sibling → 返回 null（即插入到末尾）
 *
 *   ③ insertOrAppendPlacementNodeIntoContainer(li#2, <ul>, null)
 *      li#2 是 HostComponent，before = null → appendChild(<ul>, <li>2</li>)
 *      浏览器自动处理：<li>2</li> 从原位置移除并追加到 <ul> 末尾
 *
 *   最终 DOM 效果：
 *     执行前：<ul><li>1</li><li>2</li><li>3</li></ul>
 *     执行后：<ul><li>1</li><li>3</li><li>2</li></ul> ✅
 *
 * 结论：
 *   无论是 mount（首次插入）还是 update（位置移动），只要 fiber 被打了 Placement 标记，
 *   这里都会统一走"先找父 DOM，再找参考兄弟，最后 insert/append"的同一套路径。
 *   通过 getHostSibling 找到正确参考点，保证了 DOM 顺序与 fiber 树顺序一致。
 *
 * @param finishedWork 带有 Placement 标记的 fiber
 */
const commitPlacement = (finishedWork: FiberNode) => {
	// 	这里我们就需要找到 它的父级的dom节点 以及 它本身的dom节点
	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// parent DOM
	const hostParent = getHostParent(finishedWork);

	// host sibling
	const sibling = getHostSibling(finishedWork);

	// finishedWork ~~ DOM append parent DOM
	if (hostParent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

/**
 * 查找 finishedWork 对应的真实 DOM 应该插入到哪个兄弟 DOM 节点之前。
 *
 * 由于 fiber 树中存在 FunctionComponent / Fragment 等非 DOM 节点，
 * fiber 的 sibling 不一定是真实 DOM，因此需要跨 fiber 层级做"向右 + 向上 + 向下"三维查找。
 *
 * 执行流程：
 * 1. 向右：当前 fiber 有 sibling → 跳到 sibling，进入步骤 3
 * 2. 向上：当前 fiber 无 sibling → 沿 return 链向上，直到找到有 sibling 的祖先；
 *    若一路上遇到 HostComponent / HostRoot 仍无 sibling → 返回 null（说明要插到末尾）
 * 3. 向下：找到 sibling 后，若它不是 HostComponent / HostText，
 *    沿 child 链向下钻，直到遇到第一个 HostComponent / HostText
 * 4. 命中检查：候选节点若自身也带 Placement（它也要被插入，还不是稳定参考点）
 *    → continue findSibling，回到步骤 1 找下一个候选
 * 5. 找到无 Placement 标记的 Host 节点 → 返回它的 stateNode
 *
 * 具体举例：
 *   JSX 结构：
 *     App 函数组件返回一个数组：
 *       [<div>A</div>, <Child />, <div>C</div>]
 *     Child 函数组件返回 <span>B</span>
 *
 *   fiber 树：
 *     App (tag=0)
 *       ├── divA (tag=5, stateNode = <div>A</div>)
 *       ├── Child (tag=0)
 *       │     └── spanB (tag=5, stateNode = <span>B</span>)
 *       └── divC (tag=5, stateNode = <div>C</div>)
 *
 *   场景 ①：divA 是 Placement，求它的 host sibling
 *     ① divA.sibling = Child → node = Child
 *     ② Child 不是 HostText/HostComponent → 进入向下循环
 *     ③ Child.child = spanB → node = spanB
 *     ④ spanB 是 HostComponent，且 flags 无 Placement → return <span>B</span>
 *     ✅ 结果：insertBefore(<div>A</div>, parent, <span>B</span>)
 *
 *   场景 ②：spanB 是 Placement，求它的 host sibling
 *     ① spanB.sibling = null → 向上 node = Child
 *     ② Child.sibling = divC → node = divC
 *     ③ divC 是 HostComponent，无 Placement → return <div>C</div>
 *     ✅ 结果：insertBefore(<span>B</span>, parent, <div>C</div>)
 *
 *   场景 ③：divC 是 Placement，求它的 host sibling
 *     ① divC.sibling = null → 向上 node = App
 *     ② App.sibling = null → 向上 node = App.return = HostRoot
 *     ③ HostRoot.tag === HostRoot → return null
 *     ✅ 结果：appendChild(parent, <div>C</div>)，插到末尾
 *
 * 结论：
 *   getHostSibling 的核心难点是"fiber 树的 sibling 顺序 ≠ DOM 树的兄弟顺序"。
 *   它把"向右看兄弟、向上找有兄弟的祖先、向下钻到第一个真实 DOM"三步合一，
 *   并通过 continue findSibling 跳过那些同样带 Placement 的不稳定节点，
 *   保证返回的参考节点在当前 commit 阶段是真实、稳定的。
 *
 * @param fiber 带有 Placement 标记的 fiber
 * @returns 目标兄弟 DOM 节点（应插入到它之前），或 null（插入到父节点末尾）
 */
function getHostSibling(fiber: FiberNode) {
	let node: FiberNode = fiber;

	findSibling: while (true) {
		while (node.sibling === null) {
			const parent = node.return;

			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null;
			}
			// 向上遍历
			node = parent;
		}
		node.sibling.return = node.return;
		node = node.sibling;

		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 向下遍历
			if ((node.flags & Placement) !== NoFlags) {
				continue findSibling;
			}
			if (node.child === null) {
				continue findSibling;
			} else {
				node.child.return = node;
				node = node.child;
			}
		}

		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode;
		}
	}
}

/**
 * 向上查找 fiber 链中最近的 DOM 祖先节点。
 *
 * 由于 fiber 树中存在非 DOM 类型的节点（Fragment / FunctionComponent），
 * 一个 fiber 的 return 链上可能有若干层非 DOM 节点，需要跳过它们，
 * 找到最近的 HostComponent（其 stateNode 就是真实 DOM）或 HostRoot。
 *
 * ─── 场景 A：commitDeletion 中 childToDelete = Fragment ────────
 * fiber 树：
 *   ul (HostComponent, stateNode = <ul>)
 *     └── Fragment (tag=7)  ← getHostParent 起点
 *           ├── li#1
 *           └── li#2
 *
 * 向上查找：
 *   Fragment.return = ul (HostComponent) → 直接返回 ul.stateNode = <ul>
 *
 * ─── 场景 B：commitDeletion 中 childToDelete = FunctionComponent ──
 * fiber 树：
 *   div (HostComponent, stateNode = <div>)
 *     └── Child (FunctionComponent)  ← getHostParent 起点
 *           └── span (HostText, stateNode = <span>text</span>)
 *
 * 向上查找：
 *   Child.return = div (HostComponent) → 返回 div.stateNode = <div>
 *
 * ─── 场景 C：commitPlacement 中 finishedWork = FunctionComponent ──
 * <div id="root">
 *   <App />  ← 要 placement，但其 fiber 无对应 DOM
 * </div>
 *
 * fiber 树：
 *   HostRoot (stateNode = FiberRootNode)
 *     └── App (FunctionComponent)  ← getHostParent 起点
 *           └── span
 *
 * 向上查找：
 *   App.return = HostRoot → HostRoot.stateNode = FiberRootNode
 *   返回 FiberRootNode.container = <div id="root">
 *
 * @param fiberNode 任意 fiber（HostComponent / HostText / Fragment / FunctionComponent 均可）
 * @returns 最近的 DOM 祖先节点，或 null（异常情况）
 */
const getHostParent = (fiberNode: FiberNode): Container | null => {
	let parent = fiberNode.return;

	while (parent !== null) {
		const parentTag = parent.tag;
		// 是HostComponent类型的节点（就是原生dom对应的fiberNode）他的stateNode指向 真实dom
		if (parentTag === HostComponent) {
			//
			return parent.stateNode;
		}
		// 虚拟根节点
		if (parentTag === HostRoot) {
			// 	他就需要向上找到根管理器上的container才是真的dom节点了
			return (parent.stateNode as FiberRootNode).container;
		}
		parent = parent.return;
	}
	if (__DEV__) {
		console.warn('未找到host 的父节点dom');
	}
	return null;
};

/**
 * 将被标记 Placement 的 fiber 对应的 DOM 节点插入/追加到 hostParent 中。
 *
 * 分两种情况处理：
 *
 * ─── 情况 A：finishedWork 本身是 HostComponent / HostText ─────
 *      它有 stateNode（真实 DOM），且 completeWork 中的 appendAllChildren
 *      已将子树的所有 DOM 都挂载到它的 stateNode 下。所以直接插入这一个 DOM：
 *        - 有 before → insertBefore
 *        - 无 before → appendChild
 *      插入完毕后 return，不递归子树。
 *
 * ─── 情况 B：finishedWork 是非 DOM 类型（FunctionComponent / Fragment）─
 *      它没有 stateNode，DOM 节点在 child 子树的各个 Host 节点上。
 *      需要递归遍历 child 子树，找到所有直属的 Host 节点逐个插入。
 *
 *      举例：<App><li>1</li><li>2</li><li>3</li></App>
 *
 *      fiber 树：
 *        App (FunctionComponent) ← finishedWork
 *          └── Fragment (tag=7)
 *                ├── li#1 (HostComponent, stateNode = <li>1</li>)
 *                ├── li#2 (HostComponent, stateNode = <li>2</li>)
 *                └── li#3 (HostComponent, stateNode = <li>3</li>)
 *
 *      ① insertOrAppend(App, hostParent)
 *         App 不是 DOM 类型 → 取 child = Fragment
 *      ② insertOrAppend(Fragment, hostParent)
 *         Fragment 不是 DOM 类型 → 取 child = li#1
 *      ③ insertOrAppend(li#1, hostParent)
 *         li#1 是 HostComponent → appendChild(<li>1</li>, hostParent)  ✅
 *      ④ 回到 ② 的 sibling 循环 → li#2
 *      ⑤ insertOrAppend(li#2, hostParent)
 *         li#2 是 HostComponent → appendChild(<li>2</li>, hostParent)  ✅
 *      ⑥ 回到 ② 的 sibling 循环 → li#3
 *      ⑦ insertOrAppend(li#3, hostParent)
 *         li#3 是 HostComponent → appendChild(<li>3</li>, hostParent)  ✅
 *
 *      效果：三个 <li> 被依次追加到 hostParent 下。
 *
 *      注意：非 DOM 类型的递归路径中不传递 before 参数，
 *      因为外部调用（commitPlacement）拿到的 before 是相对于
 *      finishedWork 这一个 fiber 的同级参考节点。递归到内部之后，
 *      相对顺序由 completeWork 的 DOM 组装 + 最终的 append 顺序保证。
 *
 * @param finishedWork 当前正在处理的 fiber（带 Placement 标记）
 * @param hostParent 目标父 DOM 节点
 * @param before 可选的兄弟 DOM 引用节点，仅当 finishedWork 为 Host 时传入
 */
function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (before) {
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}
		return;
	}
	// 非 DOM 类型 fiber，递归向下找实际的 DOM 节点
	const child = finishedWork.child;
	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;
		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
}
