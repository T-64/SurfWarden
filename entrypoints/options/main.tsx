import { createRoot } from 'react-dom/client';
import { OptionsApp } from './OptionsApp';
import '../../src/shared/theme.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<OptionsApp />);
