import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadWorkspace, KEY_STORAGE } from './lib/workspace';
import { installDesktopBridge } from './lib/desktop';
import './vendor/cds/cds-theme.css';
import './styles.css';

installDesktopBridge();
const workspace = await loadWorkspace();
let apiKey = '';
try { apiKey = window.clay ? await window.clay.loadSecret() : sessionStorage.getItem(KEY_STORAGE) || ''; } catch { /* Key can be entered again. */ }
document.documentElement.classList.toggle('dark', workspace.theme === 'dark');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App initialState={workspace} initialKey={apiKey} /></React.StrictMode>,
);
