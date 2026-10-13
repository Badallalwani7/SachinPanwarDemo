// Registers the background backup task at startup (must happen at module load).
import '../lib/backgroundSync';

import Stack from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { colors, ui } from '../components/theme';
import { SessionProvider, useSession } from '../lib/session';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const { state } = useSession();
  if (state.status === 'loading') {
    return (
      <View style={[ui.screen, ui.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  const ready = state.status === 'ready';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="photo/[id]" options={{ title: '', headerTransparent: true }} />
      </Stack.Protected>
      <Stack.Protected guard={!ready}>
        <Stack.Screen name="setup" options={{ title: 'Set up Photo Vault' }} />
      </Stack.Protected>
    </Stack>
  );
}
