import { StyleSheet } from 'react-native';

export const colors = {
  background: '#0f1115',
  surface: '#1a1d24',
  border: '#2a2e37',
  text: '#f2f4f8',
  muted: '#9aa3b2',
  accent: '#4f8cff',
  danger: '#ff6b6b',
  success: '#3ecf8e',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 16, fontWeight: '600' },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
