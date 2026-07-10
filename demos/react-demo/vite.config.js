import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const distNodeModules = path.resolve(__dirname, '../../dist/node_modules');

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			react: path.resolve(distNodeModules, 'react'),
			'react-dom': path.resolve(distNodeModules, 'react-dom')
		}
	},
	server: {
		port: 7000,
		strictPort: false, // 端口被占用时自动累加
		allowedHosts: true // 设为 true 表示允许任何 Host 域名访问
	}
});
