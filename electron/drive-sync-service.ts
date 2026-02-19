import { shell } from "electron";
import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { google, drive_v3 } from "googleapis";
import mime from "mime-types";
import type {
  AuthState,
  DriveFileEntry,
  LocalFileEntry,
  OauthConfig,
  SyncSummary,
} from "../lib/desktop-types";

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const REMOTE_ROOT_FOLDER_NAME = "Cursor Google Drive Desktop Sync";
const OAUTH_CALLBACK_HOST = "127.0.0.1";
const OAUTH_CALLBACK_PORT = 53682;
const OAUTH_CALLBACK_PATH = "/oauth2callback";
const CLOCK_TOLERANCE_MS = 2_000;
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

interface PersistedSettings {
  oauthConfig?: OauthConfig;
  tokens?: Credentials;
  syncFolder?: string | null;
}

interface LocalFileInternal extends LocalFileEntry {
  absolutePath: string;
  mtimeMs: number;
}

interface DriveFileInternal extends DriveFileEntry {
  mimeType: string;
  mtimeMs: number;
}

export class DriveSyncService {
  private readonly settingsPath: string;
  private oauthConfig: OauthConfig | null = null;
  private syncFolder: string | null = null;
  private tokens: Credentials | null = null;
  private oauthClient: OAuth2Client | null = null;
  private driveClient: drive_v3.Drive | null = null;
  private userEmail: string | undefined;
  private remoteRootFolderId: string | null = null;
  private readonly folderIdCache = new Map<string, string>();

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, "google-drive-desktop.json");
  }

  async init(): Promise<void> {
    const persisted = await this.loadSettings();
    this.oauthConfig = persisted.oauthConfig ?? null;
    this.syncFolder = persisted.syncFolder ?? null;
    this.tokens = persisted.tokens ?? null;

    if (this.oauthConfig && this.tokens) {
      this.configureClients(this.oauthConfig, this.tokens);
      await this.refreshUserEmail();
      await this.persistCredentials();
    }
  }

  getAuthState(): AuthState {
    const configured =
      Boolean(this.oauthConfig?.clientId) && Boolean(this.oauthConfig?.clientSecret);
    const connected = Boolean(this.oauthClient && this.tokens);

    return {
      configured,
      connected,
      email: this.userEmail,
    };
  }

  getSyncFolder(): string | null {
    return this.syncFolder;
  }

  async setOauthConfig(config: OauthConfig): Promise<AuthState> {
    const clientId = config.clientId.trim();
    const clientSecret = config.clientSecret.trim();

    if (!clientId || !clientSecret) {
      throw new Error("Client ID en Client Secret zijn verplicht.");
    }

    this.oauthConfig = { clientId, clientSecret };
    this.tokens = null;
    this.userEmail = undefined;
    this.oauthClient = null;
    this.driveClient = null;
    this.remoteRootFolderId = null;
    this.folderIdCache.clear();
    await this.saveSettings();

    return this.getAuthState();
  }

  async connectGoogle(): Promise<AuthState> {
    if (!this.oauthConfig) {
      throw new Error("Stel eerst Google OAuth Client ID en Client Secret in.");
    }

    const oauthClient = new google.auth.OAuth2(
      this.oauthConfig.clientId,
      this.oauthConfig.clientSecret,
      this.getRedirectUri()
    );

    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: OAUTH_SCOPES,
    });

    const code = await this.waitForAuthorizationCode(authUrl);
    const tokenResponse = await oauthClient.getToken(code);

    if (!tokenResponse.tokens.access_token && !tokenResponse.tokens.refresh_token) {
      throw new Error("Google gaf geen geldige OAuth tokens terug.");
    }

    oauthClient.setCredentials(tokenResponse.tokens);
    this.configureClients(this.oauthConfig, tokenResponse.tokens);
    await this.refreshUserEmail();
    await this.saveSettings();

    return this.getAuthState();
  }

  async disconnectGoogle(): Promise<AuthState> {
    if (this.oauthClient?.credentials?.access_token) {
      try {
        await this.oauthClient.revokeCredentials();
      } catch {
        // Best effort revoke only.
      }
    }

    this.tokens = null;
    this.oauthClient = null;
    this.driveClient = null;
    this.userEmail = undefined;
    this.remoteRootFolderId = null;
    this.folderIdCache.clear();
    await this.saveSettings();

    return this.getAuthState();
  }

  async setSyncFolder(folderPath: string): Promise<string> {
    const resolvedPath = path.resolve(folderPath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error("De gekozen sync-map is geen directory.");
    }

    this.syncFolder = resolvedPath;
    await this.saveSettings();
    return resolvedPath;
  }

  async listLocalFiles(): Promise<LocalFileEntry[]> {
    const localMap = await this.scanLocalFiles();
    return Array.from(localMap.values())
      .map((entry) => ({
        relativePath: entry.relativePath,
        size: entry.size,
        modifiedTime: entry.modifiedTime,
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async listDriveFiles(): Promise<DriveFileEntry[]> {
    this.requireAuthenticatedClient();
    const remoteMap = await this.scanRemoteFiles();
    await this.persistCredentials();

    return Array.from(remoteMap.values())
      .map((entry) => ({
        id: entry.id,
        relativePath: entry.relativePath,
        size: entry.size,
        modifiedTime: entry.modifiedTime,
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async uploadFile(relativePath: string): Promise<DriveFileEntry> {
    this.requireAuthenticatedClient();
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const localAbsolutePath = this.resolveLocalFilePath(normalizedPath);
    const stat = await fs.stat(localAbsolutePath);
    if (!stat.isFile()) {
      throw new Error(`Bestand niet gevonden: ${normalizedPath}`);
    }

    const remoteParentPath = this.dirnamePosix(normalizedPath);
    const fileName = path.posix.basename(normalizedPath);
    const parentFolderId = await this.resolveRemoteFolderId(remoteParentPath, true);
    if (!parentFolderId) {
      throw new Error(`Kan remote map niet maken voor: ${remoteParentPath}`);
    }

    const drive = this.requireAuthenticatedClient();
    const existingRemoteFile = await this.findRemoteFileInFolder(parentFolderId, fileName);
    const mimeType = mime.lookup(fileName) || "application/octet-stream";
    const media = {
      mimeType: typeof mimeType === "string" ? mimeType : "application/octet-stream",
      body: createReadStream(localAbsolutePath),
    };

    let fileId = existingRemoteFile?.id ?? "";
    if (existingRemoteFile?.id) {
      const updatedFile = await drive.files.update({
        fileId: existingRemoteFile.id,
        media,
        requestBody: {
          modifiedTime: stat.mtime.toISOString(),
        },
        fields: "id",
      });
      fileId = updatedFile.data.id ?? existingRemoteFile.id;
    } else {
      const createdFile = await drive.files.create({
        media,
        requestBody: {
          name: fileName,
          parents: [parentFolderId],
          modifiedTime: stat.mtime.toISOString(),
        },
        fields: "id",
      });
      fileId = createdFile.data.id ?? "";
    }

    if (!fileId) {
      throw new Error(`Upload mislukt voor ${normalizedPath}`);
    }

    await this.persistCredentials();
    return {
      id: fileId,
      relativePath: normalizedPath,
      size: stat.size,
      modifiedTime: stat.mtime.toISOString(),
    };
  }

  async downloadFile(fileId: string, relativePath: string): Promise<LocalFileEntry> {
    this.requireAuthenticatedClient();
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const metadata = await this.fetchRemoteMetadata(fileId);

    if (metadata.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
      throw new Error("Folders kunnen niet als bestand gedownload worden.");
    }

    const remoteEntry: DriveFileInternal = {
      id: metadata.id ?? fileId,
      relativePath: normalizedPath,
      size: Number(metadata.size ?? 0),
      modifiedTime: metadata.modifiedTime ?? new Date().toISOString(),
      mtimeMs: Date.parse(metadata.modifiedTime ?? new Date().toISOString()),
      mimeType: metadata.mimeType ?? "application/octet-stream",
    };

    const downloaded = await this.downloadRemoteEntry(remoteEntry);
    await this.persistCredentials();
    return downloaded;
  }

  async runSync(): Promise<SyncSummary> {
    this.requireAuthenticatedClient();

    const summary: SyncSummary = {
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    const localFiles = await this.scanLocalFiles();
    const remoteFiles = await this.scanRemoteFiles();
    const allPaths = Array.from(
      new Set([...localFiles.keys(), ...remoteFiles.keys()])
    ).sort((a, b) => a.localeCompare(b));

    for (const relativePath of allPaths) {
      const localEntry = localFiles.get(relativePath);
      const remoteEntry = remoteFiles.get(relativePath);

      try {
        if (localEntry && !remoteEntry) {
          await this.uploadFile(relativePath);
          summary.uploaded += 1;
          summary.details.push(`Upload: ${relativePath}`);
          continue;
        }

        if (!localEntry && remoteEntry) {
          await this.downloadRemoteEntry(remoteEntry);
          summary.downloaded += 1;
          summary.details.push(`Download: ${relativePath}`);
          continue;
        }

        if (!localEntry || !remoteEntry) {
          continue;
        }

        if (Math.abs(localEntry.mtimeMs - remoteEntry.mtimeMs) <= CLOCK_TOLERANCE_MS) {
          summary.skipped += 1;
          continue;
        }

        if (localEntry.mtimeMs > remoteEntry.mtimeMs) {
          await this.uploadFile(relativePath);
          summary.uploaded += 1;
          summary.details.push(`Update remote: ${relativePath}`);
        } else {
          await this.downloadRemoteEntry(remoteEntry);
          summary.downloaded += 1;
          summary.details.push(`Update local: ${relativePath}`);
        }
      } catch (error) {
        summary.failed += 1;
        summary.details.push(
          `Fout bij ${relativePath}: ${this.errorMessage(error)}`
        );
      }
    }

    await this.persistCredentials();
    return summary;
  }

  private configureClients(config: OauthConfig, tokens: Credentials): void {
    const oauthClient = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      this.getRedirectUri()
    );
    oauthClient.setCredentials(tokens);

    this.oauthClient = oauthClient;
    this.driveClient = google.drive({
      version: "v3",
      auth: oauthClient,
    });
    this.tokens = tokens;
  }

  private async refreshUserEmail(): Promise<void> {
    if (!this.oauthClient) {
      this.userEmail = undefined;
      return;
    }

    try {
      const oauth2 = google.oauth2({
        version: "v2",
        auth: this.oauthClient,
      });
      const userInfo = await oauth2.userinfo.get();
      this.userEmail = userInfo.data.email ?? undefined;
    } catch {
      this.userEmail = undefined;
    }
  }

  private async persistCredentials(): Promise<void> {
    if (!this.oauthClient) {
      return;
    }

    this.tokens = this.oauthClient.credentials;
    await this.saveSettings();
  }

  private requireAuthenticatedClient(): drive_v3.Drive {
    if (!this.driveClient) {
      throw new Error("Niet verbonden met Google Drive. Log eerst in.");
    }
    return this.driveClient;
  }

  private requireSyncFolder(): string {
    if (!this.syncFolder) {
      throw new Error("Kies eerst een lokale sync-map.");
    }
    return this.syncFolder;
  }

  private async loadSettings(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf8");
      return JSON.parse(raw) as PersistedSettings;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async saveSettings(): Promise<void> {
    const payload: PersistedSettings = {
      oauthConfig: this.oauthConfig ?? undefined,
      tokens: this.tokens ?? undefined,
      syncFolder: this.syncFolder,
    };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(payload, null, 2), "utf8");
  }

  private getRedirectUri(): string {
    return `http://${OAUTH_CALLBACK_HOST}:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  }

  private async waitForAuthorizationCode(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (cb: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        server.close(() => cb());
      };

      const server = createServer((request, response) => {
        const requestUrl = new URL(
          request.url ?? "",
          `http://${OAUTH_CALLBACK_HOST}:${OAUTH_CALLBACK_PORT}`
        );
        if (requestUrl.pathname !== OAUTH_CALLBACK_PATH) {
          response.statusCode = 404;
          response.end("Niet gevonden.");
          return;
        }

        const oauthError = requestUrl.searchParams.get("error");
        if (oauthError) {
          response.statusCode = 400;
          response.end(
            "Autorisatie geweigerd. Je kunt dit venster sluiten en opnieuw proberen."
          );
          finish(() =>
            reject(new Error(`Google OAuth geweigerd: ${oauthError}`))
          );
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          response.statusCode = 400;
          response.end("Geen OAuth code ontvangen.");
          finish(() =>
            reject(new Error("Google OAuth callback bevatte geen code."))
          );
          return;
        }

        response.statusCode = 200;
        response.end("Autorisatie geslaagd. Je kunt dit venster sluiten.");
        finish(() => resolve(code));
      });

      server.on("error", (error) => {
        finish(() => reject(error));
      });

      server.listen(OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_HOST, async () => {
        try {
          await shell.openExternal(authUrl);
        } catch (error) {
          finish(() =>
            reject(
              new Error(
                `Kan browser niet openen voor OAuth login: ${this.errorMessage(error)}`
              )
            )
          );
        }
      });

      const timeout = setTimeout(() => {
        finish(() =>
          reject(new Error("OAuth login timeout. Probeer opnieuw te verbinden."))
        );
      }, 180_000);
    });
  }

  private normalizeRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const safePath = path.posix.normalize(normalized);

    if (!safePath || safePath === ".") {
      throw new Error("Ongeldig bestandspad.");
    }
    if (path.posix.isAbsolute(safePath) || safePath.startsWith("..")) {
      throw new Error("Bestandspad mag niet buiten de sync-map vallen.");
    }

    return safePath;
  }

  private resolveLocalFilePath(relativePath: string): string {
    const syncFolder = this.requireSyncFolder();
    const normalized = this.normalizeRelativePath(relativePath);
    const absoluteSync = path.resolve(syncFolder);
    const absoluteFilePath = path.resolve(absoluteSync, normalized);

    const insideSyncFolder =
      absoluteFilePath === absoluteSync ||
      absoluteFilePath.startsWith(`${absoluteSync}${path.sep}`);

    if (!insideSyncFolder) {
      throw new Error("Bestandspad valt buiten de gekozen sync-map.");
    }

    return absoluteFilePath;
  }

  private async scanLocalFiles(): Promise<Map<string, LocalFileInternal>> {
    const syncFolder = this.requireSyncFolder();
    await fs.mkdir(syncFolder, { recursive: true });

    const files = new Map<string, LocalFileInternal>();
    await this.walkLocalDirectory(syncFolder, syncFolder, files);
    return files;
  }

  private async walkLocalDirectory(
    baseFolder: string,
    currentFolder: string,
    files: Map<string, LocalFileInternal>
  ): Promise<void> {
    const entries = await fs.readdir(currentFolder, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const absolutePath = path.join(currentFolder, entry.name);
      if (entry.isDirectory()) {
        await this.walkLocalDirectory(baseFolder, absolutePath, files);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      const relativePath = path
        .relative(baseFolder, absolutePath)
        .split(path.sep)
        .join("/");
      const modifiedTime = stat.mtime.toISOString();

      files.set(relativePath, {
        relativePath,
        absolutePath,
        size: stat.size,
        modifiedTime,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  private async scanRemoteFiles(): Promise<Map<string, DriveFileInternal>> {
    const rootFolderId = await this.getOrCreateRemoteRootFolderId();
    const files = new Map<string, DriveFileInternal>();
    await this.walkRemoteDirectory(rootFolderId, "", files);
    return files;
  }

  private async walkRemoteDirectory(
    folderId: string,
    relativePrefix: string,
    files: Map<string, DriveFileInternal>
  ): Promise<void> {
    const children = await this.listRemoteChildren(folderId);
    for (const child of children) {
      if (!child.id || !child.name) {
        continue;
      }

      const relativePath = relativePrefix
        ? `${relativePrefix}/${child.name}`
        : child.name;

      if (child.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
        this.folderIdCache.set(relativePath, child.id);
        await this.walkRemoteDirectory(child.id, relativePath, files);
        continue;
      }

      if (child.mimeType?.startsWith("application/vnd.google-apps.")) {
        continue;
      }

      const modifiedTime = child.modifiedTime ?? new Date(0).toISOString();
      const mtimeMs = Date.parse(modifiedTime);
      const nextValue: DriveFileInternal = {
        id: child.id,
        relativePath,
        size: Number(child.size ?? 0),
        modifiedTime,
        mtimeMs: Number.isNaN(mtimeMs) ? 0 : mtimeMs,
        mimeType: child.mimeType ?? "application/octet-stream",
      };

      const existing = files.get(relativePath);
      if (!existing || nextValue.mtimeMs >= existing.mtimeMs) {
        files.set(relativePath, nextValue);
      }
    }
  }

  private async listRemoteChildren(parentId: string): Promise<drive_v3.Schema$File[]> {
    const drive = this.requireAuthenticatedClient();
    const children: drive_v3.Schema$File[] = [];

    let pageToken: string | undefined;
    do {
      const response = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
        pageToken,
        pageSize: 250,
      });
      if (response.data.files) {
        children.push(...response.data.files);
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return children;
  }

  private async getOrCreateRemoteRootFolderId(): Promise<string> {
    if (this.remoteRootFolderId) {
      return this.remoteRootFolderId;
    }

    const drive = this.requireAuthenticatedClient();
    const escapedName = this.escapeForQuery(REMOTE_ROOT_FOLDER_NAME);
    const query = `'root' in parents and trashed = false and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and name = '${escapedName}'`;

    const existingFolderResponse = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      pageSize: 1,
    });
    let rootFolderId = existingFolderResponse.data.files?.[0]?.id;

    if (!rootFolderId) {
      const createdFolder = await drive.files.create({
        requestBody: {
          name: REMOTE_ROOT_FOLDER_NAME,
          mimeType: GOOGLE_FOLDER_MIME_TYPE,
          parents: ["root"],
        },
        fields: "id",
      });
      rootFolderId = createdFolder.data.id ?? "";
    }

    if (!rootFolderId) {
      throw new Error("Kon de remote root-map niet aanmaken in Google Drive.");
    }

    this.remoteRootFolderId = rootFolderId;
    this.folderIdCache.set("", rootFolderId);
    return rootFolderId;
  }

  private async resolveRemoteFolderId(
    relativeFolderPath: string,
    createIfMissing: boolean
  ): Promise<string | null> {
    const rootFolderId = await this.getOrCreateRemoteRootFolderId();
    const normalizedPath = relativeFolderPath.trim();
    if (!normalizedPath || normalizedPath === ".") {
      return rootFolderId;
    }

    const candidatePath = normalizedPath
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const safePath = path.posix.normalize(candidatePath);
    if (!safePath || safePath === ".") {
      return rootFolderId;
    }
    if (path.posix.isAbsolute(safePath) || safePath.startsWith("..")) {
      throw new Error("Ongeldig remote folder pad.");
    }

    if (!safePath) {
      return rootFolderId;
    }

    let currentFolderId = rootFolderId;
    let currentPath = "";
    const segments = safePath.split("/").filter(Boolean);

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const cachedFolderId = this.folderIdCache.get(currentPath);
      if (cachedFolderId) {
        currentFolderId = cachedFolderId;
        continue;
      }

      const existingFolder = await this.findRemoteFolderInParent(
        currentFolderId,
        segment
      );

      if (!existingFolder?.id) {
        if (!createIfMissing) {
          return null;
        }
        const createdFolder = await this.createRemoteFolder(currentFolderId, segment);
        currentFolderId = createdFolder;
      } else {
        currentFolderId = existingFolder.id;
      }

      this.folderIdCache.set(currentPath, currentFolderId);
    }

    return currentFolderId;
  }

  private async createRemoteFolder(parentId: string, name: string): Promise<string> {
    const drive = this.requireAuthenticatedClient();
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: GOOGLE_FOLDER_MIME_TYPE,
        parents: [parentId],
      },
      fields: "id",
    });

    if (!response.data.id) {
      throw new Error(`Kon remote folder niet maken: ${name}`);
    }

    return response.data.id;
  }

  private async findRemoteFolderInParent(
    parentId: string,
    folderName: string
  ): Promise<drive_v3.Schema$File | null> {
    const drive = this.requireAuthenticatedClient();
    const escapedName = this.escapeForQuery(folderName);
    const query = `'${parentId}' in parents and trashed = false and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and name = '${escapedName}'`;

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      pageSize: 1,
    });
    return response.data.files?.[0] ?? null;
  }

  private async findRemoteFileInFolder(
    parentId: string,
    fileName: string
  ): Promise<drive_v3.Schema$File | null> {
    const drive = this.requireAuthenticatedClient();
    const escapedName = this.escapeForQuery(fileName);
    const query = `'${parentId}' in parents and trashed = false and mimeType != '${GOOGLE_FOLDER_MIME_TYPE}' and name = '${escapedName}'`;

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name, modifiedTime, size)",
      pageSize: 1,
      orderBy: "modifiedTime desc",
    });
    return response.data.files?.[0] ?? null;
  }

  private async fetchRemoteMetadata(fileId: string): Promise<drive_v3.Schema$File> {
    const drive = this.requireAuthenticatedClient();
    const response = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, size",
    });
    return response.data;
  }

  private async downloadRemoteEntry(
    remoteFile: DriveFileInternal
  ): Promise<LocalFileEntry> {
    const drive = this.requireAuthenticatedClient();
    const targetAbsolutePath = this.resolveLocalFilePath(remoteFile.relativePath);
    const parentDirectory = path.dirname(targetAbsolutePath);
    await fs.mkdir(parentDirectory, { recursive: true });

    const response = await drive.files.get(
      { fileId: remoteFile.id, alt: "media" },
      { responseType: "stream" }
    );
    const readable = response.data as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      const writable = createWriteStream(targetAbsolutePath);
      writable.on("finish", resolve);
      writable.on("error", reject);
      readable.on("error", reject);
      readable.pipe(writable);
    });

    const remoteModifiedDate = new Date(remoteFile.modifiedTime);
    if (!Number.isNaN(remoteModifiedDate.getTime())) {
      await fs.utimes(targetAbsolutePath, new Date(), remoteModifiedDate);
    }

    const localStats = await fs.stat(targetAbsolutePath);
    return {
      relativePath: remoteFile.relativePath,
      size: localStats.size,
      modifiedTime: localStats.mtime.toISOString(),
    };
  }

  private dirnamePosix(relativePath: string): string {
    const dirname = path.posix.dirname(relativePath);
    return dirname === "." ? "" : dirname;
  }

  private escapeForQuery(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
