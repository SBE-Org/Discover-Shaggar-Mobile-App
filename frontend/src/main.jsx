// Public mobile app entry (index.html).
import { createRoot } from 'react-dom/client';
import './lib/install.js'; // listen for the browser's install offer before anything else loads
import './styles/app.css';
import { App } from './app/App.jsx';

createRoot(document.getElementById('root')).render(<App />);
