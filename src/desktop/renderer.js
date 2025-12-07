const statusEl = document.getElementById("status")
const connectForm = document.getElementById("connect-form")
const connectBtn = document.getElementById("connect-btn")
const listBtn = document.getElementById("list-btn")
const listPathInput = document.getElementById("list-path")
const listTableBody = document.querySelector("#list-table tbody")
const uploadLocalInput = document.getElementById("upload-local")
const uploadRemoteInput = document.getElementById("upload-remote")
const uploadBtn = document.getElementById("upload-btn")
const chooseUploadBtn = document.getElementById("choose-upload")
const downloadRemoteInput = document.getElementById("download-remote")
const downloadLocalInput = document.getElementById("download-local")
const downloadBtn = document.getElementById("download-btn")
const chooseDownloadBtn = document.getElementById("choose-download")
const logEl = document.getElementById("log")
const byeBtn = document.getElementById("bye-btn")

let connected = false

function setStatus(text, ok = true) {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.style.color = ok ? "#22c55e" : "#f97316"
}

function log(message) {
  if (!logEl) return
  const now = new Date().toISOString()
  logEl.textContent = `${now} ${message}\n${logEl.textContent}`
}

function requireConnected() {
  if (!connected) {
    setStatus("Non connecté", false)
    return false
  }
  return true
}

connectForm?.addEventListener("submit", async e => {
  e.preventDefault()
  connectBtn.disabled = true
  setStatus("Connexion en cours...")
  const host = document.getElementById("host")?.value ?? "127.0.0.1"
  const portValue = document.getElementById("port")?.value ?? "9000"
  const port = Number(portValue)
  const username = document.getElementById("username")?.value ?? "user"
  const password = document.getElementById("password")?.value ?? "pass"
  const res = await window.leo.connect({ host, port, username, password })
  connectBtn.disabled = false
  if (res.ok) {
    connected = true
    setStatus("Connecté")
    log(`Connecté à ${host}:${port}`)
  } else {
    connected = false
    setStatus(res.error, false)
    log(res.error)
  }
})

listBtn?.addEventListener("click", async () => {
  if (!requireConnected()) return
  listBtn.disabled = true
  const res = await window.leo.list({ path: listPathInput?.value ?? "." })
  listBtn.disabled = false
  if (!res.ok) {
    setStatus(res.error, false)
    log(res.error)
    return
  }
  if (listTableBody) {
    listTableBody.innerHTML = ""
    for (const item of res.data.items) {
      const row = document.createElement("tr")
      const name = document.createElement("td")
      name.textContent = item.name
      const type = document.createElement("td")
      type.textContent = item.type
      const size = document.createElement("td")
      size.textContent = item.size ? `${item.size}` : ""
      row.appendChild(name)
      row.appendChild(type)
      row.appendChild(size)
      listTableBody.appendChild(row)
    }
  }
  setStatus("Listing mis à jour")
  log(`List ${listPathInput?.value ?? "."}`)
})

chooseUploadBtn?.addEventListener("click", async () => {
  const res = await window.leo.selectOpen()
  if (res.ok && uploadLocalInput) uploadLocalInput.value = res.data
})

uploadBtn?.addEventListener("click", async () => {
  if (!requireConnected()) return
  uploadBtn.disabled = true
  const localPath = uploadLocalInput?.value ?? ""
  const remotePath = uploadRemoteInput?.value ?? ""
  if (!localPath || !remotePath) {
    setStatus("Chemins requis", false)
    uploadBtn.disabled = false
    return
  }
  const res = await window.leo.put({ localPath, remotePath })
  uploadBtn.disabled = false
  if (res.ok) {
    setStatus("Upload terminé")
    log(`Upload ${localPath} -> ${remotePath}`)
  } else {
    setStatus(res.error, false)
    log(res.error)
  }
})

chooseDownloadBtn?.addEventListener("click", async () => {
  const res = await window.leo.selectSave()
  if (res.ok && downloadLocalInput) downloadLocalInput.value = res.data
})

downloadBtn?.addEventListener("click", async () => {
  if (!requireConnected()) return
  downloadBtn.disabled = true
  const remotePath = downloadRemoteInput?.value ?? ""
  const localPath = downloadLocalInput?.value ?? ""
  if (!remotePath || !localPath) {
    setStatus("Chemins requis", false)
    downloadBtn.disabled = false
    return
  }
  const res = await window.leo.get({ remotePath, localPath })
  downloadBtn.disabled = false
  if (res.ok) {
    setStatus("Téléchargement terminé")
    log(`Download ${remotePath} -> ${localPath}`)
  } else {
    setStatus(res.error, false)
    log(res.error)
  }
})

byeBtn?.addEventListener("click", async () => {
  if (!connected) return
  byeBtn.disabled = true
  const res = await window.leo.bye()
  byeBtn.disabled = false
  if (res.ok) {
    connected = false
    setStatus("Déconnecté")
    log("Session terminée")
  } else {
    setStatus(res.error, false)
    log(res.error)
  }
})
