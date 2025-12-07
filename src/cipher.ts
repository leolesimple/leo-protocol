import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

export function encryptAesGcm(key: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag])
}

export function decryptAesGcm(key: Buffer, data: Buffer): Buffer {
  if (data.length < 28) throw new Error("Invalid data")
  const nonce = data.subarray(0, 12)
  const tag = data.subarray(data.length - 16)
  const ciphertext = data.subarray(12, data.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
