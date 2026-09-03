import { ActivityIndicator, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { formatCompactINR, formatINR } from '@fpc/shared';
import { colors, styles } from '../lib/theme';

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const value = status.toUpperCase();

  const [background, text] = ['PAID', 'RECONCILED', 'APPROVED', 'MATCHED', 'ACTIVE'].includes(value)
    ? [colors.successBg, colors.success]
    : ['REJECTED', 'FAILED', 'CANCELLED'].includes(value)
      ? [colors.dangerBg, colors.danger]
      : ['PENDING_APPROVAL', 'IN_PROGRESS', 'PENDING', 'REVIEW_REQUIRED'].includes(value)
        ? [colors.warningBg, colors.warning]
        : [colors.brandLight, colors.brand];

  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color: text }]}>{humanize(status)}</Text>
    </View>
  );
}

export function Money({ minor, compact }: { minor: number | null | undefined; compact?: boolean }) {
  if (minor === null || minor === undefined) return <Text style={styles.muted}>—</Text>;
  return <Text style={styles.amount}>{compact ? formatCompactINR(minor) : formatINR(minor)}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const variantStyle =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'danger'
        ? styles.buttonDanger
        : styles.buttonSecondary;

  return (
    <TouchableOpacity
      style={[styles.button, variantStyle, disabled ? { opacity: 0.5 } : null, style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={variant === 'secondary' ? styles.buttonTextDark : styles.buttonTextLight}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const apiError = error as { status?: number; message?: string };
  const message =
    apiError?.status === 403
      ? 'You do not have permission to view this.'
      : (apiError?.message ?? 'Something went wrong.');

  return (
    <View style={[styles.card, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
      <Text style={{ color: colors.danger }}>{message}</Text>
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.heading}>{title}</Text>
      {hint ? <Text style={[styles.muted, { textAlign: 'center' }]}>{hint}</Text> : null}
    </View>
  );
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
