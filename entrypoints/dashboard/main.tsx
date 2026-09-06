import { createRoot } from 'react-dom/client';
import { DashboardApp } from './DashboardApp';
import '../../src/shared/theme.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<DashboardApp />);
