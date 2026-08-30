'use client';

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

type TabsProps = {
  values: string[];
  active: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
};

export function Tabs({ values, active, onChange, label = 'View filters', className = '' }: TabsProps) {
  const rail = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const element = rail.current;
    if (!element) return;
    setOverflow({
      left: element.scrollLeft > 2,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, values]);

  useEffect(() => {
    buttons.current[active]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    window.setTimeout(measure, 180);
  }, [active, measure]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % values.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + values.length) % values.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = values.length - 1;
    else return;
    event.preventDefault();
    const value = values[next];
    onChange(value);
    buttons.current[value]?.focus();
  }

  function scroll(direction: -1 | 1) {
    rail.current?.scrollBy({ left: direction * Math.max(180, rail.current.clientWidth * .7), behavior: 'smooth' });
  }

  return <div className={`tabs-shell ${className}`.trim()}>
    {overflow.left ? <button type="button" className="tabs-caret left" aria-label="Show previous filters" onClick={() => scroll(-1)}>‹</button> : null}
    <div className="tabs" role="tablist" aria-label={label} ref={rail} onScroll={measure}>
      {values.map((value, index) => <button
        type="button"
        role="tab"
        aria-selected={active === value}
        tabIndex={active === value ? 0 : -1}
        key={value}
        ref={element => { buttons.current[value] = element; }}
        className={`tab ${active === value ? 'active' : ''}`}
        onClick={() => onChange(value)}
        onKeyDown={event => navigate(event, index)}
      >{value}</button>)}
    </div>
    {overflow.right ? <button type="button" className="tabs-caret right" aria-label="Show more filters" onClick={() => scroll(1)}>›</button> : null}
  </div>;
}
