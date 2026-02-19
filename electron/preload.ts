import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthState,
  DesktopState,
  DriveFileEntry,
  LocalFileEntry,
  OauthConfig,
  SyncSummary,
} from "../lib/desktop-types";

const desktopAPI = {
  getState: (): Promise<DesktopState> => ipcRenderer.invoke("desktop:get-state"),
  setOauthConfig: (config: OauthConfig): Promise<AuthState> =>
    ipcRenderer.invoke("desktop:set-oauth-config", config),
  connectGoogle: (): Promise<AuthState> => ipcRenderer.invoke("desktop:connect-google"),
  disconnectGoogle: (): Promise<AuthState> =>
    ipcRenderer.invoke("desktop:disconnect-google"),
  pickSyncFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("desktop:pick-sync-folder"),
  openSyncFolder: (): Promise<boolean> => ipcRenderer.invoke("desktop:open-sync-folder"),
  listLocalFiles: (): Promise<LocalFileEntry[]> =>
    ipcRenderer.invoke("desktop:list-local-files"),
  listDriveFiles: (): Promise<DriveFileEntry[]> =>
    ipcRenderer.invoke("desktop:list-drive-files"),
  uploadFile: (relativePath: string): Promise<DriveFileEntry> =>
    ipcRenderer.invoke("desktop:upload-file", relativePath),
  downloadFile: (payload: {
    fileId: string;
    relativePath: string;
  }): Promise<LocalFileEntry> => ipcRenderer.invoke("desktop:download-file", payload),
  runSync: (): Promise<SyncSummary> => ipcRenderer.invoke("desktop:run-sync"),
};

contextBridge.exposeInMainWorld("desktopAPI", desktopAPI);
