import Tabs from 'expo-router/js-tabs';
import { ColorValue, Text } from 'react-native';

import { colors } from '../../components/theme';

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Gallery', tabBarIcon: ({ color }) => <TabIcon glyph="▦" color={color} /> }} />
      <Tabs.Screen name="backup" options={{ title: 'Backup', tabBarIcon: ({ color }) => <TabIcon glyph="⇪" color={color} /> }} />
    </Tabs>
  );
}
