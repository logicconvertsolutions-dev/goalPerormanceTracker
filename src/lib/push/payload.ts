// What a web push carries to the service worker (see src/app/sw.js/route.ts).
// Kept pure so it can be unit-tested without web-push or a database.

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path the notification opens. Always starts with '/'. */
  url: string;
  /** Same tag replaces an earlier notification on the device instead of stacking. */
  tag: string;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Push services cap payloads around 4 KB; keep well under it. */
const MAX_TITLE = 120;
const MAX_BODY = 300;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function toPushPayload(n: NotificationRow): PushPayload {
  const url = n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/today';
  return {
    title: clip(n.title, MAX_TITLE),
    body: clip(n.body ?? '', MAX_BODY),
    url,
    tag: `${n.kind}:${n.id}`,
  };
}
