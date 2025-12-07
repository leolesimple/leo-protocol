import { readdir } from "fs/promises"
import path from "path"
import { LeoClient } from "./client.ts"

export async function syncDirectory(client: LeoClient, localDir: string, remotePrefix: string): Promise<void> {
  const entries = await readdir(localDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(localDir, entry.name)
    const remotePath = path.join(remotePrefix, entry.name)
    if (entry.isDirectory()) {
      await syncDirectory(client, fullPath, remotePath)
    } else {
      await client.put(fullPath, remotePath)
    }
  }
}
