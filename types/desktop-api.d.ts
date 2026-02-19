import type {
  AuthState,
  DesktopState,
  DriveFileEntry,
  LocalFileEntry,
  OauthConfig,
  SyncSummary,
} from "../lib/desktop-types";

declare global {
  interface Window {
    desktopAPI?: {
      getState: () => Promise<DesktopState>;
      setOauthConfig: (config: OauthConfig) => Promise<AuthState>;
      connectGoogle: () => Promise<AuthState>;
      disconnectGoogle: () => Promise<AuthState>;
      pickSyncFolder: () => Promise<string | null>;
      openSyncFolder: () => Promise<boolean>;
      listLocalFiles: () => Promise<LocalFileEntry[]>;
      listDriveFiles: () => Promise<DriveFileEntry[]>;
      uploadFile: (relativePath: string) => Promise<DriveFileEntry>;
      downloadFile: (payload: {
        fileId: string;
        relativePath: string;
      }) => Promise<LocalFileEntry>;
      runSync: () => Promise<SyncSummary>;
    };
  }
}

export {};
