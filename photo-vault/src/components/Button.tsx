import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from './theme';

type Props = {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ title, onPress, busy, disabled, variant = 'primary' }: Props) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [styles.base, styles[variant], (pressed || inactive) && styles.dim]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.text}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: '#3a1f24', borderWidth: 1, borderColor: colors.danger },
  dim: { opacity: 0.6 },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
