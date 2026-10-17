// Public mobile app entry (index.html).
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './app/App.jsx';

createRoot(document.getElementById('root')).render(<App />);
