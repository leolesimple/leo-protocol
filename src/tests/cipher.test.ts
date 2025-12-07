import { describe, expect, it } from "vitest"
import { randomBytes } from "crypto"
import { encryptAesGcm, decryptAesGcm } from "../cipher.ts"

describe("cipher", () => {
  it("encrypts and decrypts", () => {
    const key = randomBytes(32)
    const data = randomBytes(256)
    const encrypted = encryptAesGcm(key, data)
    const decrypted = decryptAesGcm(key, encrypted)
    expect(decrypted.equals(data)).toBe(true)
  })
})
