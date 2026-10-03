import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewProps } from 'react-native';
import { colors, radius, spacing } from '@/lib/theme';

export function Card({ style, ...props }: ViewProps) {
  return <View style={[styles.card, style]} {...props} />;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  style,
  ...props
}: PressableProps & { title: string; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style as object,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.foreground : colors.primaryForeground} size="small" />
      ) : (
        <Text
          style={[
            styles.buttonText,
            size === 'sm' && styles.buttonTextSm,
            variant === 'secondary' && styles.buttonTextSecondary,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const toneStyles = {
    neutral: { bg: colors.mutedSurface, fg: colors.muted },
    success: { bg: colors.successSurface, fg: colors.success },
    warning: { bg: colors.warningSurface, fg: colors.warning },
    danger: { bg: colors.dangerSurface, fg: colors.danger },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: toneStyles.bg }]}>
      <Text style={[styles.badgeText, { color: toneStyles.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

export function Screen({ children, style }: ViewProps) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description && <Text style={styles.emptyDescription}>{description}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonSm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.mutedSurface, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.primaryForeground, fontWeight: '600', fontSize: 15 },
  buttonTextSm: { fontSize: 13 },
  buttonTextSecondary: { color: colors.foreground },
  badge: { borderRadius: radius.full, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.foreground },
  emptyDescription: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
