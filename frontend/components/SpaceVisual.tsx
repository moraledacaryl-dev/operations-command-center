import { Icon } from './Icon';

/** A quiet architectural illustration when a space has no assigned photograph. */
export function SpaceVisual({ name, kind, photo }: { name: string; kind?: string; photo?: string }) {
  const isRoom = String(kind).toLowerCase() === 'room';
  const isOutdoor = /pool|garden/i.test(name);
  return <div className={`space-visual ${isRoom ? 'space-bedroom' : isOutdoor ? 'space-outdoor' : 'space-shared'}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined} aria-hidden="true">
    {!photo && <><svg viewBox="0 0 360 170" fill="none" className="space-drawing">
      <path d="M70 137V36h220v101M70 137h220" stroke="currentColor" strokeWidth="1.3" opacity=".25" />
      {isRoom ? <><rect x="95" y="55" width="55" height="57" rx="2" stroke="currentColor" opacity=".35"/><path d="M122 55v57M95 83h55" stroke="currentColor" opacity=".25"/><rect x="172" y="85" width="90" height="45" rx="5" fill="currentColor" opacity=".13"/><path d="M172 130V77q0-5 5-5h80q5 0 5 5v53M167 132h100M178 104h78" stroke="currentColor" strokeWidth="2"/><rect x="180" y="81" width="31" height="18" rx="3" stroke="currentColor"/><rect x="221" y="81" width="31" height="18" rx="3" stroke="currentColor"/></> : isOutdoor ? <><path d="M100 127c18-10 35 10 53 0s35 10 53 0 35 10 53 0M100 114c18-10 35 10 53 0s35 10 53 0 35 10 53 0" stroke="currentColor" strokeWidth="2"/><circle cx="237" cy="65" r="17" fill="currentColor" opacity=".15"/><path d="M124 103V61m0 18c-24 0-27-16-27-27 18 0 27 9 27 27zm0-7c24 0 27-16 27-27-18 0-27 9-27 27z" stroke="currentColor" strokeWidth="1.7"/></> : <><path d="M119 131V98h122v33M126 98V78h108v20M116 132h128M179 98v34" stroke="currentColor" strokeWidth="2"/><rect x="140" y="48" width="80" height="35" rx="2" fill="currentColor" opacity=".1"/><path d="M254 131v-27m0 9c-16 0-18-12-18-20 12 0 18 6 18 20zm0-6c16 0 18-12 18-20-12 0-18 6-18 20z" stroke="currentColor" strokeWidth="1.7"/></>}
    </svg><span className="space-visual-mark"><Icon name={isRoom ? 'rooms' : isOutdoor ? 'leaf' : 'home'} /></span></>}
  </div>;
}
