// Owned by S14. The one-page studio frame: a header with a stepper, an icon rail that switches the left panel, a resizable stage and a resizable side panel.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { Icon, type IconName } from './Icon';
import { useTheme, useWide } from './hooks';
import { goHome } from './nav';
import './shell.css';

export interface ShellTab {
  id: string;
  label: string;
  icon: IconName;
  badge?: string | number;
  content: ReactNode;
}
export interface ShellStep {
  label: string;
  /** the tab a click on this step opens */
  tab?: string;
}

export interface StudioShellProps {
  title: string;
  status?: string;
  steps: ShellStep[];
  /** index of the step the film is on, -1 for none */
  step: number;
  tabs: ShellTab[];
  defaultTab: string;
  stage: ReactNode;
  /** under the player: a compact strip of scenes */
  strip?: ReactNode;
  side: ReactNode;
  sideTitle: string;
  headerRight?: ReactNode;
  /** when set, a click on headerRight opens this tab */
  headerRightTab?: string;
  testId?: string;
  /** Space plays or pauses when the focus is not in a text field */
  onTogglePlay?(): void;
}

/** The panel library throws while it has no measured layout (first paint, jsdom); treat that as "not collapsed". */
const collapsed = (h: ImperativePanelHandle | null): boolean => {
  try {
    return !!h?.isCollapsed();
  } catch {
    return false;
  }
};
const attempt = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* no layout yet */
  }
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

const SHORTCUTS: Array<[string, string]> = [
  ['1 – 9', 'Open a panel from the rail'],
  ['[', 'Show or hide the left panel'],
  [']', 'Show or hide the chat'],
  ['Space', 'Play or pause'],
  ['?', 'This list'],
];

