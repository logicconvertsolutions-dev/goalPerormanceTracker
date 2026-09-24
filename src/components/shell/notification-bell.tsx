'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Bell, CalendarClock, Moon, Smartphone, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDisplayDateTime, formatDisplayTime, isoToDateInZone, todayIso } from '@/lib/dates';
import {
  clearNotificationsAction,
  deletePushSubscriptionAction,
  savePushSubscriptionAction,
} from './notifications-actions';

export interface BellNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'reminder', label: 'Reminders' },
  { key: 'appointment', label: 'Appointments' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const KIND_ICON: Record<string, { icon: typeof Bell; tone: string }> = {
  reminder: { icon: Bell, tone: 'bg-warn-dim text-warn' },
  appointment: { icon: CalendarClock, tone: 'bg-acc-dim text-acc' },
  morning_brief: { icon: Sun, tone: 'bg-ok-dim text-ok' },
  evening_nudge: { icon: Moon, tone: 'bg-[#4a3aa7]/10 text-[#4a3aa7]' },
};

type PushState = 'loading' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on' | 'not-configured';

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Header bell (P30): unread badge, a sheet listing recent notifications, and
 * the "turn on for this device" control for web push. The feed is written
 * only by the delivery job; the user can only mark items read.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  vapidPublicKey,
  timeZone,
}: {
  notifications: BellNotification[];
  unreadCount: number;
  vapidPublicKey: string | null;
  timeZone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [pushState, setPushState] = useState<PushState>('loading');
  const [pending, startTransition] = useTransition();
  // Hidden right away on tap / Clear all; the server refresh then drops them.
  const [cleared, setCleared] = useState<Set<string> | 'all'>(() => new Set());
  // Fetched when the sheet opens, so the Enable tap can call subscribe()
  // straight away: iOS only allows it while the tap's user activation lasts.
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { state, reg } = await detectPushState(vapidPublicKey);
      registration.current = reg;
      if (!cancelled) setPushState(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, vapidPublicKey]);

  const visible = cleared === 'all' ? [] : notifications.filter((n) => !cleared.has(n.id));
  const shown = visible.filter((n) => filter === 'all' || n.kind === filter);
  const today = todayIso(timeZone);
  const groups = [
    { label: 'Today', items: shown.filter((n) => isoToDateInZone(n.created_at, timeZone) === today) },
    { label: 'Earlier', items: shown.filter((n) => isoToDateInZone(n.created_at, timeZone) !== today) },
  ].filter((g) => g.items.length > 0);

  function clearAll() {
    setCleared('all');
    startTransition(async () => {
      const result = await clearNotificationsAction();
      if (!result.ok) {
        setCleared(new Set());
        toast.error(result.error);
      }
    });
  }

  // Opening a notification also clears it from the list (P31).
  function clearOne(id: string) {
    setCleared((s) => (s === 'all' ? s : new Set(s).add(id)));
    startTransition(async () => {
      await clearNotificationsAction([id]);
    });
  }

  async function enablePush() {
    if (!vapidPublicKey) return;
    const reg = registration.current;
    if (!reg) {
      toast.error('Still setting up — try again in a moment.');
      return;
    }
    try {
      // subscribe() is the first await in the tap handler: it shows the
      // permission prompt itself, and WebKit rejects it once an earlier await
      // (requestPermission, serviceWorker.ready) has used up the activation.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey) as BufferSource,
      });
      const result = await savePushSubscriptionAction(sub.toJSON(), navigator.userAgent);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPushState('on');
      toast.success('Notifications are on for this device');
    } catch (error) {
      if (Notification.permission === 'denied') {
        setPushState('blocked');
        return;
      }
      console.error('Push subscribe failed', error);
      const name = error instanceof Error ? error.name : 'Error';
      toast.error(`This browser couldn’t turn on notifications (${name}).`);
    }
  }

  async function disablePush() {
    try {
      const sub = await registration.current?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushState('off');
    } catch {
      toast.error('Could not turn off notifications.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-sm text-fg transition-smooth hover:bg-hover',
          open && 'bg-acc-dim'
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-bg bg-bad px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'bottom-0 top-auto flex max-h-[85vh] w-full max-w-none translate-y-0 flex-col rounded-b-none p-0',
            'sm:bottom-auto sm:top-1/2 sm:max-w-md sm:-translate-y-1/2 sm:rounded-b-lg'
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-3 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between px-4 pb-1 pt-3 pr-12">
            <DialogTitle className="text-[20px] font-bold tracking-heading-tight text-fg">Notifications</DialogTitle>
            {visible.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                disabled={pending}
                className="text-sm font-bold text-acc hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
          <DialogDescription className="sr-only">Your reminders, appointment alerts and daily summary.</DialogDescription>

          <div className="flex gap-1.5 px-4 pb-2 pt-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-bold',
                  filter === f.key ? 'border-acc bg-acc text-white' : 'border-line text-fg-2'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-3">
                You’re all caught up. Reminders and appointment alerts will show up here.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <p className="mb-1 mt-3 text-[11px] font-extrabold uppercase tracking-wide text-fg-3">{g.label}</p>
                  <ul className="divide-y divide-line">
                    {g.items.map((n) => {
                      const meta = KIND_ICON[n.kind] ?? KIND_ICON.reminder;
                      const Icon = meta.icon;
                      const when =
                        g.label === 'Today'
                          ? formatDisplayTime(n.created_at, timeZone)
                          : `${formatDisplayDateTime(n.created_at, timeZone)} · ${formatDisplayTime(n.created_at, timeZone)}`;
                      const inner = (
                        <>
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-sm', meta.tone)}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-fg">{n.title}</span>
                            {n.body && <span className="mt-0.5 block text-[12.5px] leading-[17px] text-fg-2">{n.body}</span>}
                            <span className="mt-1 block text-[11px] text-fg-3">{when}</span>
                          </span>
                          {!n.read_at && (
                            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-acc" aria-label="Unread" />
                          )}
                        </>
                      );
                      return (
                        <li key={n.id}>
                          <SwipeToClear onClear={() => clearOne(n.id)}>
                            <div className="flex items-start bg-panel">
                              {n.link ? (
                                <Link
                                  href={n.link}
                                  onClick={() => {
                                    clearOne(n.id);
                                    setOpen(false);
                                  }}
                                  className="flex min-w-0 flex-1 gap-3 py-3 hover:bg-hover"
                                >
                                  {inner}
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => clearOne(n.id)}
                                  className="flex min-w-0 flex-1 gap-3 py-3 text-left hover:bg-hover"
                                >
                                  {inner}
                                </button>
                              )}
                              {/* Mouse/trackpad only; touch screens swipe instead. */}
                              <button
                                type="button"
                                onClick={() => clearOne(n.id)}
                                aria-label={`Clear "${n.title}"`}
                                className="ml-1 mt-2.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg [@media(hover:hover)_and_(pointer:fine)]:flex"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </SwipeToClear>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}

            <PushControl state={pushState} onEnable={enablePush} onDisable={disablePush} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Swipe past this (px) and let go to clear; less springs back. */
const SWIPE_CLEAR_PX = 90;

/**
 * Swipe a row left to clear it (P31), for touch. Written with pointer events
 * -- no gesture library. `touch-action: pan-y` keeps vertical scrolling of
 * the list native; a gesture only becomes a swipe once it is clearly
 * horizontal and leftward. A swipe never also counts as a tap on the row.
 * Mouse and trackpad users get the row's x button instead (hidden on touch screens).
 */
function SwipeToClear({ onClear, children }: { onClear: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const swallowClick = useRef(false);
  const width = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY };
    swiping.current = false;
    width.current = e.currentTarget.offsetWidth;
    setAnimating(false);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const moveX = e.clientX - start.current.x;
    const moveY = e.clientY - start.current.y;
    if (!swiping.current) {
      if (Math.abs(moveY) > 10 && Math.abs(moveY) > Math.abs(moveX)) {
        start.current = null; // a vertical scroll, not a swipe
        return;
      }
      if (moveX > -10 || Math.abs(moveX) < Math.abs(moveY) * 1.5) return;
      swiping.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(Math.min(0, moveX));
  }

  function onPointerEnd() {
    if (!start.current) return;
    start.current = null;
    if (!swiping.current) return;
    swiping.current = false;
    swallowClick.current = true;
    setAnimating(true);
    if (dx <= -SWIPE_CLEAR_PX) {
      setDx(-width.current);
      setTimeout(onClear, 180);
    } else {
      setDx(0);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-end bg-bad pr-4 text-xs font-bold text-white',
          dx === 0 && 'invisible'
        )}
        style={{ width: Math.max(0, -dx) }}
        aria-hidden="true"
      >
        Clear
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        className={cn('relative touch-pan-y', animating && 'transition-transform duration-200 ease-out')}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

async function detectPushState(
  vapidPublicKey: string | null
): Promise<{ state: PushState; reg: ServiceWorkerRegistration | null }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { state: isIos() && !isStandalone() ? 'ios-install' : 'unsupported', reg: null };
  }
  let reg: ServiceWorkerRegistration | null = null;
  try {
    // Same path as service-worker-registration.tsx; register() is a no-op
    // when that already ran, and covers the case where it hasn't yet.
    reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  } catch {
    reg = null;
  }
  if (!vapidPublicKey) return { state: 'not-configured', reg };
  if (Notification.permission === 'denied') return { state: 'blocked', reg };
  try {
    const sub = await reg?.pushManager.getSubscription();
    return { state: sub && Notification.permission === 'granted' ? 'on' : 'off', reg };
  } catch {
    return { state: 'off', reg };
  }
}

function PushControl({
  state,
  onEnable,
  onDisable,
}: {
  state: PushState;
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (state === 'loading' || state === 'not-configured') return null;

  const copy: Record<Exclude<PushState, 'loading' | 'not-configured'>, { title: string; body: string }> = {
    off: { title: 'Get alerts on this device', body: 'Push notifications for reminders and appointments.' },
    on: { title: 'Alerts are on for this device', body: 'You’ll get reminders and appointment alerts here.' },
    blocked: {
      title: 'Notifications are blocked',
      body: 'Allow notifications for Kautis in your browser settings, then come back here.',
    },
    'ios-install': {
      title: 'Add Kautis to your Home Screen first',
      body: 'On iPhone, tap Share → Add to Home Screen, open Kautis from there, then turn on alerts.',
    },
    unsupported: { title: 'Alerts aren’t available here', body: 'This browser doesn’t support push notifications.' },
  };
  const { title, body } = copy[state];

  return (
    <div
      className={cn(
        'mt-4 flex items-center gap-3 rounded border border-dashed px-3.5 py-3',
        state === 'on' ? 'border-ok bg-ok-dim' : state === 'off' ? 'border-acc bg-acc-dim' : 'border-line-2 bg-sunken'
      )}
    >
      <span className="text-fg-2" aria-hidden="true">
        {state === 'blocked' || state === 'unsupported' ? (
          <AlertTriangle className="h-5 w-5" />
        ) : (
          <Smartphone className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-fg">{title}</p>
        <p className="text-xs text-fg-2">{body}</p>
      </div>
      {state === 'off' && (
        <Button type="button" variant="primary" size="sm" onClick={onEnable}>
          Enable
        </Button>
      )}
      {state === 'on' && (
        <Button type="button" variant="ghost" size="sm" onClick={onDisable}>
          Turn off
        </Button>
      )}
    </div>
  );
}
