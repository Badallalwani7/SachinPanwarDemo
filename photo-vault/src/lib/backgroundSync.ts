// Lets the OS wake the app periodically to back up new photos even when it
// isn't open. Android runs it roughly on the requested interval; iOS decides
// for itself (often overnight while charging).

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { loadStoredSession } from './storage';
import { runSync } from './sync';

const TASK_NAME = 'photo-vault-backup';

// Must run at module load (global scope), so this file is imported from the root layout.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const session = await loadStoredSession();
    if (session?.prefs.autoBackup) {
      // iOS gives background tasks about 30 seconds; stop early and continue next time.
      await runSync(session, { budgetMs: 25_000 });
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('Background backup failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setBackgroundSyncEnabled(enabled: boolean) {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (enabled && !registered) {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
    }
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(TASK_NAME);
  }
}
