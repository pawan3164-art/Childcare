'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Megaphone, MessageCircle, Send, Siren, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { useDraft } from '@/lib/drafts';
import { PageSpinner, ErrorBanner, EmptyState, Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select, Label, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { AnnouncementScope, AnnouncementSummary, ChildListItem, Room, ThreadSummary, ThreadView } from '@/lib/types';

type Tab = 'conversations' | 'announcements';

export default function MessagesPage() {
  const { user } = useAuth();
  const isStaff = user?.role !== 'PARENT';
  const [tab, setTab] = useState<Tab>('conversations');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Messages</h1>
        <p className="text-sm text-muted">
          {isStaff ? 'Conversations with families, and announcements to rooms or the whole centre.' : "Talk to the educators in your child's room."}
        </p>
      </div>

      {isStaff && (
        <div className="flex gap-2" role="tablist">
          <TabButton active={tab === 'conversations'} onClick={() => setTab('conversations')} icon={<MessageCircle size={14} />}>
            Conversations
          </TabButton>
          <TabButton active={tab === 'announcements'} onClick={() => setTab('announcements')} icon={<Megaphone size={14} />}>
            Announcements
          </TabButton>
        </div>
      )}

      {isStaff && tab === 'announcements' ? <Announcements /> : <Conversations isStaff={isStaff} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'border-primary bg-primary-muted text-primary' : 'border-border bg-surface text-foreground hover:bg-muted-surface',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- conversations */

/** Staff pick a thread; parents pick a child (a thread is created on their first message). */
type Selection = { threadId: string } | { childId: string } | null;

function Conversations({ isStaff }: { isStaff: boolean }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(() => api.get<ThreadSummary[]>('/conversations').then(setThreads), []);

  useEffect(() => {
    loadThreads().catch((err) => setError(err.message));
    if (!isStaff) api.get<ChildListItem[]>('/children').then(setChildren).catch(() => setChildren([]));
  }, [isStaff, loadThreads]);

  // Parents see one row per child, whether or not a conversation exists yet.
  const parentRows = children.map((c) => ({ child: c, thread: threads?.find((t) => t.childId === c.id) }));

  if (error) return <ErrorBanner message={error} />;
  if (!threads) return <PageSpinner />;

  const selectedThreadId =
    selection && 'threadId' in selection ? selection.threadId : selection && 'childId' in selection ? threads.find((t) => t.childId === selection.childId)?.id : undefined;
  const selectedChild = !isStaff && selection && 'childId' in selection ? children.find((c) => c.id === selection.childId) : undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <CardContent className="p-2">
          {isStaff && threads.length === 0 && (
            <EmptyState icon={<MessageCircle size={28} />} title="No conversations yet" description="When a family messages their child's room it appears here." />
          )}
          {isStaff &&
            threads.map((t) => (
              <ThreadRow
                key={t.id}
                title={`${t.childFirstName} · ${t.recipients}`}
                preview={t.lastMessagePreview}
                at={t.lastMessageAt}
                unread={t.unread}
                active={selectedThreadId === t.id}
                onClick={() => setSelection({ threadId: t.id })}
              />
            ))}
          {!isStaff && parentRows.length === 0 && <p className="p-3 text-sm text-muted">No children linked to your account yet.</p>}
          {!isStaff &&
            parentRows.map(({ child, thread }) => (
              <ThreadRow
                key={child.id}
                title={child.firstName}
                preview={thread?.lastMessagePreview || 'Start a conversation'}
                at={thread?.lastMessageAt}
                unread={thread?.unread ?? 0}
                active={selection !== null && 'childId' in selection && selection.childId === child.id}
                onClick={() => setSelection({ childId: child.id })}
              />
            ))}
        </CardContent>
      </Card>

      {selection === null ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState icon={<MessageCircle size={28} />} title={isStaff ? 'Choose a conversation' : 'Choose a child'} />
          </CardContent>
        </Card>
      ) : (
        <ThreadPanel
          key={selectedThreadId ?? (selectedChild?.id as string)}
          isStaff={isStaff}
          threadId={selectedThreadId}
          child={selectedChild}
          onSent={() => loadThreads()}
        />
      )}
    </div>
  );
}

function ThreadRow({
  title,
  preview,
  at,
  unread,
  active,
  onClick,
}: {
  title: string;
  preview: string;
  at?: string;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors', active ? 'bg-primary-muted' : 'hover:bg-muted-surface')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={clsx('truncate text-sm', unread > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground')}>{title}</p>
          {unread > 0 && <Badge tone="primary">{unread}</Badge>}
        </div>
        <p className="truncate text-xs text-muted">{preview}</p>
        {at && <p className="mt-0.5 text-xs text-muted">{formatDateTime(at)}</p>}
      </div>
    </button>
  );
}

