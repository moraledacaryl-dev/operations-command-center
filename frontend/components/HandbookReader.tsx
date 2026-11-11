'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './HandbookReader.module.css';

type HandbookBlock = { type: 'paragraph'; text: string } |
  { type: 'bullets'; items: { text: string }[] };
type HandbookSection = {
  id: string; number: string; title: string; page: number;
  blocks: HandbookBlock[];
};
type HandbookChapter = {
  id: string; number: string; title: string; page: number;
  sections: HandbookSection[];
};
type Handbook = {
  schema: 'hidden-oasis-handbook/v1'; title: string; edition: string;
  source_pages: number; chapters: HandbookChapter[];
};
type Hit = { chapter: HandbookChapter; section: HandbookSection; preview: string };

function parse(body: string): Handbook | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object') return null;
    const doc = value as Handbook;
    if (doc.schema !== 'hidden-oasis-handbook/v1' || !Array.isArray(doc.chapters)) return null;
    if (!doc.chapters.every(ch => typeof ch.id === 'string' &&
      typeof ch.title === 'string' && Array.isArray(ch.sections) &&
      ch.sections.every(sec => typeof sec.id === 'string' &&
        typeof sec.title === 'string' && Array.isArray(sec.blocks)))) return null;
    return doc;
  } catch {
    return null;
  }
}

function contentText(section: HandbookSection) {
  return [section.number, section.title, ...section.blocks.flatMap(block =>
    block.type === 'paragraph' ? [block.text] :
      block.items.map(item => item.text))].join(' ');
}

function highlighted(text: string, needle: string) {
  const target = needle.trim().toLocaleLowerCase();
  if (!target || !text) return text;
  const parts: React.ReactNode[] = [];
  let index = 0;
  let start = text.toLocaleLowerCase().indexOf(target);
  while (start >= 0 && parts.length < 160) {
    if (start > index) parts.push(text.slice(index, start));
    parts.push(<mark key={start} className={styles.match}>{text.slice(start, start + target.length)}</mark>);
    index = start + target.length;
    start = text.toLocaleLowerCase().indexOf(target, index);
  }
  if (index < text.length) parts.push(text.slice(index));
  return parts;
}

