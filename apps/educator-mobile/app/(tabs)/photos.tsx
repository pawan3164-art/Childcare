import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/lib/api-client';
import { useDraft } from '@/lib/drafts';
import { Avatar, Badge, Button, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { ChildListItem, Room } from '@/lib/types';

const MAX_PHOTOS = 10;

type Picked = { uri: string; mimeType: string; fileName: string };

/** On native, RN's FormData takes {uri,name,type}; on web the picker gives a blob/data URI to fetch. */
async function appendPhoto(form: FormData, photo: Picked) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    form.append('file', blob, photo.fileName);
  } else {
    form.append('file', { uri: photo.uri, name: photo.fileName, type: photo.mimeType } as unknown as Blob);
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** U1: share photos to the family feed of each tagged child (consent enforced by the API, ADR 0004). */
export default function PhotosScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [tagged, setTagged] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const caption = useDraft('photo-caption');

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    setChildren(null);
    setTagged(new Set());
    api.get<ChildListItem[]>(`/children?roomId=${roomId}`).then(setChildren);
  }, [roomId]);

  const taggedNames = (children ?? []).filter((c) => tagged.has(c.id)).map((c) => c.firstName);

  async function pick(source: 'library' | 'camera') {
    setError(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(source === 'camera' ? 'Camera access is needed to take photos.' : 'Photo library access is needed to choose photos.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: source === 'library', selectionLimit: MAX_PHOTOS - photos.length };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;
    const picked = result.assets.map((a, i) => ({
      uri: a.uri,
      mimeType: a.mimeType ?? 'image/jpeg',
      fileName: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
    }));
    setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  }

  function toggle(childId: string) {
    setTagged((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  async function share() {
    setError(null);
    setSuccess(null);
    const childIds = [...tagged];
    try {
      const mediaAssetIds: string[] = [];
      for (const [i, photo] of photos.entries()) {
        setProgress(`Uploading ${i + 1} of ${photos.length}…`);
        const form = new FormData();
        await appendPhoto(form, photo);
        form.append('childIds', JSON.stringify(childIds));
        if (roomId) form.append('roomId', roomId);
        const asset = await api.upload<{ id: string }>('/media/upload', form);
        mediaAssetIds.push(asset.id);
      }
      setProgress('Posting…');
      await api.post('/feed/posts', { caption: caption.value.trim() || undefined, mediaAssetIds });
      setSuccess(`Shared with the families of ${listNames(taggedNames)}.`);
      setPhotos([]);
      setTagged(new Set());
      caption.clear();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photos not shared');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
        {rooms.length > 1 && (
          <View style={styles.chipRow}>
            {rooms.map((room) => (
              <Pressable key={room.id} onPress={() => setRoomId(room.id)} accessibilityRole="radio" accessibilityState={{ selected: roomId === room.id }}>
                <Badge label={room.name} tone={roomId === room.id ? 'success' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}

        <View>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.chipRow}>
            {photos.map((p, i) => (
              <View key={p.uri} style={styles.thumb}>
                <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} accessibilityLabel={`Selected photo ${i + 1}`} />
                <Pressable
                  style={styles.remove}
                  onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  accessibilityLabel={`Remove photo ${i + 1}`}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS && (
              <>
                <Pressable style={[styles.thumb, styles.add]} onPress={() => pick('library')} accessibilityRole="button" accessibilityLabel="Choose photos">
                  <MaterialCommunityIcons name="image-plus" size={24} color={colors.muted} />
                  <Text style={styles.addLabel}>Choose</Text>
                </Pressable>
                {Platform.OS !== 'web' && (
                  <Pressable style={[styles.thumb, styles.add]} onPress={() => pick('camera')} accessibilityRole="button" accessibilityLabel="Take a photo">
                    <MaterialCommunityIcons name="camera-outline" size={24} color={colors.muted} />
                    <Text style={styles.addLabel}>Camera</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Who is in them?</Text>
          {!children ? (
            <ActivityIndicator />
          ) : (
            <View style={styles.chipRow}>
              {children.map((c) => {
                const on = tagged.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.childChip, on && styles.childChipOn]}
                    onPress={() => toggle(c.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Avatar initials={`${c.firstName[0]}${c.lastName[0]}`} />
                    <Text style={styles.childName}>{c.firstName}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View>
          <Text style={styles.sectionTitle}>Caption (optional)</Text>
          <TextInput
            style={styles.textarea}
            value={caption.value}
            onChangeText={caption.setValue}
            placeholder="e.g. Painting with leaves this morning"
            multiline
            maxLength={2000}
          />
          {caption.restored && <Text style={styles.small}>Draft restored</Text>}
        </View>

        <Text style={styles.recipients}>
          Who will see this: {taggedNames.length === 0 ? 'tag at least one child' : `the families of ${listNames(taggedNames)}`}
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}
        {success && <Text style={styles.success}>{success}</Text>}

        <Button
          title={progress ?? `Share ${photos.length === 1 ? 'photo' : 'photos'}`}
          onPress={share}
          loading={progress !== null}
          disabled={photos.length === 0 || tagged.size === 0}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.foreground, marginBottom: spacing.sm, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 88, height: 88, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.mutedSurface },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, gap: 2 },
  addLabel: { fontSize: 12, color: colors.muted },
  remove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.full, padding: 3 },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
    paddingLeft: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  childChipOn: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  childName: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
    backgroundColor: colors.surface,
    color: colors.foreground,
  },
  recipients: { color: colors.foreground, backgroundColor: colors.primaryMuted, padding: spacing.md, borderRadius: radius.md },
  small: { fontSize: 11, color: colors.muted, marginTop: 4 },
  error: { color: colors.danger },
  success: { color: colors.success },
});
