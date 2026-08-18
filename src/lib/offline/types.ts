export type QueuedActionKind = 'call' | 'appointment' | 'sale' | 'recruiting';

/**
 * A logged action that couldn't reach the server (offline, or the request
 * itself threw before a response came back). `fields` are the same
 * FormData entries the Server Action expects, minus the file/Blob types
 * FormData can hold but IndexedDB can't structured-clone reliably — none of
 * the four log forms accept file input, so this is a plain string map.
 */
export interface QueuedAction {
  id: string; // == clientRequestId, also the IndexedDB key
  kind: QueuedActionKind;
  fields: Record<string, string>;
  queuedAt: string;
}
