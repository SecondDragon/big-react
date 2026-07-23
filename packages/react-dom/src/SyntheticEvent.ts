import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_runWithPriority,
	unstable_UserBlockingPriority
} from 'scheduler';
import { Props } from 'shared/ReactTypes';

export const elementPropsKey = '__props';
const validEventTypeList = ['click'];

type EventCallback = (e: Event) => void;

interface SyntheticEvent extends Event {
	__stopPropagation: boolean;
}

interface Paths {
	capture: EventCallback[];
	bubble: EventCallback[];
}

export interface DOMElement extends Element {
	[elementPropsKey]: Props;
}

/**
 * 将 React 组件的 props 存储到 DOM 元素的 `__props` 属性上，
 * 作为 fiber 树与真实 DOM 之间的数据桥梁。
 *
 * 执行流程：
 *   直接在 DOM 元素上设置 [elementPropsKey] = props。
 *
 * 举例：
 *   JSX <div onClick={handler} className="box" />
 *   → createInstance('div', { onClick: handler, className: 'box' })
 *     → updateFiberProps(div, { onClick: handler, className: 'box' })
 *   → div.__props = { onClick: handler, className: 'box' }
 *
 * 推演：
 *   ① mount 阶段：createInstance 创建 DOM 元素时调用，写入初始 props。
 *   ② update 阶段：commitUpdate 检测 HostComponent 变化时调用，更新 props。
 *   ③ 事件阶段：collectPaths 读取 element.__props 获取 onClickCapture / onClick。
 *
 * 结论：
 *   实现 React 合成事件系统的基石 —— 让真实 DOM 元素能够携带 React 事件回调，
 *   使得 native addEventListener 触发时可以通过 DOM 回溯收集到沿途的回调。
 */
export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

/**
 * 在容器上注册原生 DOM 事件监听，作为 React 合成事件系统的入口。
 * 每个事件类型在容器上只注册一次原生监听，后续所有事件分发由 dispatchEvent 统一处理。
 *
 * 执行流程：
 *   校验 eventType 是否在 validEventTypeList 中 →
 *   开发环境打印日志 → addEventListener 注册原生监听 → 回调中调用 dispatchEvent。
 *
 * 举例：
 *   用户代码调用 initEvent(rootContainer, 'click')
 *   → rootContainer.addEventListener('click', (e) => {
 *         dispatchEvent(rootContainer, 'click', e)
 *     })
 *
 * 推演：
 *   ① 当前仅 validEventTypeList = ['click']，其他事件类型会 warn 并直接返回。
 *   ② addEventListener 是原生 API，注册后容器上的每个 click 都会触发 dispatchEvent。
 *   ③ dispatchEvent 内完成：收集路径 → 构造合成事件 → 捕获阶段 → 冒泡阶段。
 *
 * 结论：
 *   将原生 DOM 事件"桥接"进 React 合成事件体系，实现一次注册、统一分发的
 *   事件委托模式（event delegation）。未来扩展其他事件只需往 validEventTypeList 追加即可。
 */
export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
		return;
	}
	if (__DEV__) {
		console.log('初始化事件：', eventType);
	}
	container.addEventListener(eventType, (e) => {
		dispatchEvent(container, eventType, e);
	});
}

/**
 * 基于原生 DOM 事件构造 React 合成事件（SyntheticEvent）对象。
 * 在原生 Event 上扩展 __stopPropagation 标记位，并劫持 stopPropagation 方法，
 * 使 React 能够在自己的事件传播流程中独立控制传播终止。
 *
 * 执行流程：
 *   类型断言 e → SyntheticEvent → 初始化 __stopPropagation = false →
 *   保存原生 stopPropagation → 替换为同时设置 __stopPropagation = true 的劫持版本 →
 *   返回合成事件。
 *
 * 举例 — 用户点击 li 触发 click 事件：
 *   原生 click e（无 __stopPropagation，stopPropagation 为原生方法）
 *   → createSyntheticEvent(e)
 *   → se.__stopPropagation = false
 *      se.stopPropagation()  // 劫持版：既调原生 stopPropagation，又置 se.__stopPropagation = true
 *
 * 推演：
 *   ① 原生 e 被转型为 SyntheticEvent，新增 __stopPropagation 字段。
 *   ② originStopPropagation 暂存原生方法，避免丢失浏览器行为。
 *   ③ 劫持后的 se.stopPropagation() 同时完成两件事：
 *        a. 阻止原生 DOM 事件继续传播（调用 originStopPropagation）
 *        b. 标记 React 内部传播应终止（__stopPropagation = true）
 *   ④ triggerEventFlow 遍历时通过检查 se.__stopPropagation 决定是否 break。
 *
 * 结论：
 *   在原生事件模型之上构建了 React 自己的传播控制机制，
 *   使得 stopPropagation 在合成事件体系中依然能阻断捕获/冒泡阶段的剩余回调。
 */
