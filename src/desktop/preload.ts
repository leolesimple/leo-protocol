import { contextBridge, ipcRenderer } from "electron"
import { ListResult } from "../protocol.ts"

type ConnectPayload = { host: string; port: number; username: string; password: string }
type PathPayload = { path: string }
type PutPayload = { localPath: string; remotePath: string }
type GetPayload = { remotePath: string; localPath: string }

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

type Api = {
  connect(payload: ConnectPayload): Promise<Result<null>>
  list(payload: PathPayload): Promise<Result<ListResult>>
  put(payload: PutPayload): Promise<Result<null>>
  get(payload: GetPayload): Promise<Result<null>>
  bye(): Promise<Result<null>>
  selectOpen(): Promise<Result<string>>
  selectSave(): Promise<Result<string>>
}

const api: Api = {
  connect: payload => ipcRenderer.invoke("leo-connect", payload),
  list: payload => ipcRenderer.invoke("leo-list", payload),
  put: payload => ipcRenderer.invoke("leo-put", payload),
  get: payload => ipcRenderer.invoke("leo-get", payload),
  bye: () => ipcRenderer.invoke("leo-bye"),
  selectOpen: () => ipcRenderer.invoke("leo-select-open"),
  selectSave: () => ipcRenderer.invoke("leo-select-save")
}

contextBridge.exposeInMainWorld("leo", api)

declare global {
  interface Window {
    leo: Api
  }
}
