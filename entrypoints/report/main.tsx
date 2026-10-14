import { createRoot } from 'react-dom/client';
import { ReportApp } from './ReportApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<ReportApp />);
