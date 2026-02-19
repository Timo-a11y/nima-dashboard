import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import type { OpenDialogOptions } from "electron";
import type {
  DesktopState,
  OauthConfig,
} from "../lib/desktop-types";
import { DriveSyncService } from "./drive-sync-service";

let mainWindow: BrowserWindow | null = null;
let driveSyncService: DriveSyncService;

const IPC_CHANNELS = {
  getState: "desktop:get-state",
  setOauthConfig: "desktop:set-oauth-config",
  connectGoogle: "desktop:connect-google",
  disconnectGoogle: "desktop:disconnect-google",
  pickSyncFolder: "desktop:pick-sync-folder",
  openSyncFolder: "desktop:open-sync-folder",
  listLocalFiles: "desktop:list-local-files",
  listDriveFiles: "desktop:list-drive-files",
  uploadFile: "desktop:upload-file",
  downloadFile: "desktop:download-file",
  runSync: "desktop:run-sync",
} as const;

function createMainWindow(): void {
  const preloadPath = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "Google Drive Desktop (MVP)",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl).catch((error: unknown) => {
      console.error("Kon renderer URL niet laden:", error);
    });
  } else {
    const staticIndexPath = path.join(__dirname, "..", "out", "index.html");
    mainWindow.loadFile(staticIndexPath).catch((error: unknown) => {
      console.error("Kon statische renderer niet laden:", error);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getState, async (): Promise<DesktopState> => {
    return {
      auth: driveSyncService.getAuthState(),
      syncFolder: driveSyncService.getSyncFolder(),
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.setOauthConfig,
    async (_event, config: OauthConfig) => {
      return driveSyncService.setOauthConfig(config);
    }
  );

  ipcMain.handle(IPC_CHANNELS.connectGoogle, async () => {
    return driveSyncService.connectGoogle();
  });

  ipcMain.handle(IPC_CHANNELS.disconnectGoogle, async () => {
    return driveSyncService.disconnectGoogle();
  });

  ipcMain.handle(IPC_CHANNELS.pickSyncFolder, async () => {
    const dialogOptions: OpenDialogOptions = {
      title: "Kies een lokale sync-map",
      defaultPath: driveSyncService.getSyncFolder() ?? app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return driveSyncService.getSyncFolder();
    }

    return driveSyncService.setSyncFolder(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.openSyncFolder, async () => {
    const syncFolder = driveSyncService.getSyncFolder();
    if (!syncFolder) {
      return false;
    }
    const openResult = await shell.openPath(syncFolder);
    return openResult.length === 0;
  });

  ipcMain.handle(IPC_CHANNELS.listLocalFiles, async () => {
    return driveSyncService.listLocalFiles();
  });

  ipcMain.handle(IPC_CHANNELS.listDriveFiles, async () => {
    return driveSyncService.listDriveFiles();
  });

  ipcMain.handle(IPC_CHANNELS.uploadFile, async (_event, relativePath: string) => {
    return driveSyncService.uploadFile(relativePath);
  });

  ipcMain.handle(
    IPC_CHANNELS.downloadFile,
    async (_event, payload: { fileId: string; relativePath: string }) => {
      return driveSyncService.downloadFile(payload.fileId, payload.relativePath);
    }
  );

  ipcMain.handle(IPC_CHANNELS.runSync, async () => {
    return driveSyncService.runSync();
  });
}

app.whenReady().then(async () => {
  driveSyncService = new DriveSyncService(app.getPath("userData"));
  await driveSyncService.init();
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
