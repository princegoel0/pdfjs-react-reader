import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { Introduction } from './pages/Introduction';
import { Installation } from './pages/Installation';
import { Compatibility } from './pages/Compatibility';
import { Shell } from './pages/Shell';
import { Features } from './pages/Features';
import { Headless } from './pages/Headless';
import { Theming } from './pages/Theming';
import { Api } from './pages/Api';
import { Accessibility } from './pages/Accessibility';
import { Recipes } from './pages/Recipes';
import { version } from '../../package.json';

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
  { id: 'features', title: 'Features & tiers', group: 'Using it', Component: Features },
  { id: 'headless', title: 'Headless hooks', group: 'Using it', Component: Headless },
  { id: 'theming', title: 'Theming', group: 'Using it', Component: Theming },
  { id: 'recipes', title: 'Recipes', group: 'Using it', Component: Recipes },
  { id: 'accessibility', title: 'Accessibility & the pass', group: 'Using it', Component: Accessibility },
  { id: 'api', title: 'The API surface', group: 'Reference', Component: Api },
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

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pjsr-docs-theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });

  const [filterQuery, setFilterQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pjsr-docs-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsMobileMenuOpen(false);
  }, [id]);

  // Enhances standard pre/code blocks with floating one-click copy buttons
  useEffect(() => {
    const preElements = document.querySelectorAll('.doc-page pre');
    preElements.forEach((pre) => {
      if (pre.querySelector('.doc-copy-code-btn')) return;
      pre.classList.add('doc-code-block');
      const btn = document.createElement('button');
      btn.className = 'doc-copy-code-btn';
      btn.type = 'button';
      btn.title = 'Copy code snippet';
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
      btn.onclick = async () => {
        const text = (pre.querySelector('code') as HTMLElement | null)?.innerText || (pre as HTMLElement).innerText || pre.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span style="color:#10b981">Copied!</span>`;
          btn.classList.add('copied');
          setTimeout(() => {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
            btn.classList.remove('copied');
          }, 1800);
        } catch {
          // ignore clipboard errors in restricted contexts
        }
      };
      pre.appendChild(btn);
    });
  }, [id]);

  const filteredPages = useMemo(() => {
    if (!filterQuery.trim()) return PAGES;
    const q = filterQuery.toLowerCase();
    return PAGES.filter((p) => p.title.toLowerCase().includes(q) || p.group.toLowerCase().includes(q));
  }, [filterQuery]);

  const groups = useMemo(() => [...new Set(filteredPages.map((entry) => entry.group))], [filteredPages]);

  return (
    <div className="doc-app">
      <header className="doc-header">
        <div className="doc-header-left">
          <button
            type="button"
            className="doc-mobile-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen((open) => !open)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isMobileMenuOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          <a href="#/introduction" className="doc-brand" onClick={() => navigate('introduction')}>
            <div className="doc-logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className="doc-logo-text">pdfjs-react-reader</span>
          </a>

          <div className="doc-badge-pill" title="v1.0.0 Release Ready">
            <span className="doc-badge-dot" />
            <span>v{version}</span>
          </div>
        </div>

        <nav className="doc-top-nav" aria-label="Documentation sections">
          <a href="#/introduction" className={id === 'introduction' ? 'active' : ''}>Overview</a>
          <a href="#/compatibility" className={id === 'compatibility' ? 'active' : ''}>Compatibility</a>
          <a href="#/shell" className={id === 'shell' ? 'active' : ''}>Shell</a>
          <a href="#/features" className={id === 'features' ? 'active' : ''}>Features</a>
          <a href="#/headless" className={id === 'headless' ? 'active' : ''}>Headless</a>
          <a href="#/recipes" className={id === 'recipes' ? 'active' : ''}>Recipes</a>
          <a href="#/api" className={id === 'api' ? 'active' : ''}>API</a>
        </nav>

        <div className="doc-header-actions">
          <button
            type="button"
            className="doc-theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <a
            href="https://github.com/princegoel0/pdfjs-react-reader"
            target="_blank"
            rel="noreferrer"
            className="doc-icon-link"
            title="GitHub Repository"
            aria-label="GitHub Repository"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>

          <a
            href="https://www.npmjs.com/package/pdfjs-react-reader"
            target="_blank"
            rel="noreferrer"
            className="doc-icon-link"
            title="npm package"
            aria-label="npm package"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0H1.763zM5.13 5.323l13.837.019-.009 13.435h-3.484V8.75h-3.431v10.027H5.13V5.323z" />
            </svg>
          </a>
        </div>
      </header>

      <div className="doc-layout">
        {/* Backdrop for mobile drawer */}
        {isMobileMenuOpen && (
          <div
            className="doc-nav-backdrop"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside className={`doc-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
          <div className="doc-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search docs..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="doc-search-input"
              aria-label="Filter documentation pages"
            />
            {filterQuery && (
              <button
                type="button"
                className="doc-search-clear"
                onClick={() => setFilterQuery('')}
                aria-label="Clear filter"
              >
                ×
              </button>
            )}
          </div>

          <nav className="doc-nav" aria-label="Documentation navigation">
            {groups.length === 0 ? (
              <div className="doc-nav-empty">No matching pages found</div>
            ) : (
              groups.map((group) => (
                <div key={group} className="doc-nav-section">
                  <div className="doc-nav-group">{group}</div>
                  <div className="doc-nav-list">
                    {filteredPages
                      .filter((entry) => entry.group === group)
                      .map((entry) => {
                        const isActive = entry.id === page.id;
                        return (
                          <a
                            key={entry.id}
                            href={`#/${entry.id}`}
                            className={`doc-nav-item ${isActive ? 'active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => {
                              navigate(entry.id);
                              setIsMobileMenuOpen(false);
                            }}
                          >
                            <span className="doc-nav-indicator" />
                            <span className="doc-nav-label">{entry.title}</span>
                          </a>
                        );
                      })}
                  </div>
                </div>
              ))
            )}
          </nav>
        </aside>

        <main className="doc-main">
          <div className="doc-breadcrumbs">
            <span>{page.group}</span>
            <span className="doc-bc-sep">/</span>
            <span className="doc-bc-current">{page.title}</span>
          </div>

          <article className="doc-page">
            <Component />
          </article>
        </main>
      </div>
    </div>
  );
}
