/**
 * 调试测试（可删除）：验证"一次点击 + onClick 内 3 次 setNum"的真实行为。
 *
 * 统计四类信号：
 *   1. onClick 回调执行次数（判断事件系统是否重复触发）
 *   2. "在微任务中调度" 日志条数（= setNum 调用次数 = 调度请求次数）
 *   3. "render阶段开始" / "commit阶段开始" 日志条数（= 真实 render 次数）
 *   4. App 组件渲染的 num 值序列（判断 update 是否在同一次 render 中合并消费）
 */
const React = require('react');
const ReactDOM = require('react-dom');
const { useState } = React;

// 让微任务队列（queueMicrotask 里排队的 flushSyncCallbacks）执行完
async function flushScheduler() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

describe('click once with 3 setNum calls', () => {
	it('batches 3 updates into exactly 1 render', async () => {
		const counts = {
			clickHandler: 0,
			schedule: 0,
			render: 0,
			commit: 0,
			nums: []
		};

		const originalLog = console.log;
		const originalWarn = console.warn;
		const originalError = console.error;
		const allMessages = [];
		console.log = (...args) => {
			allMessages.push(['log', String(args[0])]);
			if (typeof args[0] === 'string' && args[0].includes('在微任务中调度')) {
				counts.schedule++;
			}
		};
		console.warn = (...args) => {
			allMessages.push(['warn', String(args[0])]);
			if (typeof args[0] === 'string') {
				if (args[0].includes('render阶段开始')) counts.render++;
				if (args[0].includes('commit阶段开始')) counts.commit++;
			}
		};
		console.error = (...args) => {
			allMessages.push(['error', String(args[0])]);
		};

		function App() {
			const [num, setNum] = useState(100);
			const arr =
				num % 2 === 0
					? [
							<li key="1">1</li>,
							<li key="2">2</li>,
							<li key="3">3</li>
					  ]
					: [
							<li key="3">3</li>,
							<li key="2">2</li>,
							<li key="1">1</li>
					  ];
			counts.nums.push(num);
			return (
				<ul
					onClick={() => {
						counts.clickHandler++;
						setNum((_v) => _v + 1);
						setNum((_v) => _v + 1);
						setNum((_v) => _v + 1);
					}}
				>
					<>
						<li key="1">1</li>
						<li key="2">2</li>
					</>
					<li key="3">3</li>
					<li key="4">4</li>
					{arr}
				</ul>
			);
		}

		const container = document.createElement('div');
		document.body.appendChild(container);
		ReactDOM.createRoot(container).render(<App />);
		// mount 同样走微任务调度，先冲刷让首屏完成
		await flushScheduler();
		await flushScheduler();

		if (container.querySelectorAll('li').length === 0) {
			console.log = originalLog;
			console.warn = originalWarn;
			console.error = originalError;
			originalLog('[DEBUG] messages:', JSON.stringify(allMessages));
			originalLog('[DEBUG] innerHTML:', container.innerHTML);
			throw new Error('mount produced no li elements');
		}

		// 重置计数，只统计"点击之后"的部分
		counts.schedule = 0;
		counts.render = 0;
		counts.commit = 0;
		counts.nums = [];

		// 模拟用户点击一次 li（事件冒泡到 container，走合成事件系统）
		const thirdLi = container.querySelectorAll('li')[2];
		thirdLi.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flushScheduler();
		await flushScheduler();

		console.log = originalLog;
		console.warn = originalWarn;

		const domText = Array.from(container.querySelectorAll('li')).map((li) =>
			li.textContent
		);

		originalLog(
			'[RESULT]',
			JSON.stringify({
				clickHandler: counts.clickHandler,
				scheduleLogs: counts.schedule,
				renderTimes: counts.render,
				commitTimes: counts.commit,
				numSequence: counts.nums,
				domText
			})
		);

		expect(counts.clickHandler).toBe(1);
		expect(counts.schedule).toBe(3);
		expect(counts.render).toBe(1);
		expect(counts.commit).toBe(1);
		expect(counts.nums).toEqual([103]);
		expect(domText).toEqual(['1', '2', '3', '4', '3', '2', '1']);

		// 第二次点击：验证 update 队列已被清空，旧 update 不会被重复消费
		const liAgain = container.querySelectorAll('li')[2];
		liAgain.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flushScheduler();
		await flushScheduler();

		originalLog(
			'[RESULT-2]',
			JSON.stringify({
				clickHandler: counts.clickHandler,
				scheduleLogs: counts.schedule,
				renderTimes: counts.render,
				commitTimes: counts.commit,
				numSequence: counts.nums
			})
		);

		expect(counts.clickHandler).toBe(2);
		expect(counts.schedule).toBe(6);
		expect(counts.render).toBe(2);
		expect(counts.commit).toBe(2);
		expect(counts.nums).toEqual([103, 106]);
	});
});
