import { Image, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/lib/theme';
import type { FeedMedia } from '@/lib/types';

/** Photos from a post. URLs are 5-minute signed links (ADR 0004), so they are always fetched fresh with the screen. */
export function PhotoGrid({ media }: { media: (Pick<FeedMedia, 'id' | 'url'> & Partial<FeedMedia>)[] }) {
  if (media.length === 0) return null;
  const single = media.length === 1;
  return (
    <View style={styles.grid}>
      {media.map((m) => (
        <Image
          key={m.id}
          source={{ uri: m.url }}
          accessibilityLabel="Photo from the centre"
          resizeMode="cover"
          style={[styles.photo, single ? { width: '100%', aspectRatio: m.width && m.height ? m.width / m.height : 4 / 3 } : styles.half]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  photo: { borderRadius: radius.md, backgroundColor: colors.mutedSurface },
  half: { width: '49%', aspectRatio: 1 },
});
