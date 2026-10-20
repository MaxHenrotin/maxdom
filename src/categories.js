// A show with nothing seen is always to watch later; the stopped flag only applies once it was started.
export function categorize({ stopped, status, seen, airedUnseen }) {
  if (seen === 0) return 'watch_later';
  if (stopped) return 'stopped';
  if (airedUnseen > 0) return 'in_progress';
  if (status === 'Ended') return 'ended';
  return 'waiting';
}
