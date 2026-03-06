import RNFS from 'react-native-fs';

const TOKEN_FILE = `${RNFS.DocumentDirectoryPath}/auth_token.json`;

interface AuthData {
  token: string;
  userId: string;
}

export async function saveAuthData(data: AuthData): Promise<void> {
  await RNFS.writeFile(TOKEN_FILE, JSON.stringify(data), 'utf8');
}

export async function loadAuthData(): Promise<AuthData | null> {
  try {
    const exists = await RNFS.exists(TOKEN_FILE);
    if (!exists) return null;
    const raw = await RNFS.readFile(TOKEN_FILE, 'utf8');
    return JSON.parse(raw) as AuthData;
  } catch {
    return null;
  }
}

export async function clearAuthData(): Promise<void> {
  try {
    const exists = await RNFS.exists(TOKEN_FILE);
    if (exists) await RNFS.unlink(TOKEN_FILE);
  } catch {}
}
