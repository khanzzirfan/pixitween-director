import './desk.css';

/** The left panel before a film exists: a quiet Director's desk; the film itself is made in the chat. */
export default function Desk() {
  return (
    <section className="desk">
      <div className="desk-mark" aria-hidden="true">
        <span />
      </div>
      <div>
        <h2>Director's desk</h2>
        <p className="desk-intro">Your storyboard, shots and review panels appear here once a film exists.</p>
      </div>
      <ol className="desk-steps">
        <li>
          <b>1</b>
          <span>
            <strong>Attach a photo</strong> of the product in the chat.
          </span>
        </li>
        <li>
          <b>2</b>
          <span>
            <strong>Describe the film</strong> — mood, audience, anything it must show.
          </span>
        </li>
        <li>
          <b>3</b>
          <span>
            <strong>Watch the plan</strong> land in this panel.
          </span>
        </li>
      </ol>
      <p className="desk-cta">
        Start in the chat <span aria-hidden="true">→</span>
      </p>
    </section>
  );
}
