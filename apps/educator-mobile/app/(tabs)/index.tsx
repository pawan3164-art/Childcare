import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api-client';
import { Avatar, Badge, Button, EmptyState, Screen } from '@/components/ui';
import { colors, spacing } from '@/lib/theme';
import type { ChildListItem, Room } from '@/lib/types';

export default function RosterScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  const load = useCallback(() => {
    if (!roomId) return;
    api
      .get<ChildListItem[]>(`/children?roomId=${roomId}`)
      .then(setChildren)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [roomId]);

  useEffect(load, [load]);
  useFocusEffect(load);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function toggleAttendance(child: ChildListItem) {
    setActioningId(child.id);
    const eventType = child.attendanceStatus === 'SIGNED_IN' ? 'SIGN_OUT' : 'SIGN_IN';
    try {
      await api.post('/attendance/events', {
        childId: child.id,
        eventType,
        method: 'EDUCATOR',
        timestamp: new Date().toISOString(),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update attendance');
    } finally {
      setActioningId(null);
    }
  }

  return (
    <Screen style={styles.screen}>
      {rooms.length > 1 && (
        <View style={styles.roomPicker}>
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              onPress={() => setRoomId(room.id)}
              style={[styles.roomChip, roomId === room.id && styles.roomChipActive]}
            >
              <Text style={[styles.roomChipText, roomId === room.id && styles.roomChipTextActive]}>{room.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {!children ? (
        <ActivityIndicator style={styles.spinner} />
      ) : children.length === 0 ? (
        <EmptyState title="No children in this room" />
      ) : (
        <FlatList
          data={children}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ gap: spacing.sm }}
          renderItem={({ item }) => {
            const signedIn = item.attendanceStatus === 'SIGNED_IN';
            return (
              <View style={styles.row}>
                <Avatar initials={`${item.firstName[0]}${item.lastName[0]}`} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>
                    {item.firstName} {item.lastName}
                  </Text>
                  <Badge label={signedIn ? 'Signed in' : 'Not signed in'} tone={signedIn ? 'success' : 'neutral'} />
                </View>
                <Button
                  title={signedIn ? 'Sign out' : 'Sign in'}
                  size="sm"
                  variant={signedIn ? 'secondary' : 'primary'}
                  loading={actioningId === item.id}
                  onPress={() => toggleAttendance(item)}
                />
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg },
  roomPicker: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  roomChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.mutedSurface,
  },
  roomChipActive: { backgroundColor: colors.primaryMuted },
  roomChipText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  roomChipTextActive: { color: colors.primary },
  spinner: { marginTop: spacing.xl },
  error: { color: colors.danger, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowInfo: { flex: 1, gap: 4 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.foreground },
});