function ThreadPanel({ isStaff, threadId, child, onSent }: { isStaff: boolean; threadId?: string; child?: ChildListItem; onSent: () => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [loading, setLoading] = useState(Boolean(threadId));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const draft = useDraft(`dm:${threadId ?? child?.id}`);

  useEffect(() => {
    if (!threadId) return;
    api
      .get<ThreadView>(`/conversations/${threadId}`)
      .then((t) => {
        setThread(t);
        onSent(); // opening marks it read, so refresh unread counts
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the thread changes
  }, [threadId]);

  async function send() {
    const body = draft.value.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const updated = isStaff
        ? await api.post<ThreadView>(`/conversations/${threadId}/reply`, { body })
        : await api.post<ThreadView>(`/children/${child?.id ?? thread?.childId}/conversation`, { body });
      setThread(updated);
      draft.clear();
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  const recipients = thread?.recipients ?? (child?.roomName ? `${child.roomName} educators and centre staff` : 'Centre staff');
  const title = thread?.childFirstName ?? child?.firstName ?? '';

  return (
    <Card className="flex flex-col">
      <CardHeader className="border-b border-border pb-4">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <Users size={14} /> {isStaff ? 'With' : 'Goes to'} {recipients}
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pt-4">
        {loading && <PageSpinner />}
        {!loading && (thread?.messages.length ?? 0) === 0 && <p className="text-sm text-muted">No messages yet. Say hello.</p>}
        {thread?.messages.map((m) => {
          const mine = m.fromStaff === isStaff;
          return (
            <div key={m.id} className={clsx('flex gap-2', mine && 'flex-row-reverse')}>
              <Avatar initials={m.author.firstName.slice(0, 1).toUpperCase()} />
              <div className={clsx('max-w-[75%] rounded-xl px-3 py-2 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted-surface text-foreground')}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={clsx('mt-1 text-xs', mine ? 'opacity-80' : 'text-muted')}>
                  {m.author.firstName} · {formatDateTime(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
      <div className="space-y-2 border-t border-border p-4">
        {error && <ErrorBanner message={error} />}
        <Label htmlFor="reply" className="sr-only">
          Message
        </Label>
        <Textarea id="reply" value={draft.value} onChange={(e) => draft.setValue(e.target.value)} placeholder="Write a message" maxLength={4000} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{draft.restored ? 'Draft restored' : draft.value ? 'Draft saved on this device' : ''}</span>
          <Button onClick={send} disabled={sending || !draft.value.trim()}>
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- announcements */

const SCOPE_LABEL: Record<AnnouncementScope, string> = { ROOM: 'Room', CENTRE: 'Whole centre', EMERGENCY: 'Emergency' };

function Announcements() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [list, setList] = useState<AnnouncementSummary[] | null>(null);
  const [scope, setScope] = useState<AnnouncementScope>('CENTRE');
  const [roomId, setRoomId] = useState('');
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const draft = useDraft('announcement');

  const load = useCallback(() => api.get<AnnouncementSummary[]>('/messages').then(setList), []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, [load]);

  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? 'a room';
  const centre = user?.centreName ?? 'the centre';
  const recipients =
    scope === 'ROOM'
      ? `Families of children in ${roomName(roomId)}`
      : scope === 'CENTRE'
        ? `Every family at ${centre}`
        : `Every family at ${centre}, as an urgent push notification`;

  async function send() {
    const body = draft.value.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/messages', { scope, body, roomId: scope === 'ROOM' ? roomId : undefined });
      draft.clear();
      setConfirmEmergency(false);
      setSuccess(`Sent to ${recipients.charAt(0).toLowerCase()}${recipients.slice(1)}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Announcement not sent');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="scope">Send to</Label>
              <Select
                id="scope"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as AnnouncementScope);
                  setConfirmEmergency(false);
                }}
              >
                {(Object.keys(SCOPE_LABEL) as AnnouncementScope[]).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
            {scope === 'ROOM' && (
              <div>
                <Label htmlFor="room">Room</Label>
                <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div
            className={clsx(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              scope === 'EMERGENCY' ? 'bg-danger-surface text-danger' : 'bg-info-surface text-info',
            )}
          >
            {scope === 'EMERGENCY' ? <Siren size={16} /> : <Users size={16} />}
            <span>
              <span className="font-medium">Who will receive this:</span> {recipients}
            </span>
          </div>

          <div>
            <Label htmlFor="announcement">Message</Label>
            <Textarea id="announcement" value={draft.value} onChange={(e) => draft.setValue(e.target.value)} placeholder="e.g. Please pack a hat tomorrow" />
            <p className="mt-1 text-xs text-muted">{draft.restored ? 'Draft restored' : draft.value ? 'Draft saved on this device' : ''}</p>
          </div>

          {scope === 'EMERGENCY' && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={confirmEmergency} onChange={(e) => setConfirmEmergency(e.target.checked)} />
              This is an emergency and every family should be alerted now
            </label>
          )}

          {error && <ErrorBanner message={error} />}
          {success && <div className="rounded-lg border border-success/30 bg-success-surface px-4 py-3 text-sm text-success">{success}</div>}

          <Button
            variant={scope === 'EMERGENCY' ? 'danger' : 'primary'}
            onClick={send}
            disabled={sending || !draft.value.trim() || (scope === 'ROOM' && !roomId) || (scope === 'EMERGENCY' && !confirmEmergency)}
          >
            <Send size={14} /> {sending ? 'Sending…' : scope === 'EMERGENCY' ? 'Send emergency alert' : 'Send announcement'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sent</CardTitle>
        </CardHeader>
        <CardContent>
          {!list ? (
            <PageSpinner />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted">No announcements yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {list.map((a) => (
                <div key={a.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.scope === 'EMERGENCY' ? 'danger' : a.scope === 'ROOM' ? 'info' : 'primary'}>
                      {a.scope === 'ROOM' ? roomName(a.roomId) : SCOPE_LABEL[a.scope]}
                    </Badge>
                    <span className="text-xs text-muted">
                      {a.author.firstName} · {formatDateTime(a.createdAt)}
                    </span>
                    <span className="ml-auto text-xs text-muted">{a.acknowledgedCount} acknowledged</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
