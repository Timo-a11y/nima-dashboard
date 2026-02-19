"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesktopState,
  DriveFileEntry,
  LocalFileEntry,
  OauthConfig,
  SyncSummary,
} from "@/lib/desktop-types";

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("nl-NL");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function DriveDesktopPage() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [state, setState] = useState<DesktopState | null>(null);
  const [oauthConfig, setOauthConfig] = useState<OauthConfig>({
    clientId: "",
    clientSecret: "",
  });
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileEntry[]>([]);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runAction = useCallback(async <T,>(
    label: string,
    action: () => Promise<T>
  ): Promise<T | undefined> => {
    setBusyAction(label);
    setErrorMessage(null);
    try {
      return await action();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return undefined;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const refreshState = useCallback(async () => {
    if (!window.desktopAPI) {
      return;
    }
    const nextState = await window.desktopAPI.getState();
    setState(nextState);
  }, []);

  const refreshLocalFiles = useCallback(async () => {
    if (!window.desktopAPI) {
      return;
    }
    if (!state?.syncFolder) {
      setLocalFiles([]);
      return;
    }
    const files = await window.desktopAPI.listLocalFiles();
    setLocalFiles(files);
  }, [state?.syncFolder]);

  const refreshDriveFiles = useCallback(async () => {
    if (!window.desktopAPI) {
      return;
    }
    if (!state?.auth.connected) {
      setDriveFiles([]);
      return;
    }
    const files = await window.desktopAPI.listDriveFiles();
    setDriveFiles(files);
  }, [state?.auth.connected]);

  const refreshAll = useCallback(async () => {
    await refreshState();
    if (window.desktopAPI) {
      const latestState = await window.desktopAPI.getState();
      setState(latestState);
      if (latestState.syncFolder) {
        const latestLocalFiles = await window.desktopAPI.listLocalFiles();
        setLocalFiles(latestLocalFiles);
      } else {
        setLocalFiles([]);
      }
      if (latestState.auth.connected) {
        const latestDriveFiles = await window.desktopAPI.listDriveFiles();
        setDriveFiles(latestDriveFiles);
      } else {
        setDriveFiles([]);
      }
    }
  }, [refreshState]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.desktopAPI) {
      setIsDesktop(true);
      void runAction("Initialiseren", refreshAll);
    } else {
      setIsDesktop(false);
    }
  }, [refreshAll, runAction]);

  const canManageDrive = useMemo(() => {
    return Boolean(state?.auth.connected && state.syncFolder);
  }, [state]);

  const handleSaveOauthConfig = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("OAuth opslaan", async () => {
      const authState = await desktopAPI.setOauthConfig(oauthConfig);
      setState((previous) => ({
        auth: authState,
        syncFolder: previous?.syncFolder ?? null,
      }));
      setDriveFiles([]);
      setSyncSummary(null);
    });
  };

  const handleConnectGoogle = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Google verbinden", async () => {
      await desktopAPI.connectGoogle();
      await refreshAll();
    });
  };

  const handleDisconnectGoogle = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Google ontkoppelen", async () => {
      await desktopAPI.disconnectGoogle();
      await refreshAll();
      setDriveFiles([]);
      setSyncSummary(null);
    });
  };

  const handlePickSyncFolder = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Sync-map kiezen", async () => {
      await desktopAPI.pickSyncFolder();
      await refreshAll();
      setSyncSummary(null);
    });
  };

  const handleOpenSyncFolder = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Sync-map openen", async () => {
      await desktopAPI.openSyncFolder();
    });
  };

  const handleUploadLocalFile = async (relativePath: string): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Bestand uploaden", async () => {
      await desktopAPI.uploadFile(relativePath);
      await refreshDriveFiles();
    });
  };

  const handleDownloadDriveFile = async (entry: DriveFileEntry): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Bestand downloaden", async () => {
      await desktopAPI.downloadFile({
        fileId: entry.id,
        relativePath: entry.relativePath,
      });
      await refreshLocalFiles();
    });
  };

  const handleSyncNow = async (): Promise<void> => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) {
      return;
    }
    await runAction("Synchroniseren", async () => {
      const result = await desktopAPI.runSync();
      setSyncSummary(result);
      await refreshAll();
    });
  };

  const disabled = Boolean(busyAction);

  if (!isDesktop) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <h1 className="text-2xl font-semibold mb-4">Google Drive Desktop (MVP)</h1>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Deze interface is bedoeld voor de Electron desktop-app. Start de app met
            <code className="ml-2 rounded bg-zinc-800 px-2 py-1 text-zinc-100">
              npm run dev:desktop
            </code>
            .
          </p>
          <p className="text-zinc-400 text-sm">
            Voor macOS packaging kun je daarna
            <code className="ml-2 rounded bg-zinc-800 px-2 py-1 text-zinc-100">
              npm run dist:mac
            </code>
            gebruiken.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-2xl font-semibold">Google Drive Desktop (macOS MVP)</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Handmatige sync-client met OAuth, lokale sync-map en bidirectionele
            sync tussen lokaal en Google Drive.
          </p>
          <p className="mt-3 text-sm text-zinc-300">
            Status:{" "}
            {state?.auth.connected
              ? `Verbonden${state.auth.email ? ` als ${state.auth.email}` : ""}`
              : "Niet verbonden"}
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-medium mb-3">1) Google OAuth configuratie</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Gebruik een Google OAuth Client ID + Client Secret. Voeg in Google
              Cloud Console als redirect URI toe:
              <code className="ml-2 rounded bg-zinc-800 px-2 py-1 text-zinc-100">
                http://127.0.0.1:53682/oauth2callback
              </code>
            </p>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                placeholder="Google OAuth Client ID"
                value={oauthConfig.clientId}
                onChange={(event) =>
                  setOauthConfig((current) => ({
                    ...current,
                    clientId: event.target.value,
                  }))
                }
              />
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                placeholder="Google OAuth Client Secret"
                value={oauthConfig.clientSecret}
                onChange={(event) =>
                  setOauthConfig((current) => ({
                    ...current,
                    clientSecret: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                onClick={() => void handleSaveOauthConfig()}
                disabled={disabled}
              >
                OAuth opslaan
              </button>
              <button
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                onClick={() => void handleConnectGoogle()}
                disabled={disabled}
              >
                Verbinden met Google
              </button>
              <button
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
                onClick={() => void handleDisconnectGoogle()}
                disabled={disabled || !state?.auth.connected}
              >
                Ontkoppelen
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-medium mb-3">2) Lokale sync-map</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Kies de map die je wilt synchroniseren. Deze app gebruikt een
              dedicated Drive-map:
              <span className="ml-2 text-zinc-200">"Cursor Google Drive Desktop Sync"</span>
            </p>
            <p className="text-sm text-zinc-300 break-all">
              {state?.syncFolder ?? "Nog geen map gekozen"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                onClick={() => void handlePickSyncFolder()}
                disabled={disabled}
              >
                Sync-map kiezen
              </button>
              <button
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
                onClick={() => void handleOpenSyncFolder()}
                disabled={disabled || !state?.syncFolder}
              >
                Open map in Finder
              </button>
              <button
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500 disabled:opacity-50"
                onClick={() => void handleSyncNow()}
                disabled={disabled || !canManageDrive}
              >
                Nu synchroniseren
              </button>
            </div>
          </article>
        </section>

        {busyAction ? (
          <div className="rounded-xl border border-indigo-700/60 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-200">
            Bezig: {busyAction}...
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-xl border border-red-700/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            Fout: {errorMessage}
          </div>
        ) : null}

        {syncSummary ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-medium mb-3">Laatste sync-resultaat</h2>
            <div className="grid gap-2 text-sm text-zinc-300 md:grid-cols-4">
              <p>Geupload: {syncSummary.uploaded}</p>
              <p>Gedownload: {syncSummary.downloaded}</p>
              <p>Overgeslagen: {syncSummary.skipped}</p>
              <p>Mislukt: {syncSummary.failed}</p>
            </div>
            <ul className="mt-4 max-h-36 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 space-y-1">
              {syncSummary.details.length > 0 ? (
                syncSummary.details.map((detail, index) => (
                  <li key={`${index}-${detail}`}>{detail}</li>
                ))
              ) : (
                <li>Geen wijzigingen.</li>
              )}
            </ul>
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">Lokale bestanden</h2>
              <button
                className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-50"
                onClick={() =>
                  void runAction("Lokale lijst verversen", refreshLocalFiles)
                }
                disabled={disabled || !state?.syncFolder}
              >
                Verversen
              </button>
            </div>

            <ul className="space-y-2 max-h-[24rem] overflow-auto">
              {localFiles.length > 0 ? (
                localFiles.map((file) => (
                  <li
                    key={file.relativePath}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <p className="text-sm text-zinc-100 break-all">{file.relativePath}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {formatBytes(file.size)} · gewijzigd {formatDate(file.modifiedTime)}
                    </p>
                    <button
                      className="mt-2 rounded-md bg-indigo-600 px-3 py-1 text-xs hover:bg-indigo-500 disabled:opacity-50"
                      onClick={() => void handleUploadLocalFile(file.relativePath)}
                      disabled={disabled || !state?.auth.connected}
                    >
                      Upload naar Drive
                    </button>
                  </li>
                ))
              ) : (
                <li className="text-sm text-zinc-500">Geen lokale bestanden gevonden.</li>
              )}
            </ul>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">Drive bestanden</h2>
              <button
                className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-50"
                onClick={() =>
                  void runAction("Drive lijst verversen", refreshDriveFiles)
                }
                disabled={disabled || !state?.auth.connected}
              >
                Verversen
              </button>
            </div>

            <ul className="space-y-2 max-h-[24rem] overflow-auto">
              {driveFiles.length > 0 ? (
                driveFiles.map((file) => (
                  <li
                    key={`${file.id}-${file.relativePath}`}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <p className="text-sm text-zinc-100 break-all">{file.relativePath}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {formatBytes(file.size)} · gewijzigd {formatDate(file.modifiedTime)}
                    </p>
                    <button
                      className="mt-2 rounded-md bg-emerald-600 px-3 py-1 text-xs hover:bg-emerald-500 disabled:opacity-50"
                      onClick={() => void handleDownloadDriveFile(file)}
                      disabled={disabled || !state?.syncFolder}
                    >
                      Download naar lokaal
                    </button>
                  </li>
                ))
              ) : (
                <li className="text-sm text-zinc-500">Geen Drive bestanden gevonden.</li>
              )}
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
