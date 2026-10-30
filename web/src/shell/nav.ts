// Owned by S14. Back to the empty "new film" screen: drop ?film= and let the App follow the history change.
export function goHome(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('film');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
