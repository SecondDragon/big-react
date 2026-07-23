/**
 * 节流函数
 * 在连续高频触发时，保证每隔 delay 毫秒至少执行一次
 *
 * @param {Function} fn    要执行的函数
 * @param {number}   delay 时间间隔（毫秒）
 * @param {boolean}  leading  是否在首次触发时立即执行（可选，默认 true）
 * @returns {Function} 节流处理后的函数
 */
function throttle(fn, delay, leading = true) {
    let timer = null;
    let lastExec = 0; // 上次执行的时间戳

    return function (...args) {
        const context = this;
        const now = Date.now();

        // leading === false 且从未执行过时，把 lastExec 设为当前时间，
        // 让剩余时间 = delay，从而不会立即执行
        if (!leading && lastExec === 0) {
            lastExec = now;
        }

        const remaining = delay - (now - lastExec);

        if (remaining <= 0) {
            // 剩余时间 ≤ 0，立即执行
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            fn.apply(context, args);
            lastExec = now;
        } else if (!timer) {
            // 距离下次执行还有剩余时间，设置定时器
            timer = setTimeout(() => {
                fn.apply(context, args);
                lastExec = Date.now();
                timer = null;
            }, remaining);
        }
    };
}

// ---------- 使用示例 ----------
// const log = throttle((msg) => console.log(msg), 300);
// setInterval(() => log('hello'), 100); // 每 300ms 输出一次，而不是每 100ms
