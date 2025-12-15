import { mkdir, open, readdir, rm, stat, writeFile } from "fs/promises"
import path from "path"

export class StorageError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = "StorageError"
  }
}

export class Storage {
  constructor(private basePath: string) {}

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.basePath, relativePath)
    const safeRoot = path.resolve(this.basePath)
    if (!resolved.startsWith(safeRoot)) throw new StorageError("INVALID_PATH", "Chemin en dehors de la racine autorisée")
    return resolved
  }

  async writeWholeFile(relativePath: string, data: Buffer): Promise<void> {
    const full = this.resolvePath(relativePath)
    await mkdir(path.dirname(full), { recursive: true })
    try {
      await writeFile(full, data)
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  async writeChunk(relativePath: string, data: Buffer, offset: number): Promise<void> {
    const full = this.resolvePath(relativePath)
    await mkdir(path.dirname(full), { recursive: true })
    try {
      const handle = await open(full, "a+")
      await handle.write(data, 0, data.length, offset)
      await handle.close()
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  async readChunk(relativePath: string, offset: number, length: number): Promise<Buffer> {
    const full = this.resolvePath(relativePath)
    try {
      const handle = await open(full, "r")
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      await handle.close()
      return buffer.subarray(0, bytesRead)
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  async fileSize(relativePath: string): Promise<number> {
    const full = this.resolvePath(relativePath)
    try {
      const st = await stat(full)
      if (!st.isFile()) throw new StorageError("NOT_A_FILE", "Le chemin visé n'est pas un fichier")
      return st.size
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  async list(relativePath: string): Promise<Array<{ name: string; type: "file" | "dir"; size?: number }>> {
    const full = this.resolvePath(relativePath)
    try {
      const items = await readdir(full, { withFileTypes: true })
      const result = [] as Array<{ name: string; type: "file" | "dir"; size?: number }>
      for (const entry of items) {
        if (entry.isDirectory()) {
          result.push({ name: entry.name, type: "dir" })
        } else {
          const st = await stat(path.join(full, entry.name))
          result.push({ name: entry.name, type: "file", size: st.size })
        }
      }
      return result
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const full = this.resolvePath(relativePath)
    try {
      const st = await stat(full)
      if (!st.isFile()) throw new StorageError("NOT_A_FILE", "Le chemin visé n'est pas un fichier")
      await rm(full)
    } catch (err) {
      throw this.wrapFsError(err)
    }
  }

  private wrapFsError(err: unknown): StorageError {
    if (err instanceof StorageError) return err
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: string }).code
      if (code === "ENOENT") return new StorageError("FILE_NOT_FOUND", "Fichier introuvable")
      if (code === "EACCES" || code === "EPERM") return new StorageError("PERMISSION_DENIED", "Accès refusé")
    }
    return new StorageError("IO_ERROR", err instanceof Error ? err.message : "Erreur IO")
  }
}
