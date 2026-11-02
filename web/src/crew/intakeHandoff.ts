// What the user just sent from the intake chat, kept in memory so the studio's chat opens with it instead of an empty thread.
// A reload or a shared link has nothing here; the studio then reads the brief and the photo stored on the film.
export interface SentBrief {
  text: string;
  photoUrl?: string;
  voice?: boolean;
}

const sent = new Map<string, SentBrief>();

export const rememberIntake = (filmId: string, brief: SentBrief) => void sent.set(filmId, brief);
export const recallIntake = (filmId: string | null | undefined) => (filmId ? sent.get(filmId) : undefined);