function preview(section: HandbookSection, term: string) {
  const text = contentText(section);
  const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, start + 175);
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export function HandbookReader({
  body, draft = false, instance = 'main', onSearch, onNavigate,
}: {
  body: string; draft?: boolean; instance?: string;
  onSearch?: (value: string) => void;
  onNavigate?: (id: string, via: 'search' | 'contents') => void;
}) {
  const handbook = useMemo(() => parse(body), [body]);
  const [query, setQuery] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [active, setActive] = useState('');

  const search = query.trim().toLocaleLowerCase();
  const highlightQuery = search.length >= 2 ? query : '';
  const hits = useMemo<Hit[]>(() => {
    if (!handbook || search.length < 2) return [];
    return handbook.chapters.flatMap(chapter => chapter.sections
      .filter(section => (chapter.title + ' ' + contentText(section))
        .toLocaleLowerCase().includes(search))
      .map(section => ({
        chapter, section, preview: preview(section, search),
      })));
  }, [handbook, search]);

  useEffect(() => {
    if (!handbook || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const topmost = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (topmost) setActive(topmost.target.id);
    }, { rootMargin: '-90px 0px -68% 0px', threshold: 0 });
    for (const chapter of handbook.chapters) {
      const chapterNode = document.getElementById(instance + '-' + chapter.id);
      if (chapterNode) observer.observe(chapterNode);
      for (const section of chapter.sections) {
        const node = document.getElementById(instance + '-' + section.id);
        if (node) observer.observe(node);
      }
    }
    return () => observer.disconnect();
  }, [handbook, instance]);

  function jump(id: string, via: 'search' | 'contents') {
    document.getElementById(instance + '-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const url = window.location.pathname + window.location.search + '#' + encodeURIComponent(instance + '-' + id);
    window.history.replaceState(window.history.state, '', url);
    setActive(id);
    setTocOpen(false);
    onNavigate?.(id, via);
  }

  if (!handbook) {
    return <p role="alert">This handbook could not be displayed. Ask management to re-import the original PDF.</p>;
  }

  const count = handbook.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  return <div className={styles.reader}>
    <header className={styles.heading}>
      <div className={styles.eyebrow}>HIDDEN OASIS · STAFF HANDBOOK</div>
      <h3>{handbook.title}</h3>
      <p>{handbook.edition} edition · {handbook.chapters.filter(ch => ch.number !== 'ack').length} main chapters · {count} indexed topics</p>
      {draft ? <div className={styles.draft}>Management preview — not yet published to employees</div> : null}
    </header>
    <div className={styles.search}>
      <label htmlFor={"handbook-search-" + instance}>Search inside this handbook</label>
      <div className={styles.inputWrap}>
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m16.5 16.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>
        <input id={"handbook-search-" + instance} type="search" autoComplete="off"
          placeholder="Try: lateness, sick leave, guest complaint..."
          value={query} onChange={event => {
            setQuery(event.target.value);
            onSearch?.(event.target.value);
          }}/>
      </div>
      {search.length >= 2 ? <div className={styles.results} aria-live="polite">
        <strong>{hits.length} {hits.length === 1 ? 'topic' : 'topics'} found</strong>
        {hits.length ? <div className={styles.resultList}>{hits.map(hit =>
          <button type="button" key={hit.section.id} onClick={() => jump(hit.section.id, 'search')}>
            <span>{hit.section.number} {hit.section.title}</span>
            <small>{highlighted(hit.preview, query)}</small>
          </button>)}</div> :
          <p>No matching topics. Try a shorter word or a different term.</p>}
      </div> : null}
    </div>
    <button type="button" className={styles.tocToggle}
      aria-expanded={tocOpen} aria-controls={"handbook-table-of-contents-" + instance}
      onClick={() => setTocOpen(!tocOpen)}>
      Contents · Jump to a section <span>{tocOpen ? '−' : '+'}</span>
    </button>
    <div className={styles.layout}>
      <aside id={"handbook-table-of-contents-" + instance} className={styles.sidebar + (tocOpen ? ' ' + styles.showSidebar : '')}>
        <div className={styles.sidebarHead}>CONTENTS <span>{count} topics</span></div>
        <nav aria-label="Handbook table of contents">
          {handbook.chapters.map(chapter => <div key={chapter.id} className={styles.chapterNav}>
            <button type="button" className={active === chapter.id ? styles.selected : ''}
              onClick={() => jump(chapter.id, 'contents')}>
              {chapter.number === 'ack' ? 'Acknowledgment' : chapter.number + '. ' + chapter.title}
            </button>
            <div className={styles.subNav}>
              {chapter.sections.map(section => <button type="button" key={section.id}
                aria-current={active === section.id ? 'location' : undefined}
                className={active === section.id ? styles.selected : ''}
                onClick={() => jump(section.id, 'contents')}>
                {section.number ? section.number + ' ' : ''}{section.title}
              </button>)}
            </div>
          </div>)}
        </nav>
      </aside>
      <article className={styles.article} aria-label="Complete staff handbook">
        {handbook.chapters.map(chapter => <section key={chapter.id} id={instance + "-" + chapter.id} className={styles.chapter}>
          <p className={styles.chapterLabel}>{chapter.number === 'ack' ? 'EMPLOYEE CONFIRMATION' : 'CHAPTER ' + chapter.number}</p>
          <h4>{chapter.title}</h4>
          {chapter.sections.map(section => <section key={section.id} id={instance + "-" + section.id}
            className={styles.section}>
            {section.number.split('.').length > 2 ?
              <h6>{section.number ? section.number + ' ' : ''}{section.title}</h6> :
              <h5>{section.number ? section.number + ' ' : ''}{section.title}</h5>}
            {section.blocks.map((block, idx) => block.type === 'paragraph' ?
              <p key={idx}>{highlighted(block.text, highlightQuery)}</p> :
              <ul key={idx}>{block.items.map((item, itemIndex) =>
                <li key={itemIndex}>{highlighted(item.text, highlightQuery)}</li>)}</ul>)}
          </section>)}
        </section>)}
        <div className={styles.end}>
          End of the {handbook.edition} handbook. Follow the separate confirmation step when required.
        </div>
      </article>
    </div>
  </div>;
}
