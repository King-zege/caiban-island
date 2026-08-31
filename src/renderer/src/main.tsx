import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/shell.css';
import './styles/global.css';
import './styles/contracts.css';
import './styles/agent.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
