import ReactDOM from 'react-dom/client'
import '@fontsource/noto-sans-jp/400.css'
import '@fontsource/noto-sans-jp/500.css'
import '@fontsource/noto-sans-jp/600.css'
import '@fontsource/noto-sans-jp/700.css'
import '@fontsource/shippori-mincho/400.css'
import '@fontsource/shippori-mincho/700.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import App from './App'
import { initLang } from './i18n'
import './styles.css'

initLang()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
