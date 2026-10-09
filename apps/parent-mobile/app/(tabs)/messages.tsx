import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { formatDateTime } from '@/lib/format';
import { colors, radius, spacing } from '@/lib/theme';
import type { FeedItem, FeedResponse, ThreadSummary, ThreadView } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { WithChild } from '@/components/with-child';

type Announcement = Extract<FeedItem, { kind: 'ANNOUNCEMENT' }>;

export default function MessagesScreen() {
  return <WithChild>{(child) => <Messages childId={child.id} firstName={child.firstName} roomName={child.roomName} />}</WithChild>;
}

function Messages({ childId, firstName, roomName }: { childId: string; firstName: string; roomName: string | null }) {
  // `null` = the list; 'new' = composing the first message; otherwise a thread id.
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const feed = useLoad(() => api.get<FeedResponse>(`/children/${childId}/feed`), childId, 'Could not load announcements');
  const threads = useLoad(() => api.get<ThreadSummary[]>('/conversations'), childId, 'Could not load conversations');

  const announcements = (feed.data?.items ?? []).filter((i): i is Announcement => i.kind === 'ANNOUNCEMENT');
  const childThreads = (threads.data ?? []).filter((t) => t.childId === childId);

  if (open) {
    return (
      <Thread
        childId={childId}
        firstName={firstName}
        threadId={open === 'new' ? null : open}
        onBack={() => {
          setOpen(null);
          threads.reload();
        }}
      />
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={threads.refreshing}
            onRefresh={() => {
              threads.refresh();
              feed.reload();
            }}
          />
        }
      >
        <Text style={styles.section}>Announcements</Text>
        {feed.error && <Text style={styles.error}>{feed.error}</Text>}
        {!feed.data && !feed.error && <ActivityIndicator color={colors.primary} />}
        {feed.data && announcements.length === 0 && <Text style={styles.muted}>No announcements right now.</Text>}
        {announcements.map((a) => (
          <AnnouncementCard key={a.id} item={a} onAcknowledged={feed.reload} />
        ))}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>Conversations about {firstName}</Text>
          <Button size="sm" title="New message" onPress={() => setOpen('new')} />
        </View>
        {threads.error && <Text style={styles.error}>{threads.error}</Text>}
        {!threads.data && !threads.error && <ActivityIndicator color={colors.primary} />}
        {threads.data && childThreads.length === 0 && (
          <EmptyState
            title="No messages yet"
            description={`Start a conversation with ${roomName ?? 'your child’s room'} about ${firstName}.`}
          />
        )}
        {childThreads.map((t) => (
          <Pressable key={t.id} onPress={() => setOpen(t.id)} accessibilityRole="button" style={styles.threadRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.threadTitle, t.unread > 0 && { fontWeight: '800' }]} numberOfLines={1}>
                {t.recipients}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {t.lastMessagePreview}
              </Text>
              <Text style={styles.small}>{formatDateTime(t.lastMessageAt)}</Text>
            </View>
            {t.unread > 0 && <Badge label={String(t.unread)} tone="success" />}
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function AnnouncementCard({ item, onAcknowledged }: { item: Announcement; onAcknowledged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emergency = item.scope === 'EMERGENCY';

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/messages/${item.id}/acknowledge`);
      onAcknowledged();
    } catch (err) {
      setError(errorMessage(err, 'Could not confirm'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={[{ gap: spacing.sm }, emergency && { borderColor: colors.danger }]}>
      <View style={styles.sectionRow}>
        <Badge label={emergency ? 'Emergency' : item.scope === 'ROOM' ? 'Your room' : 'Centre'} tone={emergency ? 'danger' : 'neutral'} />
        <Text style={styles.small}>{formatDateTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.body}>{item.body}</Text>
      <Text style={styles.small}>From {item.author.firstName}</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {item.acknowledged ? (
        <View style={styles.ack}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={{ color: colors.success, fontSize: 13, fontWeight: '600' }}>Seen</Text>
        </View>
      ) : (
        <Button size="sm" title="Got it" onPress={acknowledge} loading={busy} />
      )}
    </Card>
  );
}

function Thread({ childId, firstName, threadId, onBack }: { childId: string; firstName: string; threadId: string | null; onBack: () => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open an existing conversation once.
  if (threadId && loadedId !== threadId) {
    setLoadedId(threadId);
    api
      .get<ThreadView>(`/conversations/${threadId}`)
      .then(setThread)
      .catch((err) => setError(errorMessage(err, 'Could not load conversation')));
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const id = thread?.id ?? threadId;
      setThread(
        id
          ? await api.post<ThreadView>(`/conversations/${id}/reply`, { body })
          : await api.post<ThreadView>(`/children/${childId}/conversation`, { body }),
      );
      setDraft('');
    } catch (err) {
      setError(errorMessage(err, 'Message not sent'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen style={{ gap: spacing.md }}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to messages">
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Messages</Text>
      </Pressable>
      <View>
        <Text style={styles.threadTitle}>{firstName}</Text>
        <Text style={styles.muted}>{thread ? `With ${thread.recipients}` : 'New conversation with the room'}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.sm }}>
        {threadId && !thread && !error && <ActivityIndicator color={colors.primary} />}
        {thread?.messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.fromStaff ? styles.theirs : styles.mine]}>
            <Text style={{ color: m.fromStaff ? colors.foreground : colors.primaryForeground }}>{m.body}</Text>
            <Text style={[styles.small, !m.fromStaff && { color: colors.primaryForeground, opacity: 0.8 }]}>
              {m.fromStaff ? m.author.firstName : 'You'} · {formatDateTime(m.createdAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
      {error && <Text style={styles.error}>{error}</Text>}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Write a message"
        multiline
        maxLength={4000}
        accessibilityLabel="Message"
      />
      <Button title={sending ? 'Sending…' : 'Send'} onPress={send} loading={sending} disabled={!draft.trim()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  error: { color: colors.danger, fontSize: 13 },
  muted: { fontSize: 13, color: colors.muted },
  small: { fontSize: 11, color: colors.muted },
  body: { fontSize: 14, color: colors.foreground, lineHeight: 20 },
  ack: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  threadTitle: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bubble: { maxWidth: '80%', borderRadius: radius.md, padding: spacing.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.mutedSurface },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
    maxHeight: 120,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.foreground,
  },
});