function createSyntheticEvent(e: Event) {
	const syntheticEvent = e as SyntheticEvent;
	syntheticEvent.__stopPropagation = false;
	const originStopPropagation = e.stopPropagation;

	syntheticEvent.stopPropagation = () => {
		syntheticEvent.__stopPropagation = true;
		if (originStopPropagation) {
			originStopPropagation();
		}
	};
	return syntheticEvent;
}

/**
 * React 合成事件系统的总调度函数。
 * 原生事件触发后，依次完成：收集路径 → 构造合成事件 → 捕获阶段 → 冒泡阶段。
 * 严格遵循 W3C 事件模型的三阶段顺序。
 *
 * 执行流程：
 *   targetElement 判空 → collectPaths 收集捕获/冒泡回调 →
 *   createSyntheticEvent 构造合成事件 → triggerEventFlow(capture) 先执行捕获 →
 *   检查 __stopPropagation → 未阻止则 triggerEventFlow(bubble) 再执行冒泡。
 *
 * 举例 — 点击嵌套结构 <ul><li onClick={fn}>点我</li></ul>：
 *   eventType = 'click'，targetElement = li，container = root
 *
 * 推演：
 *   ① targetElement = li，不为 null，继续。
 *   ② collectPaths(li, root, 'click') 沿 DOM 树向上遍历：
 *        li 有 onClick → bubble = [li_onClick]，li 有 onClickCapture → capture = [li_onClickCapture]
 *        ul 有 onClick → bubble = [li_onClick, ul_onClick]，ul 有 onClickCapture → capture = [ul_onClickCapture, li_onClickCapture]
 *      返回 { capture: [ul_onClickCapture, li_onClickCapture], bubble: [li_onClick, ul_onClick] }
 *   ③ createSyntheticEvent(e) → se，__stopPropagation = false。
 *   ④ triggerEventFlow(capture, se) → 按外→内顺序执行 ul_onClickCapture → li_onClickCapture。
 *      若捕获阶段调用了 e.stopPropagation()，__stopPropagation = true。
 *   ⑤ 检查 se.__stopPropagation：
 *        a. false → triggerEventFlow(bubble, se)，按内→外顺序执行 li_onClick → ul_onClick
 *        b. true  → 跳过冒泡阶段，直接结束
 *
 * 结论：
 *   将原生 DOM 事件一次触发转化为完整的 React 合成事件分发管线，
 *   包括捕获、冒泡两个传播阶段，并支持 stopPropagation 在任意阶段终止后续传播。
 */
function dispatchEvent(container: Container, eventType: string, e: Event) {
	const targetElement = e.target;

	if (targetElement === null) {
		console.warn('事件不存在target', e);
		return;
	}

	const { bubble, capture } = collectPaths(
		targetElement as DOMElement,
		container,
		eventType
	);
	const se = createSyntheticEvent(e);

	triggerEventFlow(capture, se);

	if (!se.__stopPropagation) {
		triggerEventFlow(bubble, se);
	}
}

