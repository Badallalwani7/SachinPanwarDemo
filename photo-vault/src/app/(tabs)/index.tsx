import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors, ui } from '../../components/theme';
import { VaultKeys } from '../../core/crypto';
import { GitHub } from '../../core/github';
import { GalleryItem, listGallery, loadThumbnail, setCurrentGallery } from '../../lib/gallery';
import { useReadySession } from '../../lib/session';

const COLUMNS = 3;
const GAP = 2;

export default function GalleryScreen() {
  const { github, session } = useReadySession();
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listGallery(github);
      setCurrentGallery(list);
      setItems(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [github]);

  // Reload when the tab is opened, so newly backed-up photos show up.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (items === null) {
    return (
      <View style={[ui.screen, ui.center]}>
        {error ? <Text style={ui.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }

  return (
    <View style={ui.screen}>
      {error ? <Text style={[ui.error, { padding: 12 }]}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} />}
        initialNumToRender={24}
        windowSize={7}
        renderItem={({ item, index }) => <Thumbnail item={item} size={size} github={github} keys={session.keys} index={index} />}
        ListEmptyComponent={
          <View style={ui.center}>
            <Text style={ui.heading}>No photos backed up yet</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>Photos from this phone upload automatically. Check the Backup tab for progress.</Text>
          </View>
        }
      />
    </View>
  );
}

type ThumbnailProps = { item: GalleryItem; size: number; github: GitHub; keys: VaultKeys; index: number };

const Thumbnail = memo(function Thumbnail({ item, size, github, keys, index }: ThumbnailProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadThumbnail(github, keys, item).then(
      (u) => !cancelled && setUri(u),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [github, keys, item]);

  return (
    <Pressable onPress={() => router.push({ pathname: '/photo/[id]', params: { id: item.id, index: String(index) } })}>
      <View style={[styles.cell, { width: size, height: size }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={item.id} />
        ) : failed ? (
          <Text style={ui.muted}>!</Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cell: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
