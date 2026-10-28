import type { PanelProps } from './types';

export const STUB_OWNER = 'S3b' as const;
const labels = {
  planning: 'Planning the film…',
  building: 'Building scenes…',
  ready: 'Ready',
  failed: 'Something went wrong',
  new: 'Waiting for a brief',
  reviewing: 'Reviewing…',
};

export default function Storyboard({ film, events }: PanelProps) {
  const statusEvent = [...events].reverse().find((event) => event.type === 'film.status');
  const status = statusEvent?.type === 'film.status' ? statusEvent.status : (film?.status ?? 'new');
  const storyboardEvent = [...events].reverse().find((event) => event.type === 'director.storyboard');
  const storyboard = storyboardEvent?.type === 'director.storyboard' ? storyboardEvent.storyboard : film?.storyboard;
  const transcript = [...events].reverse().find((event) => event.type === 'listener.transcript');
  const tools = events.filter((event) => event.type === 'tool.call').slice(-20);
  const costs = events.filter((event) => event.type === 'cost');
  const usd = costs.reduce((sum, event) => (event.type === 'cost' ? sum + event.usd : sum), 0);
  const credits = costs.reduce((sum, event) => (event.type === 'cost' ? sum + (event.credits ?? 0) : sum), 0);
  return (
    <section>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR CREATIVE PLAN</span>
          <h2>Storyboard</h2>
        </div>
        <span className={`status-pill status-${status}`}>{labels[status]}</span>
      </div>
      {transcript?.type === 'listener.transcript' && <p className="transcript-note">We heard: “{transcript.text}”</p>}
      {storyboard ? (
        <div>
          {storyboard.scenes.map((scene) => (
            <article className="story-scene" data-testid="scene-card" key={scene.id}>
              <div className="story-scene-top">
                <span className="scene-number">{scene.id}</span>
                <span className="scene-duration">{scene.durationSec}s</span>
              </div>
              <h3>{scene.intent}</h3>
              <span className={`mode-pill mode-${scene.mode}`} data-testid="mode-badge">
                {scene.mode.toUpperCase()}
              </span>
              <p>{scene.camera}</p>
              {scene.text && <p>{scene.text}</p>}
              <p>{scene.modeReason}</p>
              {scene.mode === 'generate' && <p>~{scene.estCredits ?? 25} credits</p>}
            </article>
          ))}
        </div>
      ) : (
        <p>Waiting for a brief</p>
      )}
      <div data-testid="tool-ticker">
        {tools.map((event, i) =>
          event.type === 'tool.call' ? (
            <p key={`${event.at}-${i}`}>
              {event.ok ? '✓' : '✗'} {event.name}
              {event.error ? `: ${event.error}` : ''}
            </p>
          ) : null,
        )}
      </div>
      {(costs.length > 0 || film) && (
        <p>
          Cost ${usd.toFixed(4)}
          {credits ? ` · ${credits} credits` : ''}
        </p>
      )}
    </section>
  );
}
