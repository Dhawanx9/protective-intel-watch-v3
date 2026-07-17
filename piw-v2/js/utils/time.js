export function timeAgo(iso) {
  if (!iso) return "unknown";
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatClock(date = new Date()) {
  return date.toUTCString().slice(17, 25) + " UTC";
}

export function withinHours(iso, hours) {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) <= hours * 3600 * 1000;
}
