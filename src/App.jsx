import React, { useEffect, useState } from 'react';
import { Cpu, Hammer, FlaskConical, BookOpen } from 'lucide-react';
import { CompilerStudio } from './components/studio/CompilerStudio';
import { AlgorithmLab } from './components/lab/AlgorithmLab';
import { LanguageReference } from './components/LanguageReference';

// Minimal hash routing: #/studio, #/lab/<topic>, #/reference. Keeps the back button and
// shareable links working without adding a router dependency.
function parseHash(hash) {
  const [, section = 'studio', topic = null] = hash.replace(/^#/, '').split('/');
  return { section: ['studio', 'lab', 'reference'].includes(section) ? section : 'studio', topic };
}

function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = (section, topic = null) => {
    window.location.hash = topic ? `/${section}/${topic}` : `/${section}`;
  };
  return [route, navigate];
}

const SECTIONS = [
  { id: 'studio', label: 'Compiler Studio', icon: Hammer },
  { id: 'lab', label: 'Algorithm Lab', icon: FlaskConical },
  { id: 'reference', label: 'Language Reference', icon: BookOpen },
];

export function App() {
  const [route, navigate] = useHashRoute();

  useEffect(() => {
    const names = { studio: 'Compiler Studio', lab: 'Algorithm Lab', reference: 'Language Reference' };
    document.title = `${names[route.section]} · Compiler Design Playground`;
  }, [route.section]);

  return (
    <div className="app-container">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="brand-title">
          <Cpu size={28} color="var(--accent-primary)" aria-hidden="true" />
          <div>
            Compiler Design Playground
            <div className="brand-subtitle">An interactive compiler engineering lab</div>
          </div>
        </div>
        <nav className="main-nav" aria-label="Main">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-btn ${route.section === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={route.section === id ? 'page' : undefined}>
              <Icon size={18} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        {route.section === 'studio' && <CompilerStudio />}
        {route.section === 'lab' && <AlgorithmLab topicId={route.topic} onNavigate={(t) => navigate('lab', t)} />}
        {route.section === 'reference' && <LanguageReference />}
      </main>
    </div>
  );
}

export default App;