/**
 * 遍历事件回调路径数组，按事件类型对应的调度器优先级依次执行回调；
 * 若中途事件被阻止传播（__stopPropagation），则提前终止。
 *
 * 执行流程：
 *   for 循环遍历 paths → eventTypeToSchdulerPriority 映射优先级 →
 *   unstable_runWithPriority 包裹 callback 执行 → 检查 __stopPropagation。
 *
 * ── unstable_runWithPriority 原理 ──
 *
 *   该函数来自 scheduler 包，核心是优先级上下文切换。源码如下：
 *
 *   ```
 *   function unstable_runWithPriority(priorityLevel, eventHandler) {
 *     // ① 校验优先级，非法值回退 NormalPriority
 *     switch (priorityLevel) {
 *       case ImmediatePriority:
 *       case UserBlockingPriority:
 *       case NormalPriority:
 *       case LowPriority:
 *       case IdlePriority:
 *         break;
 *       default:
 *         priorityLevel = NormalPriority;
 *     }
 *
 *     // ② 暂存当前全局优先级，切换为新优先级
 *     var previousPriorityLevel = currentPriorityLevel;
 *     currentPriorityLevel = priorityLevel;
 *
 *     try {
 *       return eventHandler();  // ③ 在新优先级下执行回调
 *     } finally {
 *       currentPriorityLevel = previousPriorityLevel; // ④ 恢复旧优先级
 *     }
 *   }
 *   ```
 *
 *   意义：回调内部如果触发状态更新（scheduleCallback），会检查 currentPriorityLevel
 *   来决定任务的调度优先级。因此：
 *     - click 回调在 ImmediatePriority 下执行 → 回调内的 setState 以高优先级调度
 *     - scroll 回调在 UserBlockingPriority 下执行 → 回调内的 setState 以中优先级调度
 *     - 其他事件在 NormalPriority 下执行 → 普通优先级调度
 *
 *   注意 finally 保证了无论回调是否抛异常，都会恢复旧的优先级，不会污染后续回调。
 *
 * ── 完整推演 ──
 *
 * 举例 — 冒泡阶段 paths = [li_onClick, ul_onClick, document_onClick]：
 *   se.type = 'click'，se.__stopPropagation 初始为 false。
 *
 * 推演：
 *   ① i=0, callback = li_onClick
 *      → eventTypeToSchdulerPriority('click') → ImmediatePriority
 *      → unstable_runWithPriority(ImmediatePriority, li_onClick)
 *          暂存 currentPriorityLevel → 切换为 ImmediatePriority
 *          → 执行 li_onClick(se)
 *              （回调内部的 setState 将以 ImmediatePriority 调度）
 *          → 恢复 currentPriorityLevel
 *      → 假设 onClick 未调 e.stopPropagation() → __stopPropagation 仍为 false → 继续
 *   ② i=1, callback = ul_onClick
 *      → 同样以 ImmediatePriority 执行 ul_onClick(se)
 *      → 假设 onClick 内部调了 e.stopPropagation() → __stopPropagation = true → break
 *   ③ document_onClick 不再执行
 *
 * 结论：
 *   实现了 React 合成事件的捕获/冒泡传播机制 —— 沿收集到的路径依次触发回调，
 *   支持 e.stopPropagation() 阻断后续传播，同时离散事件（click 等）以高优先级调度执行，
 *   确保用户交互的响应性优于普通更新。
 */
function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];
		unstable_runWithPriority(eventTypeToSchdulerPriority(se.type), () => {
			callback.call(null, se);
		});

		if (se.__stopPropagation) {
			break;
		}
	}
}

/**
 * 将原生 DOM 事件类型映射为 React 事件回调属性名。
 * 返回值是一个 [captureName, bubbleName] 元组，captureName 为捕获阶段属性名，
 * bubbleName 为冒泡阶段属性名。
 *
 * 执行流程：
 *   查表映射 eventType → [captureName, bubbleName]。
 *
 * 举例：
 *   eventType = 'click'
 *   → { click: ['onClickCapture', 'onClick'] }['click']
 *   → ['onClickCapture', 'onClick']
 *
 * 推演：
 *   ① 目前仅映射 click 一个事件类型，未映射的 eventType 返回 undefined。
 *   ② collectPaths 用返回值遍历 [captureName, bubbleName]，
 *      从 element.__props 中读取对应的回调函数：
 *        i=0 → callbackName = 'onClickCapture' → element.__props.onClickCapture
 *        i=1 → callbackName = 'onClick'      → element.__props.onClick
 *   ③ 未来支持更多事件（如 input、mouseenter 等）时，
 *      只需在此映射表中追加对应条目即可。
 *
 * 结论：
 *   React 合成事件命名规则的查找表，将原生事件名（click）转换为
 *   React JSX 属性名（onClick / onClickCapture），是 JSX → DOM 协议的一部分。
 */
function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

