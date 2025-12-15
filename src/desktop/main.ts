import { app, BrowserWindow, ipcMain, dialog } from "electron"
import path from "path"
import { fileURLToPath } from "url"
import { LeoClient } from "../client/client.ts"
import { ListResult } from "../protocol.ts"

type ConnectPayload = { host: string; port: number; username: string; password: string }
type PathPayload = { path: string }
type PutPayload = { localPath: string; remotePath: string }
type GetPayload = { remotePath: string; localPath: string }

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const clients = new Map<number, LeoClient>()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getClient(senderId: number): LeoClient {
  const client = clients.get(senderId)
  if (!client) throw new Error("Not connected")
  return client
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "LEO Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.ts"),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, "index.html"))
}

ipcMain.handle("leo-connect", async (event, payload: ConnectPayload): Promise<Result<null>> => {
  try {
    const client = new LeoClient()
    await client.connect(payload.host, payload.port)
    await client.auth(payload.username, payload.password)
    const existing = clients.get(event.sender.id)
    if (existing) await existing.bye()
    clients.set(event.sender.id, client)
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-list", async (event, payload: PathPayload): Promise<Result<ListResult>> => {
  try {
    const client = getClient(event.sender.id)
    const result = await client.list(payload.path)
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-put", async (event, payload: PutPayload): Promise<Result<null>> => {
  try {
    const client = getClient(event.sender.id)
    await client.put(payload.localPath, payload.remotePath)
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-get", async (event, payload: GetPayload): Promise<Result<null>> => {
  try {
    const client = getClient(event.sender.id)
    await client.get(payload.remotePath, payload.localPath)
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-bye", async (event): Promise<Result<null>> => {
  try {
    const client = getClient(event.sender.id)
    await client.bye()
    clients.delete(event.sender.id)
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-select-open", async (): Promise<Result<string>> => {
  try {
    const res = await dialog.showOpenDialog({ properties: ["openFile"] })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, error: "No file selected" }
    return { ok: true, data: res.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle("leo-select-save", async (): Promise<Result<string>> => {
  try {
    const res = await dialog.showSaveDialog({})
    if (res.canceled || !res.filePath) return { ok: false, error: "No destination selected" }
    return { ok: true, data: res.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  const tasks = Array.from(clients.values()).map(client => client.bye().catch(() => {}))
  clients.clear()
  Promise.all(tasks).finally(() => {
    if (process.platform !== "darwin") app.quit()
  })
})
