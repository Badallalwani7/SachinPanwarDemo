import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';

import { setRandomSource } from '../core/crypto';
import { FetchLike, GitHub } from '../core/github';
import type { Connection } from './storage';

// Hermes has no WebCrypto; use the OS random number generator via expo-crypto.
setRandomSource((length) => Crypto.getRandomBytes(length));

export function createGitHub(connection: Partial<Connection> & Pick<Connection, 'token' | 'owner' | 'repo'>) {
  return new GitHub({
    token: connection.token,
    owner: connection.owner,
    repo: connection.repo,
    branch: connection.branch,
    // expo/fetch supports reading binary bodies natively (needed for photos).
    fetch: expoFetch as unknown as FetchLike,
  });
}
