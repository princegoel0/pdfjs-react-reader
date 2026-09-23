import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Introduction } from './pages/Introduction';
import { Installation } from './pages/Installation';
import { Compatibility } from './pages/Compatibility';
import { Shell } from './pages/Shell';
import { Headless } from './pages/Headless';
import { Theming } from './pages/Theming';
import { Recipes } from './pages/Recipes';

interface DocPage {
  id: string;
  title: string;
  group: string;
  Component: ComponentType;
}

const PAGES: DocPage[] = [
  { id: 'introduction', title: 'Introduction', group: 'Getting started', Component: Introduction },
  { id: 'installation', title: 'Installation & worker', group: 'Getting started', Component: Installation },
  { id: 'compatibility', title: 'Versions & compatibility', group: 'Getting started', Component: Compatibility },
  { id: 'shell', title: 'The viewer shell', group: 'Using it', Component: Shell },
  { id: 'headless', title: 'Headless hooks', group: 'Using it', Component: Headless },
  { id: 'theming', title: 'Theming', group: 'Using it', Component: Theming },
  { id: 'recipes', title: 'Recipes', group: 'Using it', Component: Recipes },
];

function useHashRoute(): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || PAGES[0]!.id;
  const [id, setId] = useState(read);

  useEffect(() => {
    const onHashChange = () => setId(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return [
    id,
    (next: string) => {
      window.location.hash = `/${next}`;
    },
  ];
}

export function App() {
  const [id, navigate] = useHashRoute();
  const page = PAGES.find((entry) => entry.id === id) ?? PAGES[0]!;
  const { Component } = page;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  const groups = [...new Set(PAGES.map((entry) => entry.group))];

  return (
    <>
      <header className="doc-header">
        <span className="doc-logo">pdfjs-react-reader</span>
        <span className="doc-badge">v0.1.0</span>
        <nav className="doc-links" aria-label="Documentation sections">
          <a href="#/compatibility">Compatibility</a>
          <a href="#/shell">Shell</a>
          <a href="#/headless">Headless</a>
          <a href="#/theming">Theming</a>
          <a href="#/recipes">Recipes</a>
        </nav>
      </header>
      <div className="doc-layout">
        <nav className="doc-nav" aria-label="Pages">
          {groups.map((group) => (
            <div key={group}>
              <div className="doc-nav-group">{group}</div>
              {PAGES.filter((entry) => entry.group === group).map((entry) => (
                <a
                  key={entry.id}
                  href={`#/${entry.id}`}
                  aria-current={entry.id === page.id ? 'page' : undefined}
                  onClick={() => navigate(entry.id)}
                >
                  {entry.title}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <main className="doc-main">
          <article className="doc-page">
            <Component />
          </article>
        </main>
      </div>
    </>
  );
}
