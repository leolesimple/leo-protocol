import { mkdir, open, readdir, stat, writeFile } from "fs/promises"
import path from "path"

export class Storage {
  constructor(private basePath: string) {}

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.basePath, relativePath)
    if (!resolved.startsWith(path.resolve(this.basePath))) throw new Error("Invalid path")
    return resolved
  }

  async writeWholeFile(relativePath: string, data: Buffer): Promise<void> {
    const full = this.resolvePath(relativePath)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, data)
  }

  async writeChunk(relativePath: string, data: Buffer, offset: number): Promise<void> {
    const full = this.resolvePath(relativePath)
    await mkdir(path.dirname(full), { recursive: true })
    const handle = await open(full, "a+")
    await handle.write(data, 0, data.length, offset)
    await handle.close()
  }

  async readChunk(relativePath: string, offset: number, length: number): Promise<Buffer> {
    const full = this.resolvePath(relativePath)
    const handle = await open(full, "r")
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    await handle.close()
    return buffer.subarray(0, bytesRead)
  }

  async fileSize(relativePath: string): Promise<number> {
    const full = this.resolvePath(relativePath)
    const st = await stat(full)
    return st.size
  }

  async list(relativePath: string): Promise<Array<{ name: string; type: "file" | "dir"; size?: number }>> {
    const full = this.resolvePath(relativePath)
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
  }
}
