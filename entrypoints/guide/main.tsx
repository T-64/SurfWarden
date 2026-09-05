import { createRoot } from 'react-dom/client';
import { GuideApp } from './GuideApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<GuideApp />);
