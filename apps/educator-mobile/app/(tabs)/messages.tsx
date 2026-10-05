import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api-client';
import { useDraft } from '@/lib/drafts';
import { Badge, Button, EmptyState, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { ThreadSummary, ThreadView } from '@/lib/types';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** U1: conversations families start with their child's room. Educators see their rooms' threads. */
export default function MessagesScreen() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setThreads(await api.get<ThreadSummary[]>('/conversations'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load messages');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (openId) {
    return (
      <Thread
        threadId={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.sm }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {error && <Text style={styles.error}>{error}</Text>}
        {!threads && !error && <ActivityIndicator />}
        {threads?.length === 0 && <EmptyState title="No conversations yet" description="When a family messages your room it appears here." />}
        {threads?.map((t) => (
          <Pressable key={t.id} style={styles.row} onPress={() => setOpenId(t.id)} accessibilityRole="button">
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.rowTitle, t.unread > 0 && { fontWeight: '800' }]} numberOfLines={1}>
                {t.childFirstName} · {t.recipients}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {t.lastMessagePreview}
              </Text>
              <Text style={styles.small}>{formatWhen(t.lastMessageAt)}</Text>
            </View>
            {t.unread > 0 && <Badge label={String(t.unread)} tone="success" />}
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Thread({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const draft = useDraft(`dm:${threadId}`);

  useEffect(() => {
    api
      .get<ThreadView>(`/conversations/${threadId}`)
      .then(setThread)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load conversation'));
  }, [threadId]);

  async function send() {
    const body = draft.value.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      setThread(await api.post<ThreadView>(`/conversations/${threadId}/reply`, { body }));
      draft.clear();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen style={{ gap: spacing.md }}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to conversations">
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Conversations</Text>
      </Pressable>
      {thread && (
        <View>
          <Text style={styles.rowTitle}>{thread.childFirstName}</Text>
          <Text style={styles.muted}>With {thread.recipients}</Text>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.sm }}>
        {!thread && !error && <ActivityIndicator />}
        {thread?.messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.fromStaff ? styles.mine : styles.theirs]}>
            <Text style={{ color: m.fromStaff ? colors.primaryForeground : colors.foreground }}>{m.body}</Text>
            <Text style={[styles.small, m.fromStaff && { color: colors.primaryForeground, opacity: 0.8 }]}>
              {m.author.firstName} · {formatWhen(m.createdAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
      {error && <Text style={styles.error}>{error}</Text>}
      <TextInput
        style={styles.input}
        value={draft.value}
        onChangeText={draft.setValue}
        placeholder="Write a reply"
        multiline
        maxLength={4000}
        accessibilityLabel="Reply"
      />
      {draft.restored && <Text style={styles.small}>Draft restored</Text>}
      <Button title={sending ? 'Sending…' : 'Send'} onPress={send} loading={sending} disabled={!draft.value.trim()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  muted: { fontSize: 13, color: colors.muted },
  small: { fontSize: 11, color: colors.muted, marginTop: 2 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bubble: { maxWidth: '80%', borderRadius: radius.md, padding: spacing.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.mutedSurface },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
    backgroundColor: colors.surface,
    color: colors.foreground,
  },
  error: { color: colors.danger },
});
