import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	// GitHub Pages は /<repo>/ 配下に配置されるため base を合わせる
	base: '/sethera-piece/',
	plugins: [react()],
})