/**
 * 从 targetElement 沿 DOM 树向上遍历到 container，收集路径上所有元素的
 * 捕获（capture）和冒泡（bubble）阶段回调，保证 W3C 事件模型的三阶段顺序。
 *
 * 执行流程：
 *   while 循环向上遍历（targetElement → parentNode） →
 *   读 element.__props → getEventCallbackNameFromEventType 查表 →
 *   capture 用 unshift 反向插入（外→内顺序）→ bubble 用 push 正向追加（内→外顺序）→
 *   返回 { capture, bubble }。
 *
 * 举例 — DOM 结构 <ul onClickCapture={fn3} onClick={fn4}>
 *              <li onClickCapture={fn1} onClick={fn2}>点我</li>
 *          </ul>
 *   点击 li，targetElement = li，container = root，eventType = 'click'。
 *
 * 推演：
 *   ① 遍历 li (targetElement !== container):
 *        elementProps = li.__props = { onClickCapture: fn1, onClick: fn2 }
 *        callbackNameList = ['onClickCapture', 'onClick']
 *        i=0, callbackName = 'onClickCapture', eventCallback = fn1:
 *          → paths.capture.unshift(fn1) → capture = [fn1]
 *        i=1, callbackName = 'onClick', eventCallback = fn2:
 *          → paths.bubble.push(fn2)     → bubble  = [fn2]
 *        targetElement = li.parentNode = ul
 *   ② 遍历 ul (ul !== container):
 *        elementProps = ul.__props = { onClickCapture: fn3, onClick: fn4 }
 *        i=0, callbackName = 'onClickCapture', eventCallback = fn3:
 *          → paths.capture.unshift(fn3) → capture = [fn3, fn1]  （fn3 插入前端，外→内）
 *        i=1, callbackName = 'onClick', eventCallback = fn4:
 *          → paths.bubble.push(fn4)     → bubble  = [fn2, fn4]  （fn4 追加末尾，内→外）
 *        targetElement = ul.parentNode = container → while 终止
 *   ③ 返回: { capture: [fn3(u), fn1(li)], bubble: [fn2(li), fn4(ul)] }
 *
 * 结论：
 *   正确实现 W3C 事件模型的路径收集 —— capture 数组从根到 targetElement 排列（外→内），
 *   bubble 数组从 targetElement 到根排列（内→外），为 dispatchEvent 的捕获/冒泡遍历做好准备。
 */
function collectPaths(
	targetElement: DOMElement,
	container: Container,
	eventType: string
) {
	const paths: Paths = {
		capture: [],
		bubble: []
	};

	while (targetElement && targetElement !== container) {
		const elementProps = targetElement[elementPropsKey];
		if (elementProps) {
			const callbackNameList = getEventCallbackNameFromEventType(eventType);
			if (callbackNameList) {
				callbackNameList.forEach((callbackName, i) => {
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
						if (i === 0) {
							// capture 反向插入，保证从外到内的顺序
							paths.capture.unshift(eventCallback);
						} else {
							// bubble 正向追加，保证从内到外的顺序
							paths.bubble.push(eventCallback);
						}
					}
				});
			}
		}
		targetElement = targetElement.parentNode as DOMElement;
	}
	return paths;
}

/**
 * 将 DOM 事件类型映射为调度器（Scheduler）优先级，确保不同事件对应的回调以合适的优先级执行。
 *
 * 执行流程：
 *   switch 匹配 eventType，返回对应的 unstable_* 优先级常量。
 *
 * 举例 — 三个典型事件：
 *   click    → unstable_ImmediatePriority    （离散事件，立即响应）
 *   scroll   → unstable_UserBlockingPriority  （用户阻塞事件）
 *   load     → unstable_NormalPriority         （默认普通优先级）
 *
 * 推演：
 *   ① eventType = 'click'
 *      → 命中 case 'click' → 返回 unstable_ImmediatePriority
 *   ② eventType = 'scroll'
 *      → 命中 case 'scroll' → 返回 unstable_UserBlockingPriority
 *   ③ eventType = 'load'
 *      → 不命中任何 case → 走 default → 返回 unstable_NormalPriority
 *
 * 结论：
 *   调用方（triggerEventFlow）通过 unstable_runWithPriority 以映射出的优先级执行事件回调，
 *   保证离散事件（点击、按键）优先响应，滚动次之，其余事件按普通优先级处理。
 */
function eventTypeToSchdulerPriority(eventType: string) {
	switch (eventType) {
		case 'click':
		case 'keydown':
		case 'keyup':
			return unstable_ImmediatePriority;
		case 'scroll':
			return unstable_UserBlockingPriority;
		default:
			return unstable_NormalPriority;
	}
}

