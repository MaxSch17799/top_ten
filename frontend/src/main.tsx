import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './party.css';
import './fishy.css';
import './wavelength.css';
import './uno.css';
import './deal.css';
import './flip7.css';
import './skyjo.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/service-worker.js')
      .catch(() => {
        /* ignore registration errors */
      });
  });
}
