// 调试专用配置：让 react / react-dom 解析到 dist 产物（当前源码的构建结果），
// 避免 pnpm workspace 软链把 react 解析回 packages 里的 TS 源码。
const base = require('./jest.config.js');

module.exports = {
	...base,
	moduleNameMapper: {
		'^scheduler$': '<rootDir>/node_modules/scheduler/unstable_mock.js',
		'^react$': '<rootDir>/dist/node_modules/react/index.js',
		'^react-dom$': '<rootDir>/dist/node_modules/react-dom/index.js'
	}
};
