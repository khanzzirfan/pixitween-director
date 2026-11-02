// Owned by S14. Back to the empty "new film" screen: drop ?film=, ?catalog= and ?replay= and let the App follow the history change.
export function goHome(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('film');
  url.searchParams.delete('lineup');
  url.searchParams.delete('replay');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Opens one film in the studio; inside a line-up the film keeps its line-up, so the product tabs stay. */
export function openFilm(filmId: string, lineupId?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('film', filmId);
  if (lineupId) url.searchParams.set('lineup', lineupId);
  url.searchParams.delete('replay');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
