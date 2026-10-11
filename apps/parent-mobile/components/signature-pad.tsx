import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, radius, spacing } from '@/lib/theme';
import { MAX_POINTS_PER_STROKE, MAX_STROKES, type Point } from '@/lib/forms';

export const PAD_HEIGHT = 160;

/**
 * Draw a signature with a finger. Strokes are reported in pixels along with the pad size; the caller scales them.
 * Dots are drawn along the path (no drawing library needed), which is enough to see and confirm a signature.
 */
export function SignaturePad({ strokes, onChange, onSizeChange }: { strokes: Point[][]; onChange: (s: Point[][]) => void; onSizeChange: (w: number, h: number) => void }) {
  const [size, setSize] = useState({ w: 0, h: PAD_HEIGHT });
  const current = useRef<Point[][]>(strokes);
  current.current = strokes;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the screen's scroll view from stealing the gesture mid-stroke.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          if (current.current.length >= MAX_STROKES) return;
          onChange([...current.current, [p]]);
        },
        onPanResponderMove: (e) => {
          const list = current.current;
          if (list.length === 0) return;
          const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          const last = list[list.length - 1];
          if (last.length >= MAX_POINTS_PER_STROKE) return;
          onChange([...list.slice(0, -1), [...last, p]]);
        },
      }),
    [onChange],
  );

  function layout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    onSizeChange(width, height);
  }

  return (
    <View>
      <View style={styles.pad} onLayout={layout} {...responder.panHandlers} accessibilityLabel="Signature pad. Draw your signature here.">
        {strokes.length === 0 && <Text style={styles.hint}>Sign here</Text>}
        {strokes.flatMap((s, i) => s.map((p, j) => <View key={`${i}-${j}`} pointerEvents="none" style={[styles.dot, { left: p.x - 1.5, top: p.y - 1.5 }]} />))}
      </View>
      <View style={styles.row}>
        <Text style={styles.muted}>{size.w > 0 ? 'Use your finger to draw.' : ''}</Text>
        <Text style={[styles.muted, styles.clear]} onPress={() => onChange([])} accessibilityRole="button">
          Clear
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    height: PAD_HEIGHT,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: { color: colors.muted, fontSize: 15 },
  dot: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: colors.foreground },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  muted: { fontSize: 13, color: colors.muted },
  clear: { color: colors.foreground, fontWeight: '600' },
});
