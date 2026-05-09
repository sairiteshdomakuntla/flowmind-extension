import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('FlowMind: #root not found');

createRoot(container).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
