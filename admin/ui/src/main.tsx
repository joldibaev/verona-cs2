import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import './style.css'

createRoot(document.getElementById('app')!).render(
  <StrictMode><BrowserRouter><App/><Toaster theme="dark" position="bottom-right" richColors/></BrowserRouter></StrictMode>
)
