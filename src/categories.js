export function categorize({ stopped, status, seen, airedUnseen }) {
  if (stopped) return 'stopped';
  if (seen === 0) return 'watch_later';
  if (airedUnseen > 0) return 'in_progress';
  if (status === 'Ended') return 'ended';
  return 'waiting';
}
