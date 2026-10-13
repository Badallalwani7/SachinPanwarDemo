import { requestPermissionsAsync } from 'expo-media-library';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { colors, ui } from '../components/theme';
import { GitHubError } from '../core/github';
import { WrongPassphraseError, openOrCreateVault } from '../core/vault';
import { createGitHub } from '../lib/github';
import { useSession } from '../lib/session';
import { DEFAULT_PREFS } from '../lib/storage';

export default function SetupScreen() {
  const { signIn } = useSession();
  const [repoName, setRepoName] = useState('');
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newVault, setNewVault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const connect = async () => {
    setError('');
    const [owner, repo] = repoName.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
    if (!owner || !repo) return setError('Enter the repository as owner/name, e.g. sachin/photo-vault');
    if (!token.trim()) return setError('Paste a GitHub access token');
    if (passphrase.length < 10) return setError('Use a passphrase of at least 10 characters');
    if (newVault && passphrase !== confirm) return setError('The passphrases do not match');

    setBusy(true);
    try {
      setProgress('Checking the repository…');
      const github = createGitHub({ token: token.trim(), owner, repo });
      const info = await github.getRepo();
      if (!info.private) throw new Error('This repository is public. Make it private first — Photo Vault refuses to use public repositories.');

      setProgress('Deriving your encryption key…');
      const { keys } = await openOrCreateVault(github, passphrase, {
        allowCreate: newVault,
        onProgress: (f) => setProgress(`Deriving your encryption key… ${Math.round(f * 100)}%`),
      });

      // Ask for photo access now so backups can start right away.
      await requestPermissionsAsync(false, ['photo']);

      await signIn({
        connection: { token: token.trim(), owner, repo, branch: info.defaultBranch },
        keys,
        prefs: { ...DEFAULT_PREFS, backupFrom: 0 },
      });
    } catch (e) {
      if (e instanceof WrongPassphraseError) setError('That passphrase does not unlock the vault in this repository.');
      else if (e instanceof GitHubError && e.status === 401) setError('GitHub rejected the token. Check that it is correct and not expired.');
      else if (e instanceof GitHubError && e.status === 404) setError('Repository not found. Check the name, and that the token has access to it.');
      else if (e instanceof Error && e.message === 'No vault found in this repository')
        setError('No vault in this repository yet. Switch on "Create a new vault" for your first phone.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <Text style={ui.muted}>
          {"Your photos are encrypted on this phone before upload. GitHub only ever stores scrambled data that can't be opened without your passphrase."}
        </Text>

        <View>
          <Text style={ui.label}>Private GitHub repository (owner/name)</Text>
          <TextInput style={ui.input} value={repoName} onChangeText={setRepoName} placeholder="sachin/photo-vault" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
        </View>

        <View>
          <Text style={ui.label}>GitHub access token</Text>
          <TextInput style={ui.input} value={token} onChangeText={setToken} placeholder="github_pat_…" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Text style={ui.muted}>{'Create a fine-grained token limited to this one repository, with "Contents: Read and write" permission.'}</Text>
        </View>

        <View style={ui.row}>
          <View style={{ flex: 1 }}>
            <Text style={ui.text}>Create a new vault</Text>
            <Text style={ui.muted}>On for your first phone. Off to connect another phone to an existing vault.</Text>
          </View>
          <Switch value={newVault} onValueChange={setNewVault} />
        </View>

        <View>
          <Text style={ui.label}>Vault passphrase</Text>
          <TextInput style={ui.input} value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        </View>
        {newVault && (
          <View>
            <Text style={ui.label}>Confirm passphrase</Text>
            <TextInput style={ui.input} value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <Text style={[ui.muted, { color: colors.danger }]}>
              Write this passphrase down somewhere safe. If you lose it, nobody — including you — can ever decrypt these photos.
            </Text>
          </View>
        )}

        {error ? <Text style={ui.error}>{error}</Text> : null}
        {progress ? <Text style={ui.muted}>{progress}</Text> : null}
        <Button title={newVault ? 'Create vault' : 'Unlock vault'} onPress={connect} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
