// Admin portal entry (admin/index.html).
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import '../styles/admin.css';
import { AdminApp } from './AdminApp.jsx';

createRoot(document.getElementById('root')).render(<AdminApp />);
