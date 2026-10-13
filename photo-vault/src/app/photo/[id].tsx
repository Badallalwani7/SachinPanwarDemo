import { Image } from 'expo-image';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View, ViewToken, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { colors, ui } from '../../components/theme';
import { PhotoMeta } from '../../core/crypto';
import { GalleryItem, getCurrentGallery, loadFullPhoto } from '../../lib/gallery';
import { useReadySession } from '../../lib/session';

export default function PhotoScreen() {
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const items = getCurrentGallery();
  const startIndex = Math.max(0, items[Number(index)]?.id === id ? Number(index) : items.findIndex((i) => i.id === id));
  const [current, setCurrent] = useState(startIndex);
  const { width, height } = useWindowDimensions();

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setCurrent(viewableItems[0].index);
  }).current;

  if (items.length === 0) {
    return (
      <View style={[ui.screen, ui.center]}>
        <Text style={ui.muted}>Photo not found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={[ui.screen, { backgroundColor: 'black' }]}
      data={items}
      horizontal
      pagingEnabled
      initialScrollIndex={startIndex}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      keyExtractor={(item) => item.id}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
      windowSize={3}
      renderItem={({ item, index: i }) => (
        <View style={{ width, height }}>{Math.abs(i - current) <= 1 ? <PhotoPage item={item} /> : null}</View>
      )}
    />
  );
}

function PhotoPage({ item }: { item: GalleryItem }) {
  const { github, session } = useReadySession();
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState<{ uri: string; meta: PhotoMeta } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadFullPhoto(github, session.keys, item).then(
      (p) => !cancelled && setPhoto(p),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [github, session.keys, item]);

  const saveToPhone = async () => {
    if (!photo) return;
    setSaving(true);
    try {
      const permission = await requestPermissionsAsync(true);
      if (!permission.granted) throw new Error('Allow Photo Vault to add photos to your library first.');
      await Asset.create(photo.uri);
      Alert.alert('Saved', `${photo.meta.name} was saved to your photo library.`);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <View style={ui.center}>
        <Text style={ui.error}>{error}</Text>
      </View>
    );
  }
  if (!photo) {
    return (
      <View style={ui.center}>
        <ActivityIndicator color={colors.text} />
        <Text style={ui.muted}>Downloading and decrypting…</Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Image source={{ uri: photo.uri }} style={{ flex: 1 }} contentFit="contain" />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.text} numberOfLines={1}>
            {photo.meta.name}
          </Text>
          {photo.meta.takenAt ? <Text style={ui.muted}>{new Date(photo.meta.takenAt).toLocaleString()}</Text> : null}
        </View>
        <Button title="Save to phone" variant="secondary" onPress={saveToPhone} busy={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.6)' },
});
