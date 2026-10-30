import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioShell, type ShellTab } from './StudioShell';
import { STEPS, stepFor } from './steps';

afterEach(() => vi.unstubAllGlobals());

const tabs: ShellTab[] = [
  { id: 'plan', label: 'Plan', icon: 'list', badge: 3, content: <p>plan body</p> },
  { id: 'export', label: 'Export', icon: 'download', content: <p>export body</p> },
];
const shell = (over: Partial<Parameters<typeof StudioShell>[0]> = {}) =>
  render(<StudioShell title="Film" status="building" steps={STEPS} step={2} tabs={tabs} defaultTab="plan" stage={<div>stage</div>} side={<p>chat body</p>} sideTitle="Chat" testId="shell" {...over} />);

it('switches panes but keeps every pane mounted', () => {
  shell();
  const plan = document.querySelector('[data-pane="plan"]')!;
  const exp = document.querySelector('[data-pane="export"]')!;
  expect(plan).not.toHaveAttribute('hidden');
  expect(exp).toHaveAttribute('hidden');
  fireEvent.click(screen.getByTestId('rail-export'));
  expect(exp).not.toHaveAttribute('hidden');
  expect(plan).toHaveAttribute('hidden');
  expect(screen.getByText('plan body')).toBeInTheDocument();
});

it('shows a badge on the rail and the status as film-status', () => {
  shell();
  expect(screen.getByTestId('rail-plan')).toHaveTextContent('3');
  expect(screen.getByTestId('film-status')).toHaveTextContent('building');
});

it('marks done, current and later steps, and a step opens its tab', () => {
  shell({ step: 2 });
  const items = [...document.querySelectorAll('.sh-steps li')];
  expect(items.map((li) => li.className)).toEqual(['is-done', 'is-done', 'is-now', '', '']);
  expect(items[2]).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(document.querySelector('[data-pane="export"]')).not.toHaveAttribute('hidden');
});

it('maps a film status to a step', () => {
  expect(['new', 'planning', 'building', 'reviewing', 'ready', undefined].map(stepFor)).toEqual([0, 1, 2, 3, 4, 0]);
});

it('number keys open a rail tab, but not while typing', () => {
  shell({ side: <textarea aria-label="t" /> });
  fireEvent.keyDown(window, { key: '2' });
  expect(document.querySelector('[data-pane="export"]')).not.toHaveAttribute('hidden');
  fireEvent.keyDown(window, { key: '1' });
  expect(document.querySelector('[data-pane="plan"]')).not.toHaveAttribute('hidden');
  fireEvent.keyDown(screen.getByLabelText('t'), { key: '2' });
  expect(document.querySelector('[data-pane="plan"]')).not.toHaveAttribute('hidden');
});

it('on a narrow screen there is no panel group and chat is one more tab', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  shell();
  expect(document.querySelector('[data-panel-group]')).toBeNull();
  expect(screen.getByTestId('rail-chat')).toBeInTheDocument();
  const rail = document.querySelector('.sh-rail')!;
  const stage = document.querySelector('.sh-stage')!;
  expect(stage.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
