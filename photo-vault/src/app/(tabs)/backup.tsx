import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { colors, ui } from '../../components/theme';
import { clearCache } from '../../lib/gallery';
import { useReadySession } from '../../lib/session';
import { SyncStatus, readSyncStatus } from '../../lib/storage';
import { SyncProgress, runSync, subscribeToSync } from '../../lib/sync';

export default function BackupScreen() {
  const { session, github, updatePrefs, signOut } = useReadySession();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [status, setStatus] = useState<SyncStatus>(readSyncStatus);
  const [repoSize, setRepoSize] = useState<number | null>(null);
  const { prefs, connection } = session;

  useEffect(
    () =>
      subscribeToSync((next) => {
        setProgress(next);
        // A run just finished (or nothing is running): show its result.
        if (!next.running) setStatus(readSyncStatus());
      }),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      setStatus(readSyncStatus());
      github.getRepo().then((r) => setRepoSize(r.sizeKb), () => {});
    }, [github]),
  );

  const backUpNow = () => {
    runSync(session, { ignoreWifiOnly: true }).catch((e) => Alert.alert('Backup failed', e instanceof Error ? e.message : String(e)));
  };

  const confirmSignOut = () =>
    Alert.alert('Disconnect this phone?', 'Photos already on GitHub stay there. You will need the token and passphrase to reconnect.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => signOut() },
    ]);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <View style={ui.card}>
        <Text style={ui.heading}>Status</Text>
        {progress?.running ? (
          <>
            <Text style={ui.text}>{progress.message}</Text>
            {progress.total > 0 && <Text style={ui.muted}>{progress.done} of {progress.total} photos</Text>}
          </>
        ) : (
          <>
            <Text style={ui.text}>
              {status.lastSuccessAt ? `Last backup ${new Date(status.lastSuccessAt).toLocaleString()}` : 'Not backed up yet'}
            </Text>
            {status.pending ? <Text style={ui.muted}>{status.pending} photo(s) still waiting to upload</Text> : null}
            {status.uploaded ? <Text style={ui.muted}>{status.uploaded} photo(s) uploaded from this phone</Text> : null}
          </>
        )}
        {status.lastError && !progress?.running ? <Text style={ui.error}>Last error: {status.lastError}</Text> : null}
        <Button title="Back up now" onPress={backUpNow} busy={progress?.running} />
      </View>

      <View style={ui.card}>
        <Text style={ui.heading}>Automatic backup</Text>
        <Setting
          title="Back up new photos automatically"
          detail="When the app opens, when you take a photo, and periodically in the background."
          value={prefs.autoBackup}
          onChange={(autoBackup) => updatePrefs({ autoBackup })}
        />
        <Setting
          title="Only on Wi-Fi"
          detail="Avoids using mobile data. 'Back up now' ignores this."
          value={prefs.wifiOnly}
          onChange={(wifiOnly) => updatePrefs({ wifiOnly })}
        />
        <Setting
          title="Include photos taken before setup"
          detail={prefs.backupFrom ? `Only photos since ${new Date(prefs.backupFrom).toLocaleDateString()}` : 'Your whole photo library is backed up.'}
          value={prefs.backupFrom === 0}
          onChange={(all) => updatePrefs({ backupFrom: all ? 0 : Date.now() })}
        />
      </View>

      <View style={ui.card}>
        <Text style={ui.heading}>Repository</Text>
        <Text style={ui.text}>
          {connection.owner}/{connection.repo}
        </Text>
        {repoSize !== null && <Text style={ui.muted}>About {(repoSize / 1024 / 1024).toFixed(2)} GB used on GitHub</Text>}
        <Text style={ui.muted}>
          GitHub recommends keeping repositories under a few GB. When this one gets large, create a new private repository and
          connect to it.
        </Text>
        <Button
          title="Clear decrypted cache"
          variant="secondary"
          onPress={() => {
            clearCache();
            Alert.alert('Cache cleared', 'Decrypted copies on this phone were removed.');
          }}
        />
        <Button title="Disconnect this phone" variant="danger" onPress={confirmSignOut} />
      </View>
    </ScrollView>
  );
}

function Setting(props: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={ui.row}>
      <View style={{ flex: 1 }}>
        <Text style={ui.text}>{props.title}</Text>
        <Text style={ui.muted}>{props.detail}</Text>
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.accent }} />
    </View>
  );
}