export function StudioShell(p: StudioShellProps) {
  const wide = useWide();
  const { theme, toggle } = useTheme();
  const [active, setActive] = useState(p.defaultTab);
  const [open, setOpen] = useState(true);
  // the film arrives after the first paint: move from the intake to its plan then, not on every render
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) setActive(p.defaultTab);
  }, [p.defaultTab]);
  const [sideOpen, setSideOpen] = useState(true);
  const [help, setHelp] = useState(false);
  const left = useRef<ImperativePanelHandle>(null);
  const right = useRef<ImperativePanelHandle>(null);

  const tabs: ShellTab[] = wide ? p.tabs : [...p.tabs, { id: 'chat', label: 'Chat', icon: 'chat', content: p.side }];

  const toggleLeft = useCallback(() => {
    if (!wide) return;
    attempt(() => (collapsed(left.current) ? left.current?.expand() : left.current?.collapse()));
  }, [wide]);
  const toggleSide = useCallback(() => {
    attempt(() => (collapsed(right.current) ? right.current?.expand() : right.current?.collapse()));
  }, []);

  const select = useCallback(
    (id: string) => {
      picked.current = true;
      if (wide && id === active && left.current && !collapsed(left.current)) {
        attempt(() => left.current?.collapse());
        return;
      }
      setActive(id);
      if (wide && collapsed(left.current)) attempt(() => left.current?.expand());
      setOpen(true);
    },
    [wide, active],
  );

  // keep the latest handlers for the key listener without re-subscribing
  const keys = useRef({ select, toggleLeft, toggleSide, tabs, onTogglePlay: p.onTogglePlay });
  keys.current = { select, toggleLeft, toggleSide, tabs, onTogglePlay: p.onTogglePlay };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = keys.current;
      if (/^[1-9]$/.test(e.key)) {
        const t = k.tabs[Number(e.key) - 1];
        if (t) k.select(t.id);
      } else if (e.key === '[') k.toggleLeft();
      else if (e.key === ']') k.toggleSide();
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') setHelp(false);
      else if (e.key === ' ' && k.onTogglePlay && !(e.target as HTMLElement | null)?.closest?.('button, a, [role="tab"], summary')) {
        e.preventDefault();
        k.onTogglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = tabs.find((t) => t.id === active);
  const dark = theme === 'dark';

  const rail = (
    <nav className="sh-rail" aria-label="Studio panels">
      <div role="tablist" aria-orientation={wide ? 'vertical' : 'horizontal'} className="sh-rail-list">
        {tabs.map((t, i) => {
          const on = t.id === active && open;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={t.label}
              title={`${t.label}${i < 9 ? ` (${i + 1})` : ''}`}
              data-testid={`rail-${t.id}`}
              className={`sh-tab${on ? ' is-on' : ''}`}
              onClick={() => select(t.id)}
            >
              <Icon name={t.icon} />
              <span className="sh-tab-label">{t.label}</span>
              {t.badge !== undefined && t.badge !== '' && t.badge !== 0 && <i className="sh-badge">{t.badge}</i>}
            </button>
          );
        })}
      </div>
    </nav>
  );

  const panes = tabs.map((t) => (
    <div key={t.id} className="sh-pane" hidden={t.id !== active} data-pane={t.id}>
      {t.content}
    </div>
  ));

  const stageBlock = (
    <div className="sh-stage">
      <div className="sh-stage-body">{p.stage}</div>
      {p.strip}
    </div>
  );

  return (
    <div className={`sh ${wide ? 'is-wide' : 'is-narrow'}`} data-testid={p.testId}>
      <header className="sh-header">
        <button type="button" className="sh-bare sh-home" title="Home: start a new film" aria-label="PixiTween Director, home" onClick={goHome}>
          <span className="sh-logo" aria-hidden="true" />
          <strong className="sh-brand">PixiTween Director</strong>
        </button>
        <span className="sh-title" title={p.title}>{p.title}</span>
        <ol className="sh-steps" aria-label="Progress">
          {p.steps.map((s, i) => (
            <li key={s.label} className={i < p.step ? 'is-done' : i === p.step ? 'is-now' : ''} aria-current={i === p.step ? 'step' : undefined}>
              <button type="button" disabled={!s.tab} onClick={() => s.tab && select(s.tab)} title={s.label}>
                <b aria-hidden="true">{i < p.step ? '✓' : i + 1}</b>
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="sh-spacer" />
        {p.headerRight && (p.headerRightTab ? (
          <button type="button" className="sh-bare" title={`Open ${p.headerRightTab}`} onClick={() => select(p.headerRightTab!)}>{p.headerRight}</button>
        ) : p.headerRight)}
        {p.status && (
          <span className={`sh-chip st-${p.status}`} data-testid="film-status">
            {p.status}
          </span>
        )}
        <button type="button" className="sh-icon-btn" aria-label="Keyboard shortcuts" title="Shortcuts (?)" onClick={() => setHelp((h) => !h)}>
          <b aria-hidden="true">?</b>
        </button>
        <button type="button" className="sh-icon-btn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme" onClick={() => toggle()}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        {wide && (
          <button type="button" className={`sh-icon-btn${sideOpen ? ' is-on' : ''}`} aria-label={`${sideOpen ? 'Hide' : 'Show'} ${p.sideTitle}`} aria-pressed={sideOpen} title={`${p.sideTitle} (])`} onClick={toggleSide}>
            <Icon name="chat" />
          </button>
        )}
      </header>
      {help && (
        <div className="sh-help" role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}>
                <dt><kbd>{k}</kbd></dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {wide ? (
        <div className="sh-body">
          {rail}
          <PanelGroup direction="horizontal" autoSaveId="studio-main" className="sh-group">
            <Panel ref={left} id="left" order={1} defaultSize={27} minSize={18} maxSize={45} collapsible collapsedSize={0} onCollapse={() => setOpen(false)} onExpand={() => setOpen(true)} className="sh-left">
              <div className="sh-panel-head">{current?.label}</div>
              <div className="sh-panes">{panes}</div>
            </Panel>
            <PanelResizeHandle className="sh-handle" hitAreaMargins={{ coarse: 12, fine: 6 }} aria-label="Resize left panel" />
            <Panel id="stage" order={2} minSize={30} className="sh-center">
              {stageBlock}
            </Panel>
            <PanelResizeHandle className="sh-handle" hitAreaMargins={{ coarse: 12, fine: 6 }} aria-label="Resize side panel" />
            <Panel ref={right} id="side" order={3} defaultSize={26} minSize={18} maxSize={45} collapsible collapsedSize={0} onCollapse={() => setSideOpen(false)} onExpand={() => setSideOpen(true)} className="sh-right">
              <div className="sh-panel-head">{p.sideTitle}</div>
              <div className="sh-side">{p.side}</div>
            </Panel>
          </PanelGroup>
        </div>
      ) : (
        <div className="sh-body">
          {stageBlock}
          <div className="sh-panes sh-panes-narrow">{panes}</div>
          {rail}
        </div>
      )}
    </div>
  );
}
