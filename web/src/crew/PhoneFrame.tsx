// Owned by S12d. An optional, generic phone around the chat thread. No app name, logo or brand colour.
import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'crew.phoneView';
const isNarrow = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches;
const isWide = () => typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

function readOn(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {
    /* storage may be unavailable */
  }
  return isWide();
}

export function PhoneFrame({ children, time }: { children: ReactNode; time?: string }) {
  const [clock, setClock] = useState(() => time ?? new Date().toTimeString().slice(0, 5));
  useEffect(() => {
    if (time) return;
    const id = setInterval(() => setClock(new Date().toTimeString().slice(0, 5)), 30_000);
    return () => clearInterval(id);
  }, [time]);
  return (
    <div className="phone" role="group" aria-label="Phone view">
      <div className="phone-body">
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-status" aria-hidden="true"><span>{time ?? clock}</span></div>
        <div className="phone-screen">{children}</div>
      </div>
    </div>
  );
}

/** The thread, in a phone when the toggle is on. Below 640 px the device is already a phone, so no frame is drawn. */
export function PhoneView({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(readOn);
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(max-width: 639px)');
    const h = () => setNarrow(q.matches);
    q.addEventListener?.('change', h);
    return () => q.removeEventListener?.('change', h);
  }, []);
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem(KEY, on ? 'off' : 'on');
    } catch {
      /* storage may be unavailable */
    }
  };
  if (narrow) return <>{children}</>;
  return (
    <div className="phone-view">
      <button type="button" className="phone-toggle" role="switch" aria-checked={on} onClick={toggle}>
        <span className="sw" aria-hidden="true" /> Phone view
      </button>
      {on ? <PhoneFrame>{children}</PhoneFrame> : children}
    </div>
  );
}