/**
 * ═══════════════════════════════════════════════════════════════
 *   本文件 vs 官方 React — 合成事件传播路径的差异
 * ═══════════════════════════════════════════════════════════════
 *
 * ── 当前实现（简化版）──
 *
 *   collectPaths 通过 targetElement.parentNode 沿 DOM 树向上遍历。
 *   这意味着事件传播路径 = DOM 树结构。
 *
 *   ```
 *   while (targetElement && targetElement !== container) {
 *       read targetElement.__props  // 读回调
 *       targetElement = targetElement.parentNode as DOMElement;
 *   }
 *   ```
 *
 * ── 官方 React 实现 ──
 *
 *   官方 React 沿 **Fiber 树（组件树）**传播，而不是 DOM 树。
 *   核心代码如下（简化自 react-dom/src/events/plugins/SimpleEventPlugin.js）：
 *
 *   ```
 *   function accumulateSinglePhaseListeners(
 *     targetFiber: Fiber,
 *     reactName: string | null,
 *     bubble: boolean
 *   ): Array<DispatchListener> {
 *     const captureName = bubble ? null : reactName;
 *     const bubbleName = bubble ? reactName : null;
 *     const listeners: Array<DispatchListener> = [];
 *     let instance: Fiber | null = targetFiber;
 *
 *     // ★ 沿 fiber.return 向上，而非 parentNode ★
 *     while (instance !== null) {
 *       const {tag, stateNode} = instance;
 *       // 只有 HostComponent 的 stateNode 才有 DOM 节点
 *       if (tag === HostComponent && stateNode !== null) {
 *         const lastHostNode = bubble ? stateNode : null;
 *         const listener = getListener(instance, bubbleName);
 *         if (listener != null) {
 *           listeners.push(
 *             createDispatchListener(instance, listener, lastHostNode)
 *           );
 *         }
 *       }
 *       instance = instance.return;  // ← 关键：沿 Fiber 树上行
 *     }
 *     return listeners;
 *   }
 *   ```
 *
 * ── Portal 场景证明 ──
 *
 *   假设组件结构和 DOM 结构分离（createPortal）：
 *
 *   React 组件树:                   真实 DOM 树:
 *   ┌─────────────────────┐        ┌──────────────────────────┐
 *   │ <App>                │        │ <body>                   │
 *   │   <div onClick=fnA>  │        │   <div id="root">        │
 *   │     <Child>          │        │     <div>...</div>       │
 *   │                      │        │   </div>                 │
 *   │         <Portal>     │        │                          │
 *   │           <button    │        │   <div id="portal">      │
 *   │            onClick=fnB│ />    │     <button>点我</button> │
 *   │         </Portal>    │        │   </div>                 │
 *   │      </Child>        │        │ </body>                  │
 *   │   </div>             │        └──────────────────────────┘
 *   │ </App>               │
 *   └─────────────────────┘
 *        fiber.return 指向:        parentNode 指向:
 *        button → Portal → Child   button → #portal → body → html
 *                 → div → App
 *
 *   点击 button 时：
 *   ┌──────────────────────┬───────────────────────────────────┐
 *   │ 当前本地实现（DOM 树） │ 官方 React（Fiber 树）            │
 *   ├──────────────────────┼───────────────────────────────────┤
 *   │ 冒泡路径:            │ 冒泡路径:                         │
 *   │  button              │  button.fiber → Portal.fiber       │
 *   │  → #portal           │    → Child.fiber                  │
 *   │  → body              │    → div.fiber  ← fnA 在这里触发! │
 *   │  → html              │    → App.fiber                    │
 *   │                      │                                   │
 *   │ fnA **不会**被触发    │ fnA **会**被触发                  │
 *   │ （div 不在 DOM 路径上）│ （div 在 Fiber 路径上）           │
 *   └──────────────────────┴───────────────────────────────────┘
 *
 * ── 为什么本地实现用 DOM 树？──
 *
 *   本项目的目标是学习 React 核心机制，当前状态未实现 Portal，
 *   且 fiber 树与 DOM 树完全对应。在此前提下，
 *   parentNode 遍历等价于 fiber.return 遍历，两者路径一致。
 *   用 parentNode 实现更直观、代码量更少，适合教学目的。
 *
 *   后续若引入 Portal 功能，collectPaths 应从 DOM 遍历
 *   迁移到 Fiber 遍历（沿 fiber.return 收集），以正确处理
 *   DOM 树与组件树分离的场景。
 */
