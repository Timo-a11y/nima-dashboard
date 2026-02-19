export interface OauthConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthState {
  configured: boolean;
  connected: boolean;
  email?: string;
}

export interface DesktopState {
  auth: AuthState;
  syncFolder: string | null;
}

export interface LocalFileEntry {
  relativePath: string;
  size: number;
  modifiedTime: string;
}

export interface DriveFileEntry {
  id: string;
  relativePath: string;
  size: number;
  modifiedTime: string;
}

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  skipped: number;
  failed: number;
  details: string[];
}
