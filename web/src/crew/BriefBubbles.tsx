// The start of the conversation, the same in the intake, while the film loads and in the studio: the opener, the photo and the brief.
import type { SentBrief } from './intakeHandoff';

export const OPENER = 'What are we making? Send a photo of the product and tell me about it.';

export function BriefBubbles({ photoUrl, text, voice }: SentBrief) {
  return (
    <>
      <div className="bubble crew"><p>{OPENER}</p></div>
      {photoUrl && (
        <div className="bubble you k-image" data-testid="brief-photo">
          <img src={photoUrl} alt="Your product" />
        </div>
      )}
      {(text || voice) && (
        <div className="bubble you" data-testid="brief-text">
          <p>{voice ? '🎙 Voice brief' : text}</p>
        </div>
      )}
    </>
  );
}
