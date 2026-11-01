const { app, BrowserWindow, Menu, shell, ipcMain, Notification, dialog, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// Allow app to run without sandbox (required for unsigned local apps)
app.commandLine.appendSwitch('no-sandbox');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let mainWindow = null;
let previewWindow = null;

function createWindow() {
  const winConfig = {
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: '价值投资助手',
    backgroundColor: '#1C1C1E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  };

  // macOS: hidden inset titlebar with native traffic lights
  if (isMac) {
    winConfig.titleBarStyle = 'hiddenInset';
    winConfig.trafficLightPosition = { x: 16, y: 14 };
  } else {
    // Windows/Linux: frameless window with custom titlebar in HTML
    winConfig.frame = false;
    winConfig.titleBarStyle = 'hidden';
  }

  mainWindow = new BrowserWindow(winConfig);

  mainWindow.loadFile('stock-tracker.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close preview window when main window closes
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.close();
    }
  });
}

// ===== Preview Window — separate floating window =====
function createPreviewWindow() {
  // If preview window already exists, just focus it
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
    return previewWindow;
  }

  // Position preview window to the right of main window
  let x, y;
  const [mainW, mainH] = mainWindow ? mainWindow.getSize() : [1280, 840];
  const previewW = 620;
  const previewH = 780;

  if (mainWindow) {
    const [mainX, mainY] = mainWindow.getPosition();
    const screen = require('electron').screen;
    const display = screen.getDisplayNearestPoint({ x: mainX, y: mainY });
    const workArea = display.workArea;

    // Try to place to the right of main window
    if (mainX + mainW + previewW + 20 <= workArea.x + workArea.width) {
      x = mainX + mainW + 20;
      y = mainY;
    } else if (mainX - previewW - 20 >= workArea.x) {
      // Place to the left
      x = mainX - previewW - 20;
      y = mainY;
    } else {
      // Place overlapping, offset
      x = mainX + 100;
      y = mainY + 40;
    }
  } else {
    x = undefined;
    y = undefined;
  }

  const previewConfig = {
    width: previewW,
    height: previewH,
    x: x,
    y: y,
    minWidth: 400,
    minHeight: 360,
    title: '附件预览',
    backgroundColor: '#1C1C1E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  };

  if (isMac) {
    previewConfig.titleBarStyle = 'hiddenInset';
    previewConfig.trafficLightPosition = { x: 14, y: 14 };
  } else {
    previewConfig.frame = false;
    previewConfig.titleBarStyle = 'hidden';
  }

  previewWindow = new BrowserWindow(previewConfig);

  previewWindow.loadFile('preview.html');

  previewWindow.once('ready-to-show', () => {
    previewWindow.show();
    previewWindow.focus();
  });

  // When preview window is clicked/focused, bring it to front
  previewWindow.on('focus', () => {
    if (!previewWindow.isDestroyed()) {
      previewWindow.setAlwaysOnTop(false);
    }
  });

  // When main window is focused, bring it to front (above preview if needed)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.on('focus', () => {
      // Main window naturally comes to front on focus when alwaysOnTop is false
    });
  }

  previewWindow.on('closed', () => {
    previewWindow = null;
  });

  return previewWindow;
}

// ===== IPC Handlers =====

// Open or update preview window with attachment data
ipcMain.handle('preview:open', (event, data) => {
  const win = createPreviewWindow();

  const sendData = () => {
    win.webContents.send('preview:data', data);
  };

  // If window is still loading, wait for it
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      // Small delay to ensure IPC listener is registered
      setTimeout(sendData, 100);
    });
  } else {
    sendData();
  }

  return true;
});

// Close preview window
ipcMain.handle('preview:close', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
  }
  return true;
});

// Minimize preview window
ipcMain.handle('preview:minimize', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.minimize();
  }
  return true;
});

// Toggle maximize/zoom preview window
ipcMain.handle('preview:maximize', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    if (previewWindow.isMaximized()) {
      previewWindow.unmaximize();
    } else {
      previewWindow.maximize();
    }
  }
  return true;
});

// Focus main window (brings main window above preview window)
ipcMain.handle('preview:focus-main', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
  return true;
});

// Focus preview window (brings preview window above main window)
ipcMain.handle('preview:focus-self', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
  }
  return true;
});

// ===== Windows titlebar controls =====
ipcMain.handle('win:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
  return true;
});

ipcMain.handle('win:maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  } else {
    win.maximize();
    return true;
  }
});

ipcMain.handle('win:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
  return true;
});

ipcMain.handle('win:is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isMaximized() : false;
});

// Get platform info for renderer
ipcMain.handle('app:platform', () => {
  return process.platform;
});

// Save file dialog — save a data buffer as a file to user-selected location
ipcMain.handle('file:save', async (event, { defaultPath, content, filters }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultPath || 'untitled',
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    fs.writeFileSync(result.filePath, content);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== Cloud Drive Sync =====
const CLOUD_DIR_NAME = '价值投资助手';
const CLOUD_CONFIG_FILE = 'cloud-config.json';

// Public builds must never contain OAuth credentials. Developers who need
// Baidu Netdisk sync can provide their own credentials at runtime. For a
// distributed desktop app, a server-side token exchange is strongly preferred.
const BAIDU_APP_KEY = process.env.BAIDU_APP_KEY || '';
const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY || '';
const BAIDU_REDIRECT_URI = 'oob';
const BAIDU_APP_DIR = '/apps/价值投资助手';
const BAIDU_BACKUP_PATH = `${BAIDU_APP_DIR}/data.json`;
const BAIDU_AUTH_FILE = 'baidu-auth.bin';

function requireBaiduCredentials() {
  if (!BAIDU_APP_KEY || !BAIDU_SECRET_KEY) {
    throw new Error('百度网盘同步未配置。请使用自己的 OAuth 应用凭据，或改用本地文件夹同步。');
  }
}

function getCloudConfigPath() {
  const userData = app.getPath('userData');
  return path.join(userData, CLOUD_CONFIG_FILE);
}

function getCloudConfig() {
  try {
    const configPath = getCloudConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to read cloud config:', e.message);
  }
  return {};
}

function saveCloudConfig(config) {
  try {
    const configPath = getCloudConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to save cloud config:', e.message);
  }
}

function detectCloudDrives() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return [];

  const services = [];
  const candidates = [
    { name: 'iCloud Drive', paths: [
      path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
      path.join(home, 'iCloudDrive'),
    ]},
    { name: 'OneDrive', paths: [
      path.join(home, 'OneDrive'),
      path.join(home, 'OneDrive - 个人'),
    ]},
    { name: '百度网盘', paths: [
      path.join(home, 'BaiduNetdisk'),
      path.join(home, 'Documents', 'BaiduNetdisk'),
      path.join(home, '百度网盘'),
    ]},
    { name: '夸克网盘', paths: [
      path.join(home, 'Quark'),
      path.join(home, 'Quark Drive'),
      path.join(home, '夸克网盘'),
    ]},
    { name: '坚果云', paths: [
      path.join(home, 'Nutstore', '我的坚果云'),
      path.join(home, 'Nutstore Files'),
    ]},
    { name: '腾讯微云', paths: [
      path.join(home, 'Tencent', 'Weiyun'),
    ]},
    { name: 'Google Drive', paths: [
      path.join(home, 'Google Drive'),
      path.join(home, 'Google Drive (1)'),
    ]},
    { name: 'Dropbox', paths: [
      path.join(home, 'Dropbox'),
    ]},
  ];

  for (const svc of candidates) {
    for (const p of svc.paths) {
      try {
        if (fs.existsSync(p)) {
          services.push({ name: svc.name, path: p });
          break;
        }
      } catch (e) { /* skip */ }
    }
  }

  return services;
}

function getCloudDrivePath() {
  const config = getCloudConfig();
  const services = detectCloudDrives();
  if (config.selectedPath) {
    const selected = services.find(service => service.path === config.selectedPath);
    if (selected) return { path: selected.path, serviceName: selected.name };
  }
  if (services.length > 0) {
    return { path: services[0].path, serviceName: services[0].name };
  }

  return null;
}

function getAllCloudDrives() {
  const autoDetected = detectCloudDrives();
  const all = [];

  for (const svc of autoDetected) {
    if (!all.find(a => a.path === svc.path)) {
      all.push({ name: svc.name, path: svc.path, isCustom: false });
    }
  }

  return all;
}

function getAppCloudPath() {
  const cloud = getCloudDrivePath();
  if (!cloud) return null;
  const appPath = path.join(cloud.path, CLOUD_DIR_NAME);
  try {
    if (!fs.existsSync(appPath)) {
      fs.mkdirSync(appPath, { recursive: true });
    }
  } catch (e) {
    console.warn('Failed to create cloud directory:', e.message);
    return null;
  }
  return appPath;
}

function getCloudDataFilePath() {
  const appPath = getAppCloudPath();
  if (!appPath) return null;
  return path.join(appPath, 'data.json');
}

// Check available cloud drives
ipcMain.handle('icloud:available', () => {
  const allDrives = getAllCloudDrives();
  const current = getCloudDrivePath();
  return {
    available: allDrives.length > 0,
    services: allDrives,
    currentService: current ? current.serviceName : '',
    currentPath: current ? current.path : ''
  };
});

// Save data to cloud drive
ipcMain.handle('icloud:save', async (event, { data }) => {
  try {
    const dataFile = getCloudDataFilePath();
    if (!dataFile) {
      return { success: false, error: '云盘不可用，请在设置中选择或添加云盘' };
    }

    const tempFile = dataFile + '.tmp';
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    fs.writeFileSync(tempFile, dataStr, 'utf-8');

    if (fs.existsSync(dataFile)) {
      const backupFile = dataFile + '.bak';
      try {
        fs.copyFileSync(dataFile, backupFile);
      } catch (e) {
        console.warn('Failed to backup cloud data file:', e.message);
      }
    }

    fs.renameSync(tempFile, dataFile);

    const stats = fs.statSync(dataFile);
    return { success: true, filePath: dataFile, modifiedAt: stats.mtime.toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Load data from cloud drive
ipcMain.handle('icloud:load', async () => {
  try {
    const dataFile = getCloudDataFilePath();
    if (!dataFile) {
      return { success: false, error: '云盘不可用，请在设置中选择或添加云盘' };
    }

    if (!fs.existsSync(dataFile)) {
      return { success: true, data: null, exists: false };
    }

    const content = fs.readFileSync(dataFile, 'utf-8');
    const stats = fs.statSync(dataFile);

    let data = null;
    try {
      data = JSON.parse(content);
    } catch (e) {
      return { success: false, error: '数据文件格式错误' };
    }

    return { success: true, data, exists: true, modifiedAt: stats.mtime.toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get cloud sync status
ipcMain.handle('icloud:status', async () => {
  try {
    const dataFile = getCloudDataFilePath();
    const available = !!dataFile && fs.existsSync(path.dirname(dataFile));

    if (!available) {
      return { available: false };
    }

    const exists = fs.existsSync(dataFile);
    let modifiedAt = null;
    let size = 0;

    if (exists) {
      const stats = fs.statSync(dataFile);
      modifiedAt = stats.mtime.toISOString();
      size = stats.size;
    }

    return { available: true, path: dataFile, exists, modifiedAt, size };
  } catch (err) {
    return { available: false, error: err.message };
  }
});

// Open cloud app folder
ipcMain.handle('icloud:open-folder', () => {
  const appPath = getAppCloudPath();
  if (appPath) {
    shell.openPath(appPath);
    return { success: true };
  }
  return { success: false, error: '云盘不可用' };
});

// Select one of the automatically detected cloud drives. Arbitrary custom
// paths are intentionally rejected to avoid presenting local folders as synced.
ipcMain.handle('cloud:set-path', async (event, { path: customPath, name }) => {
  try {
    if (!customPath) {
      return { success: false, error: '路径不能为空' };
    }
    const detected = detectCloudDrives();
    const selected = detected.find(service => service.path === customPath);
    if (!selected) return { success: false, error: '只能选择程序自动检测到的云盘目录' };
    const config = getCloudConfig();
    delete config.customPath;
    delete config.customName;
    config.selectedPath = selected.path;
    config.selectedName = selected.name;
    saveCloudConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Clear the selected drive and legacy custom-path settings (use auto-detect)
ipcMain.handle('cloud:clear-path', async () => {
  try {
    const config = getCloudConfig();
    delete config.customPath;
    delete config.customName;
    delete config.selectedPath;
    delete config.selectedName;
    saveCloudConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function getBaiduAuthPath() {
  return path.join(app.getPath('userData'), BAIDU_AUTH_FILE);
}

function readBaiduAuth() {
  try {
    const authPath = getBaiduAuthPath();
    if (!fs.existsSync(authPath) || !safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(authPath);
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch (err) {
    console.warn('Failed to read Baidu auth:', err.message);
    return null;
  }
}

function writeBaiduAuth(auth) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全保存百度授权令牌');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(auth));
  fs.writeFileSync(getBaiduAuthPath(), encrypted);
}

async function baiduJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`百度网盘返回了无法识别的数据（HTTP ${response.status}）`); }
  if (!response.ok || data.error || (data.errno !== undefined && data.errno !== 0) || (data.error_code !== undefined && data.error_code !== 0)) {
    const errorCode = data.errno ?? data.error_code ?? response.status;
    const knownMessages = {
      '-6': '授权令牌无效或权限不足，请重新登录百度网盘',
      '-7': '文件名不符合百度网盘要求',
      '-8': '目标文件或目录已存在',
      '-9': '目标路径不存在',
      '-10': '百度网盘空间不足',
      '31034': '百度网盘请求过于频繁，请稍后重试',
    };
    const error = new Error(
      data.error_description || data.error_msg || data.errmsg || data.error ||
      knownMessages[String(errorCode)] || `百度网盘请求失败（${errorCode}）`
    );
    error.baiduCode = Number(errorCode);
    throw error;
  }
  return data;
}

async function getBaiduAccessToken() {
  requireBaiduCredentials();
  let auth = readBaiduAuth();
  if (!auth || !auth.refresh_token) throw new Error('请先登录百度网盘');
  if (auth.access_token && auth.expires_at > Date.now() + 5 * 60 * 1000) return auth.access_token;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
    client_id: BAIDU_APP_KEY,
    client_secret: BAIDU_SECRET_KEY,
  });
  const refreshed = await baiduJson(`https://openapi.baidu.com/oauth/2.0/token?${params}`);
  auth = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || auth.refresh_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 0) * 1000,
    scope: refreshed.scope || auth.scope || '',
  };
  writeBaiduAuth(auth);
  return auth.access_token;
}

async function uploadBaiduBackup(content) {
  const accessToken = await getBaiduAccessToken();
  await ensureBaiduAppDirectory(accessToken);
  const fileBuffer = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  const chunkSize = 4 * 1024 * 1024;
  const chunks = [];
  const blockList = [];
  for (let offset = 0; offset < fileBuffer.length; offset += chunkSize) {
    const chunk = fileBuffer.subarray(offset, Math.min(offset + chunkSize, fileBuffer.length));
    chunks.push(chunk);
    blockList.push(crypto.createHash('md5').update(chunk).digest('hex'));
  }
  if (chunks.length === 0) {
    chunks.push(Buffer.alloc(0));
    blockList.push(crypto.createHash('md5').update(Buffer.alloc(0)).digest('hex'));
  }

  const precreateBody = new URLSearchParams({
    path: BAIDU_BACKUP_PATH,
    size: String(fileBuffer.length),
    isdir: '0',
    autoinit: '1',
    rtype: '3',
    block_list: JSON.stringify(blockList),
  });
  const precreate = await baiduJson(`https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: precreateBody,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const form = new FormData();
    form.append('file', new Blob([chunks[index]], { type: 'application/octet-stream' }), `part-${index}`);
    const uploadParams = new URLSearchParams({
      method: 'upload',
      access_token: accessToken,
      type: 'tmpfile',
      path: BAIDU_BACKUP_PATH,
      uploadid: precreate.uploadid,
      partseq: String(index),
    });
    await baiduJson(`https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?${uploadParams}`, { method: 'POST', body: form });
  }

  const createBody = new URLSearchParams({
    path: BAIDU_BACKUP_PATH,
    size: String(fileBuffer.length),
    isdir: '0',
    rtype: '3',
    uploadid: precreate.uploadid,
    block_list: JSON.stringify(blockList),
  });
  return baiduJson(`https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createBody,
  });
}

async function listBaiduAppDirectory(accessToken) {
  const params = new URLSearchParams({
    method: 'list', access_token: accessToken, dir: BAIDU_APP_DIR,
    order: 'time', desc: '1', start: '0', limit: '100', web: '0',
  });
  return baiduJson(`https://pan.baidu.com/rest/2.0/xpan/file?${params}`);
}

async function ensureBaiduAppDirectory(accessToken) {
  try {
    await listBaiduAppDirectory(accessToken);
    return;
  } catch (err) {
    if (err.baiduCode !== -9) throw err;
  }

  const body = new URLSearchParams({
    path: BAIDU_APP_DIR,
    size: '0',
    isdir: '1',
    rtype: '0',
    block_list: '[]',
  });
  try {
    await baiduJson(`https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    // A concurrent first upload may have created the directory already.
    if (err.baiduCode !== -8) throw err;
  }
}

async function getBaiduBackupMetadata(accessToken) {
  try {
    const result = await listBaiduAppDirectory(accessToken);
    return (result.list || []).find(file => file.path === BAIDU_BACKUP_PATH || file.server_filename === 'data.json') || null;
  } catch (err) {
    // A first-time user has no app directory yet. This means the account is
    // connected but contains no backup; the folder is created on first upload.
    if (err.baiduCode === -9) return null;
    throw err;
  }
}

ipcMain.handle('baidu:begin-auth', async () => {
  requireBaiduCredentials();
  const params = new URLSearchParams({
    response_type: 'code', client_id: BAIDU_APP_KEY, redirect_uri: BAIDU_REDIRECT_URI,
    scope: 'basic,netdisk', display: 'popup', force_login: '1',
  });
  await shell.openExternal(`https://openapi.baidu.com/oauth/2.0/authorize?${params}`);
  return { success: true };
});

ipcMain.handle('baidu:exchange-code', async (event, { code }) => {
  try {
    requireBaiduCredentials();
    const params = new URLSearchParams({
      grant_type: 'authorization_code', code: String(code || '').trim(),
      client_id: BAIDU_APP_KEY, client_secret: BAIDU_SECRET_KEY, redirect_uri: BAIDU_REDIRECT_URI,
    });
    const token = await baiduJson(`https://openapi.baidu.com/oauth/2.0/token?${params}`);
    writeBaiduAuth({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + Number(token.expires_in || 0) * 1000,
      scope: token.scope || '',
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('baidu:status', async () => {
  try {
    const auth = readBaiduAuth();
    if (!auth) return { connected: false };
    const accessToken = await getBaiduAccessToken();
    const file = await getBaiduBackupMetadata(accessToken);
    return {
      connected: true,
      exists: !!file,
      modifiedAt: file?.server_mtime ? new Date(file.server_mtime * 1000).toISOString() : null,
      size: Number(file?.size || 0),
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
});

ipcMain.handle('baidu:save', async (event, { data }) => {
  try {
    const result = await uploadBaiduBackup(data);
    return { success: true, modifiedAt: new Date().toISOString(), size: Number(result.size || 0) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('baidu:load', async () => {
  try {
    const accessToken = await getBaiduAccessToken();
    const file = await getBaiduBackupMetadata(accessToken);
    if (!file) return { success: true, exists: false, data: null };
    const params = new URLSearchParams({ method: 'download', access_token: accessToken, path: BAIDU_BACKUP_PATH });
    const response = await fetch(`https://d.pcs.baidu.com/rest/2.0/pcs/file?${params}`, { redirect: 'follow' });
    if (!response.ok) throw new Error(`下载备份失败（HTTP ${response.status}）`);
    const text = await response.text();
    return { success: true, exists: true, data: JSON.parse(text), modifiedAt: new Date(file.server_mtime * 1000).toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('baidu:logout', async () => {
  try {
    const authPath = getBaiduAuthPath();
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== Stock Price Fetching =====
// A-shares/funds/bonds: Sina Finance API (batch, real-time for A-shares)
// HK stocks: Tencent Finance API (parallel, real-time, no delay)
// Price cache with 1-second TTL for deduplication
const _priceCache = new Map();
const _priceCacheTTL = 1000; // 1 second
const _inflightRequests = new Map(); // key -> Promise

function getCacheKey(codes) {
  return codes.sort().join(',');
}

function getCachedPrices(cacheKey) {
  const entry = _priceCache.get(cacheKey);
  if (entry && Date.now() - entry.time < _priceCacheTTL) {
    return entry.data;
  }
  _priceCache.delete(cacheKey);
  return null;
}

function setCachedPrices(cacheKey, data) {
  _priceCache.set(cacheKey, { time: Date.now(), data });
  // Limit cache size
  if (_priceCache.size > 50) {
    const oldestKey = _priceCache.keys().next().value;
    _priceCache.delete(oldestKey);
  }
}

ipcMain.handle('stock:fetch', async (event, codes) => {
  if (!codes || codes.length === 0) return {};

  const cacheKey = getCacheKey(codes);

  // Return inflight request if same batch is already in progress
  if (_inflightRequests.has(cacheKey)) {
    return _inflightRequests.get(cacheKey);
  }

  // Return cached result if within TTL
  const cached = getCachedPrices(cacheKey);
  if (cached) {
    return cached;
  }

  const hkCodes = codes.filter(c => c.startsWith('hk'));
  const otherCodes = codes.filter(c => !c.startsWith('hk'));

  const fetchPromise = (async () => {
    const results = {};
    const promises = [];

    // Fetch non-HK stocks from Sina Finance (A-shares, funds, bonds)
    if (otherCodes.length > 0) {
      promises.push(
        fetchSinaPrices(otherCodes).then(async sinaResults => {
          Object.assign(results, sinaResults);
          // Sina occasionally returns an empty/partial response for ETFs and
          // bonds. Fill only the missing symbols through Electron's network
          // stack so system proxy settings are respected.
          const missingCodes = otherCodes.filter(code => !(results[code] && results[code].current > 0));
          if (missingCodes.length > 0) {
            try {
              const tencentResults = await fetchTencentDomesticBatch(missingCodes);
              Object.assign(results, tencentResults);
            } catch (error) {
              console.warn('[Quote] Tencent domestic fallback failed:', error.message);
            }
          }
        }).catch(async () => {
          try {
            Object.assign(results, await fetchTencentDomesticBatch(otherCodes));
          } catch (_) {}
        })
      );
    }

    // Fetch HK stocks from Tencent Finance (batch request)
    if (hkCodes.length > 0) {
      promises.push(
        fetchTencentHKBatch(hkCodes).then(hkResults => {
          Object.assign(results, hkResults);
        }).catch(() => {})
      );
    }

    await Promise.all(promises);

    // Cache the result
    setCachedPrices(cacheKey, results);

    return results;
  })();

  _inflightRequests.set(cacheKey, fetchPromise);
  fetchPromise.finally(() => {
    _inflightRequests.delete(cacheKey);
  });

  return fetchPromise;
});

// Normalize price data: if market is closed (current == 0), use yesterdayClose as current
function normalizePriceData(data) {
  if (!data) return data;
  const current = data.current || 0;
  const yesterdayClose = data.yesterdayClose || 0;
  
  if (current === 0 && yesterdayClose > 0) {
    // Market closed — use yesterday's close as reference price
    return {
      ...data,
      current: yesterdayClose,
      isMarketClosed: true,
      change: 0,
      changePercent: 0,
    };
  }
  
  return { ...data, isMarketClosed: false };
}

// Fetch A-share/fund/bond prices from Sina Finance (batch)
function fetchSinaPrices(codes) {
  return new Promise((resolve) => {
    const list = codes.join(',');
    const url = `http://hq.sinajs.cn/list=${list}`;
    const req = http.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let body;
        try {
          const decoder = new TextDecoder('gbk');
          body = decoder.decode(buffer);
        } catch (e) {
          body = buffer.toString('utf8');
        }

        const results = {};
        const lines = body.split('\n');
        for (const line of lines) {
          const match = line.match(/var hq_str_(\w+)="([^"]*)"/);
          if (match) {
            const code = match[1];
            const fields = match[2].split(',');
            if (fields.length >= 6) {
              results[code] = normalizePriceData({
                name: fields[0],
                open: parseFloat(fields[1]) || 0,
                yesterdayClose: parseFloat(fields[2]) || 0,
                current: parseFloat(fields[3]) || 0,
                high: parseFloat(fields[4]) || 0,
                low: parseFloat(fields[5]) || 0,
              });
            }
          }
        }
        resolve(results);
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(3000, () => { req.destroy(); resolve({}); });
  });
}

// Fetch A-share / ETF / bond quotes from Tencent. This is deliberately a
// separate fallback from K-line fetching: quote field [3] is the unadjusted
// exchange price, which avoids accidentally displaying a historical adjusted
// close as a realtime ETF price.
async function fetchTencentDomesticBatch(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://qt.gtimg.cn/q=${codes.join(',')}`;
    const response = await net.fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Referer': 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    let body;
    try { body = new TextDecoder('gbk').decode(buffer); }
    catch (_) { body = buffer.toString('utf8'); }

    const results = {};
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/v_((?:sh|sz)\d{6})="([^"]*)"/);
      if (!match) continue;
      const code = match[1];
      const fields = match[2].split('~');
      if (fields.length < 35) continue;
      const current = Number(fields[3]) || 0;
      const yesterdayClose = Number(fields[4]) || 0;
      if (!(current > 0 || yesterdayClose > 0)) continue;
      results[code] = normalizePriceData({
        name: fields[1] || code,
        open: Number(fields[5]) || 0,
        yesterdayClose,
        current,
        high: Number(fields[33]) || 0,
        low: Number(fields[34]) || 0,
        change: Number(fields[31]) || 0,
        changePercent: Number(fields[32]) || 0,
        source: 'tencent'
      });
    }
    return results;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Fetch HK stock prices from Tencent Finance (batch request via qt.gtimg.cn)
function fetchTencentHKBatch(codes) {
  return new Promise((resolve) => {
    // Tencent batch API: returns all stocks in one request
    // Remove 'hk' prefix for Tencent API format
    const tencentCodes = codes.map(c => c.replace(/^hk/, 'hk')).join(',');
    const url = `https://qt.gtimg.cn/q=${tencentCodes}`;

    const req = https.get(url, {
      headers: {
        'Referer': 'https://gu.qq.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          // Tencent returns GBK encoded data
          let body;
          try {
            const decoder = new TextDecoder('gbk');
            body = decoder.decode(buffer);
          } catch (e) {
            body = buffer.toString('utf8');
          }

          const results = {};
          const lines = body.split('\n');
          for (const line of lines) {
            // Format: v_hk00700="1~腾讯控股~00700~..."
            const match = line.match(/v_(hk\d+)="([^"]*)"/);
            if (match) {
              const code = match[1];
              const fields = match[2].split('~');
              if (fields.length >= 35) {
                // Tencent field mapping:
                // [1]=name, [3]=current, [4]=yesterdayClose, [5]=open,
                // [31]=change, [32]=changePercent, [33]=high, [34]=low
                results[code] = normalizePriceData({
                  name: fields[1] || code,
                  open: parseFloat(fields[5]) || 0,
                  yesterdayClose: parseFloat(fields[4]) || 0,
                  current: parseFloat(fields[3]) || 0,
                  high: parseFloat(fields[33]) || 0,
                  low: parseFloat(fields[34]) || 0,
                  change: parseFloat(fields[31]) || 0,
                  changePercent: parseFloat(fields[32]) || 0,
                });
              }
            }
          }
          resolve(results);
        } catch (e) {
          resolve({});
        }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(3000, () => { req.destroy(); resolve({}); });
  });
}

// Legacy function kept for backward compatibility
function fetchTencentHKPrices(codes) {
  return fetchTencentHKBatch(codes);
}

// Show system notification for price alerts
ipcMain.handle('stock:notify', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
  return true;
});

// ===== Market Indices Fetching — Sina Finance API =====
// Fetches real-time market indices (Shanghai Composite, Shenzhen Component, etc.)
ipcMain.handle('market:fetch-indices', async () => {
  // A-share indices use "s_" prefix (simplified format: name,price,change,change%)
  // HK indices use "rt_hk" prefix (format: code,name,open,yClose,high,low,current,change,change%)
  // International indices use "int_" prefix (format: name,current,change,change%)
  const indexMap = {
    's_sh000001': '上证指数',
    's_sz399001': '深证成指',
    's_sz399006': '创业板指',
    's_sh000688': '科创50',
    'rt_hkHSI': '恒生指数',
    'rt_hkHSTECH': '恒生科技',
    'rt_hkHSCEI': '国企指数'
  };

  const codes = Object.keys(indexMap);
  const list = codes.join(',');
  const url = `http://hq.sinajs.cn/list=${list}`;

  return new Promise((resolve) => {
    const req = http.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let body;
        try {
          const decoder = new TextDecoder('gbk');
          body = decoder.decode(buffer);
        } catch (e) {
          body = buffer.toString('utf8');
        }

        const results = [];
        const lines = body.split('\n');
        for (const line of lines) {
          const match = line.match(/var hq_str_(\w+)="([^"]*)"/);
          if (match) {
            const code = match[1];
            const name = indexMap[code] || code;
            const fields = match[2].split(',');
            if (fields.length < 2) continue;

            if (code.startsWith('s_')) {
              // Domestic index simple format: name, current, change, change%
              if (fields.length >= 4) {
                const current = parseFloat(fields[1]) || 0;
                const change = parseFloat(fields[2]) || 0;
                const changePercent = parseFloat(fields[3]) || 0;
                results.push({ code, name: fields[0] || name, current, change, changePercent });
              }
            } else if (code.startsWith('rt_hk')) {
              // HK index format: code, name, open, yClose, high, low, current, change, change%
              if (fields.length >= 9) {
                results.push({
                  code,
                  name: fields[1] || name,
                  current: parseFloat(fields[6]) || 0,
                  change: parseFloat(fields[7]) || 0,
                  changePercent: parseFloat(fields[8]) || 0
                });
              }
            } else if (code.startsWith('int_')) {
              // International index format: name, current, change, change%
              if (fields.length >= 4) {
                results.push({
                  code,
                  name: fields[0] || name,
                  current: parseFloat(fields[1]) || 0,
                  change: parseFloat(fields[2]) || 0,
                  changePercent: parseFloat(fields[3]) || 0
                });
              }
            }
          }
        }
        resolve(results);
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve([]);
    });
  });
});

// ===== Financial News Fetching — 同花顺(10jqka) API =====
// Fetches latest financial news from 同花顺 news push API
ipcMain.handle('market:fetch-news', async () => {
  const url = 'https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&num=30';

  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const data = JSON.parse(body);
          const newsItems = (data.data && data.data.list || []).map(item => ({
            title: item.title || '',
            url: item.url || '',
            intro: (item.digest || item.short || item.title || '').replace(/<[^>]+>/g, '').substring(0, 200),
            publishTime: item.ctime || '',
            media: item.source || '',
            tags: (item.tags || []).map(t => t.name).filter(Boolean),
          }));
          resolve(newsItems);
        } catch (e) {
          console.error('News parse error:', e);
          resolve([]);
        }
      });
    });

    req.on('error', (e) => { console.error('News fetch error:', e); resolve([]); });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve([]);
    });
  });
});

// ===== Exchange Rate Fetching — Sina Finance API =====
// Fetches real-time forex rates against CNY
// Accepts an array of Sina fx codes like ['fx_susdcny', 'fx_seurcny', 'fx_shkdcny']
// Returns: array of { code, name, current, yesterdayClose, change, changePercent }
const FX_ALL_CURRENCIES = {
  'fx_susdcny': '美元',
  'fx_seurcny': '欧元',
  'fx_sgbpcny': '英镑',
  'fx_sjpycny': '日元',
  'fx_shkdcny': '港币',
  'fx_saudcny': '澳元',
  'fx_scadcny': '加元',
  'fx_schfcny': '瑞郎',
  'fx_snzdcny': '新西兰元',
  'fx_ssgdcny': '新加坡元',
  'fx_skrwcny': '韩元',
  'fx_srubcny': '卢布',
  'fx_sthbcny': '泰铢',
  'fx_ssekcny': '瑞典克朗',
  'fx_snokcny': '挪威克朗',
  'fx_smtcny': '林吉特',
  'fx_szarcny': '南非兰特'
};

ipcMain.handle('market:fetch-fx', async (event, codes) => {
  // If codes not provided, fetch all
  const fxMap = {};
  const useCodes = (codes && codes.length > 0) ? codes : Object.keys(FX_ALL_CURRENCIES);
  for (const c of useCodes) {
    fxMap[c] = FX_ALL_CURRENCIES[c] || c;
  }

  const fxCodes = Object.keys(fxMap);
  const list = fxCodes.join(',');
  const url = `http://hq.sinajs.cn/list=${list}`;

  return new Promise((resolve) => {
    const req = http.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let body;
        try {
          const decoder = new TextDecoder('gbk');
          body = decoder.decode(buffer);
        } catch (e) {
          body = buffer.toString('utf8');
        }

        const results = [];
        const lines = body.split('\n');
        for (const line of lines) {
          const match = line.match(/var hq_str_(\w+)="([^"]*)"/);
          if (match) {
            const code = match[1];
            const name = fxMap[code] || code;
            const fields = match[2].split(',');
            if (fields.length < 2) continue;

            // Sina fx_s format (verified from API):
            // fields[0] = time (e.g. "22:47:16")
            // fields[1] = current price
            // fields[2..8] = various prices (open, high, low, etc.)
            // fields[9] = name (GBK, e.g. "日元兑人民币", "在岸人民币")
            // fields[10] = changePercent (e.g. "-0.7155")
            // fields[11] = change (e.g. "-0.0003")
            // fields[13] = "此行情由新浪财经计算得出"
            // fields[17] = date (e.g. "2026-08-10")
            // Always use predefined name for consistency (avoids "(每100)" and other artifacts)
            let fxName = fxMap[code] || name;
            // Strip any residual "(每100)" or timestamp patterns as safety measure
            fxName = fxName.replace(/（每100）/g, '').replace(/\(每100\)/g, '').replace(/\d{2}:\d{2}:\d{2}/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '').trim();

            let current = 0, change = 0, changePercent = 0, yesterdayClose = 0;
            if (fields.length >= 2) {
              current = parseFloat(fields[1]) || 0;
            }
            // Use API-provided change and changePercent (more reliable than calculating)
            if (fields.length > 11) {
              change = parseFloat(fields[11]) || 0;
              changePercent = parseFloat(fields[10]) || 0;
            }
            // Calculate yesterdayClose from current and change
            if (current > 0 && change !== 0) {
              yesterdayClose = current - change;
            } else if (fields.length >= 3) {
              yesterdayClose = parseFloat(fields[2]) || 0;
            }

            if (current > 0) {
              results.push({
                code,
                name: fxName,
                current,
                yesterdayClose,
                change,
                changePercent
              });
            }
          }
        }
        resolve(results);
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve([]);
    });
  });
});

// ===== FX Historical Data Fetching =====
// Primary: Frankfurter API (open source, reliable but may be slow from China)
// Fallback: East Money Datacenter API (domestic, faster access)
// sinaCode: e.g. 'fx_susdcny', period: '5y'|'3y'|'1y'|'3m'|'1m'
// Returns: { klines: [{date, open, close, high, low}], name } or { error }
const FX_FRANKFURTER_MAP = {
  'fx_susdcny': 'USD',
  'fx_seurcny': 'EUR',
  'fx_sgbpcny': 'GBP',
  'fx_sjpycny': 'JPY',
  'fx_shkdcny': 'HKD',
  'fx_saudcny': 'AUD',
  'fx_scadcny': 'CAD',
  'fx_schfcny': 'CHF',
  'fx_snzdcny': 'NZD',
  'fx_ssgdcny': 'SGD',
  'fx_skrwcny': 'KRW',
  'fx_srubcny': 'RUB',
  'fx_sthbcny': 'THB',
  'fx_ssekcny': 'SEK',
  'fx_snokcny': 'NOK',
  'fx_smtcny': 'MYR',
  'fx_szarcny': 'ZAR'
};

// East Money datacenter FX rate indicator IDs
const FX_EASTMONEY_MAP = {
  'fx_susdcny': { indicator: 'USDCNY', name: '美元' },
  'fx_seurcny': { indicator: 'EURCNY', name: '欧元' },
  'fx_sgbpcny': { indicator: 'GBPCNY', name: '英镑' },
  'fx_sjpycny': { indicator: 'JPYCNY', name: '日元' },
  'fx_shkdcny': { indicator: 'HKDCNY', name: '港币' },
  'fx_saudcny': { indicator: 'AUDCNY', name: '澳元' },
  'fx_scadcny': { indicator: 'CADCNY', name: '加元' },
  'fx_schfcny': { indicator: 'CHFCNY', name: '瑞郎' },
  'fx_snzdcny': { indicator: 'NZDCNY', name: '新西兰元' },
  'fx_ssgdcny': { indicator: 'SGDCNY', name: '新加坡元' },
  'fx_skrwcny': { indicator: 'KRWCNY', name: '韩元' },
  'fx_srubcny': { indicator: 'RUB CNY', name: '卢布' },
  'fx_sthbcny': { indicator: 'THBCNY', name: '泰铢' },
  'fx_ssekcny': { indicator: 'SEKCNY', name: '瑞典克朗' },
  'fx_snokcny': { indicator: 'NOKCNY', name: '挪威克朗' },
  'fx_smtcny': { indicator: 'MYRCNY', name: '林吉特' },
  'fx_szarcny': { indicator: 'ZARCNY', name: '南非兰特' }
};

// Helper: fetch URL with redirect following (supports relative redirects)
function httpsGetWithRedirect(url, headers, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    function doFetch(currentUrl, redirectCount) {
      const req = https.get(currentUrl, { headers }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error('Too many redirects'));
            response.resume();
            return;
          }
          let redirectUrl = response.headers.location;
          // Handle relative redirect URLs
          if (redirectUrl.startsWith('/')) {
            const parsedUrl = new URL(currentUrl);
            redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
          }
          response.resume();
          doFetch(redirectUrl, redirectCount + 1);
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    }
    doFetch(url, 0);
  });
}

// Fetch FX history from Frankfurter API
async function fetchFxHistoryFrankfurter(ccy, period) {
  const now = new Date();
  const beg = new Date();
  switch (period) {
    case '5y': beg.setFullYear(now.getFullYear() - 5); break;
    case '3y': beg.setFullYear(now.getFullYear() - 3); break;
    case '1y': beg.setFullYear(now.getFullYear() - 1); break;
    case '3m': beg.setMonth(now.getMonth() - 3); break;
    case '1m': beg.setMonth(now.getMonth() - 1); break;
    default: beg.setFullYear(now.getFullYear() - 1);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const begStr = `${beg.getFullYear()}-${pad(beg.getMonth() + 1)}-${pad(beg.getDate())}`;
  const endStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const url = `https://api.frankfurter.app/${begStr}..${endStr}?from=${ccy}&to=CNY`;
  const response = await httpsGetWithRedirect(url, { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' });
  const data = JSON.parse(response.body.toString('utf8'));

  if (!data.rates) throw new Error('No rates data');

  const klines = [];
  const dates = Object.keys(data.rates).sort();
  let prevClose = 0;
  for (const date of dates) {
    const rate = data.rates[date].CNY;
    if (!rate) continue;
    const open = prevClose > 0 ? prevClose : rate;
    klines.push({
      date,
      open: open,
      close: rate,
      high: Math.max(open, rate),
      low: Math.min(open, rate)
    });
    prevClose = rate;
  }
  return { klines, name: `${ccy}/CNY` };
}

// Fetch FX history from East Money Datacenter API (fallback)
async function fetchFxHistoryEastMoney(sinaCode, period) {
  const fxInfo = FX_EASTMONEY_MAP[sinaCode];
  if (!fxInfo) throw new Error('Unsupported currency');

  const barCount = { '5y': 1300, '3y': 800, '1y': 260, '3m': 70, '1m': 25 };
  const count = barCount[period] || 260;

  // East Money forex K-line API endpoint
  const secid = fxInfo.indicator;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fxhkline/get?param=${secid},day,,,${count}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) throw new Error(`腾讯行情接口 HTTP ${response.statusCode}`);
          if (!body.trim().startsWith('{')) {
            const blocked = /waf\.tencent\.com|501page|location\.href/i.test(body);
            throw new Error(blocked ? '腾讯行情接口触发访问保护' : '腾讯行情接口返回了非JSON数据');
          }
          const data = JSON.parse(body);
          if (data.code !== 0 || !data.data) { reject(new Error('API error')); return; }

          const stockData = data.data[secid];
          if (!stockData) { reject(new Error('No data')); return; }

          const klineArr = stockData['day'] || stockData['qfqday'];
          if (!klineArr || klineArr.length === 0) { reject(new Error('No K-line data')); return; }

          const klines = klineArr.map(k => ({
            date: k[0],
            open: parseFloat(k[1]) || 0,
            close: parseFloat(k[2]) || 0,
            high: parseFloat(k[3]) || 0,
            low: parseFloat(k[4]) || 0
          })).filter(k => k.close > 0);

          if (klines.length === 0) { reject(new Error('No valid data')); return; }
          resolve({ klines, name: `${fxInfo.indicator}` });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

ipcMain.handle('market:fetch-fx-history', async (event, { sinaCode, period }) => {
  const ccy = FX_FRANKFURTER_MAP[sinaCode];
  if (!ccy) return { error: '不支持该外汇的历史数据查询' };

  // Try Frankfurter API first
  try {
    console.log('[FX History] Trying Frankfurter API:', ccy, period);
    const result = await fetchFxHistoryFrankfurter(ccy, period);
    if (result.klines && result.klines.length > 0) {
      console.log('[FX History] Frankfurter API success,', result.klines.length, 'data points');
      return result;
    }
  } catch (e) {
    console.warn('[FX History] Frankfurter API failed:', e.message);
  }

  // Fallback: try East Money / Tencent API
  try {
    console.log('[FX History] Trying East Money fallback:', sinaCode, period);
    const result = await fetchFxHistoryEastMoney(sinaCode, period);
    if (result.klines && result.klines.length > 0) {
      console.log('[FX History] East Money fallback success,', result.klines.length, 'data points');
      return result;
    }
  } catch (e) {
    console.warn('[FX History] East Money fallback failed:', e.message);
  }

  return { error: '获取历史数据失败，请检查网络连接后重试' };
});

// ===== News Article Content Fetching =====
// Fetches the full text content of a news article from its URL
ipcMain.handle('market:fetch-news-content', async (event, url) => {
  if (!url) return { title: '', content: '' };

  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        const redirProtocol = redirectUrl.startsWith('https') ? https : http;
        redirProtocol.get(redirectUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (redirRes) => {
          const chunks = [];
          redirRes.on('data', (chunk) => chunks.push(chunk));
          redirRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            let body;
            try {
              const decoder = new TextDecoder('utf-8');
              body = decoder.decode(buffer);
            } catch (e) {
              body = buffer.toString('utf8');
            }
            resolve(extractArticleContent(body));
          });
        }).on('error', () => resolve({ title: '', content: '内容获取失败' }));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let body;
        try {
          const decoder = new TextDecoder('utf-8');
          body = decoder.decode(buffer);
        } catch (e) {
          body = buffer.toString('utf8');
        }
        resolve(extractArticleContent(body));
      });
    });

    req.on('error', () => resolve({ title: '', content: '内容获取失败' }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ title: '', content: '请求超时' });
    });
  });
});

// Extract article title and text content from HTML
function extractArticleContent(html) {
  let title = '';
  let content = '';

  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Try to extract article content from common selectors
  // 10jqka.com.cn uses .art_content or .atc-content
  const contentPatterns = [
    /<div[^>]*class="[^"]*art_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*atc-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*main-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*txt_cont[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of contentPatterns) {
    const match = html.match(pattern);
    if (match) {
      // Strip HTML tags and decode entities
      content = match[1]
        .replace(/<p[^>]*>/g, '\n')
        .replace(/<\/p>/g, '')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (content.length > 50) break;
    }
  }

  // Fallback: if no content found, try meta description
  if (!content) {
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
    if (descMatch) content = descMatch[1];
  }

  return { title, content: content || '无法提取正文内容' };
}

// ===== Stock K-line Data Fetching — Tencent Finance API =====
// Fetches K-line data (intraday/daily/weekly/monthly) for stocks
// Uses Tencent Finance API (gu.qq.com) — supports both A-share and HK stocks
// params: { sinaCode, stockCode, market, period }
// period: 'intraday' | 'daily' | 'weekly' | 'monthly'
// Returns: { klines: [{date, open, close, high, low}], name } or { error }
const STOCK_KLINE_BATCH_SIZE = 640;
const STOCK_KLINE_CACHE_MS = 15 * 60 * 1000;
const stockKlineHistoryCache = new Map();

function previousTradingQueryDate(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function fetchTencentKlineBatch(sinaCode, period, endDate) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sinaCode},${period},,${endDate || ''},${STOCK_KLINE_BATCH_SIZE},qfq`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Referer': 'https://gu.qq.com', 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) throw new Error(`腾讯行情接口 HTTP ${response.statusCode}`);
          if (!body.trim().startsWith('{')) {
            const blocked = /waf\.tencent\.com|501page|location\.href/i.test(body);
            throw new Error(blocked ? '腾讯行情接口触发访问保护' : '腾讯行情接口返回了非JSON数据');
          }
          const data = JSON.parse(body);
          if (data.code !== 0 || !data.data) {
            reject(new Error(data.msg || '暂无K线数据'));
            return;
          }
          const stockData = data.data[sinaCode];
          if (!stockData) {
            reject(new Error('暂无K线数据'));
            return;
          }
          const series = stockData['qfq' + period] || stockData[period];
          resolve({
            series: Array.isArray(series) ? series : [],
            name: (stockData.qt && stockData.qt[sinaCode] && stockData.qt[sinaCode][1]) || '',
          });
        } catch (err) {
          reject(new Error(err.message || '解析K线数据失败'));
        }
      });
    });
    req.on('error', () => reject(new Error('获取K线数据失败')));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('K线请求超时')); });
  });
}

function eastMoneySecIdFromSinaCode(sinaCode) {
  const match = String(sinaCode || '').toLowerCase().match(/^(sh|sz|hk)(\d+)$/);
  if (!match) return '';
  const market = match[1];
  const code = market === 'hk' ? match[2].padStart(5, '0') : match[2].padStart(6, '0');
  return `${market === 'sh' ? '1' : market === 'hk' ? '116' : '0'}.${code}`;
}

function requestJsonOnce(url, sourceLabel, referer) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      headers: {
        'Referer': referer,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*'
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) throw new Error(`${sourceLabel} HTTP ${response.statusCode}`);
          const data = JSON.parse(body);
          resolve(data);
        } catch (error) {
          reject(new Error(error.message || `解析${sourceLabel}数据失败`));
        }
      });
    });
    req.on('error', error => reject(new Error(`${sourceLabel}连接失败：${error.code || error.message}`)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`${sourceLabel}请求超时`)); });
  });
}

async function requestElectronJsonOnce(url, sourceLabel, referer) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await net.fetch(url, {
      method: 'GET',
      headers: {
        'Referer': referer,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*',
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${sourceLabel} HTTP ${response.status}`);
    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`${sourceLabel}返回了非JSON数据`);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${sourceLabel}请求超时`);
    throw new Error(`${sourceLabel}网络请求失败：${error.code || error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJsonWithNetworkFallback(url, sourceLabel, referer) {
  let electronError;
  try {
    return await requestElectronJsonOnce(url, sourceLabel, referer);
  } catch (error) {
    electronError = error;
  }
  try {
    return await requestJsonOnce(url, sourceLabel, referer);
  } catch (nodeError) {
    throw new Error(`${electronError.message}；Node后备：${nodeError.message}`);
  }
}

async function requestEastMoneyJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await requestJsonWithNetworkFallback(url, '东方财富行情源', 'https://quote.eastmoney.com/');
      if (result.rc !== 0 || !result.data) throw new Error(result.message || '东方财富行情源暂无数据');
      return result.data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 350));
    }
  }
  throw lastError || new Error('东方财富行情源不可用');
}

function yahooSymbolFromSinaCode(sinaCode) {
  const match = String(sinaCode || '').toLowerCase().match(/^(sh|sz|hk)(\d+)$/);
  if (!match) return '';
  if (match[1] === 'hk') return `${match[2].replace(/^0+/, '').padStart(4, '0')}.HK`;
  return `${match[2].padStart(6, '0')}.${match[1] === 'sh' ? 'SS' : 'SZ'}`;
}

async function requestYahooChart(sinaCode, interval, range) {
  const symbol = yahooSymbolFromSinaCode(sinaCode);
  if (!symbol) throw new Error('Yahoo行情源无法识别股票代码');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&events=history`;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const json = await requestJsonWithNetworkFallback(url, 'Yahoo行情源', 'https://finance.yahoo.com/');
      const result = json.chart && json.chart.result && json.chart.result[0];
      if (!result || !result.timestamp || !result.indicators || !result.indicators.quote) {
        throw new Error((json.chart && json.chart.error && json.chart.error.description) || 'Yahoo行情源暂无数据');
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  throw lastError || new Error('Yahoo行情源不可用');
}

async function fetchYahooKline(sinaCode, period) {
  const intervalMap = { day: '1d', week: '1wk', month: '1mo' };
  const result = await requestYahooChart(sinaCode, intervalMap[period] || '1d', 'max');
  const quote = result.indicators.quote[0];
  const klines = result.timestamp.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: Number(quote.open[index]), close: Number(quote.close[index]),
    high: Number(quote.high[index]), low: Number(quote.low[index])
  })).filter(row => Number.isFinite(row.open) && Number.isFinite(row.close) &&
    Number.isFinite(row.high) && Number.isFinite(row.low) && row.open > 0 && row.close > 0);
  if (!klines.length) throw new Error('Yahoo行情源暂无K线数据');
  return {
    klines, name: result.meta?.longName || result.meta?.shortName || result.meta?.symbol || '',
    historyComplete: true, firstDate: klines[0].date, lastDate: klines[klines.length - 1].date,
    source: 'yahoo'
  };
}

async function fetchYahooIntraday(sinaCode) {
  const result = await requestYahooChart(sinaCode, '1m', '1d');
  const quote = result.indicators.quote[0];
  const klines = result.timestamp.map((timestamp, index) => {
    const close = Number(quote.close[index]);
    return {
      date: new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      open: close, close, high: close, low: close
    };
  }).filter(row => Number.isFinite(row.close) && row.close > 0);
  if (!klines.length) throw new Error('Yahoo行情源暂无分时数据');
  return { klines, name: result.meta?.longName || result.meta?.shortName || result.meta?.symbol || '', source: 'yahoo' };
}

async function fetchEastMoneyKline(sinaCode, period) {
  const secid = eastMoneySecIdFromSinaCode(sinaCode);
  if (!secid) throw new Error('备用行情源无法识别股票代码');
  const periodMap = { day: 101, week: 102, month: 103 };
  const klt = periodMap[period] || 101;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=${klt}&fqt=0&beg=0&end=20500101&lmt=10000`;
  const data = await requestEastMoneyJson(url);
  const klines = (data.klines || []).map(rowText => {
    const row = String(rowText).split(',');
    return {
      date: row[0] || '',
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4])
    };
  }).filter(row => row.date && Number.isFinite(row.open) && Number.isFinite(row.close) &&
    Number.isFinite(row.high) && Number.isFinite(row.low) && row.open > 0 && row.close > 0);
  if (!klines.length) throw new Error('备用行情源暂无K线数据');
  return {
    klines,
    name: data.name || '',
    historyComplete: true,
    firstDate: klines[0].date,
    lastDate: klines[klines.length - 1].date,
    source: 'eastmoney'
  };
}

async function fetchEastMoneyIntraday(sinaCode) {
  const secid = eastMoneySecIdFromSinaCode(sinaCode);
  if (!secid) throw new Error('备用行情源无法识别股票代码');
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53&ndays=1`;
  const data = await requestEastMoneyJson(url);
  const klines = (data.trends || []).map(rowText => {
    const row = String(rowText).split(',');
    const price = Number(row[1]);
    return { date: row[0] || '', open: price, close: price, high: price, low: price };
  }).filter(row => row.date && Number.isFinite(row.close) && row.close > 0);
  if (!klines.length) throw new Error('备用行情源暂无分时数据');
  return { klines, name: data.name || '', source: 'eastmoney' };
}

async function fetchCompleteTencentKline(sinaCode, period) {
  const cacheKey = `${sinaCode}:${period}`;
  const cached = stockKlineHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return cached.value;

  const maxBatches = period === 'day' ? 20 : period === 'week' ? 8 : 4;
  const rowsByDate = new Map();
  let endDate = '';
  let name = '';
  let historyComplete = false;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    let batch;
    try {
      batch = await fetchTencentKlineBatch(sinaCode, period, endDate);
    } catch (err) {
      if (rowsByDate.size === 0) throw err;
      break;
    }
    if (!name && batch.name) name = batch.name;
    if (!batch.series.length) {
      historyComplete = true;
      break;
    }

    let added = 0;
    for (const row of batch.series) {
      if (!row || !row[0] || rowsByDate.has(row[0])) continue;
      rowsByDate.set(row[0], row);
      added += 1;
    }
    if (added === 0) {
      historyComplete = true;
      break;
    }

    const earliest = batch.series.reduce((min, row) => row && row[0] && row[0] < min ? row[0] : min, batch.series[0][0]);
    if (batch.series.length < STOCK_KLINE_BATCH_SIZE) {
      historyComplete = true;
      break;
    }
    const nextEndDate = previousTradingQueryDate(earliest);
    if (!nextEndDate || nextEndDate === endDate) break;
    endDate = nextEndDate;
  }

  const klines = [...rowsByDate.values()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(row => ({
      date: row[0],
      open: parseFloat(row[1]) || 0,
      close: parseFloat(row[2]) || 0,
      high: parseFloat(row[3]) || 0,
      low: parseFloat(row[4]) || 0,
    }));
  if (!klines.length) throw new Error('暂无K线数据');

  const value = {
    klines,
    name,
    historyComplete,
    firstDate: klines[0].date,
    lastDate: klines[klines.length - 1].date,
  };
  // Do not retain a network-truncated result for long; a later open can retry.
  stockKlineHistoryCache.set(cacheKey, {
    savedAt: Date.now(),
    ttl: historyComplete ? STOCK_KLINE_CACHE_MS : 30 * 1000,
    value,
  });
  return value;
}

ipcMain.handle('stock:fetch-kline', async (event, params) => {
  const { sinaCode, period } = params;
  if (!sinaCode) return { error: '无法识别股票代码' };

  // Intraday: Tencent minute-by-minute data
  if (period === 'intraday') {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${sinaCode}`;
    const tencentResult = await new Promise((resolve) => {
      const req = https.get(url, { headers: { 'Referer': 'https://gu.qq.com', 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            if (!body.trim().startsWith('{')) throw new Error('腾讯分时接口返回了非JSON数据');
            const data = JSON.parse(body);
            const stockData = data.data && data.data[sinaCode];
            if (!stockData || !stockData.data || !stockData.data.data) {
              resolve({ error: '暂无分时数据' });
              return;
            }
            const minuteArr = stockData.data.data;
            const klines = minuteArr.map(item => {
              const parts = item.split(' ');
              const price = parseFloat(parts[1]) || 0;
              return { date: parts[0] || '', open: price, close: price, high: price, low: price };
            });
            const name = (stockData.qt && stockData.qt[sinaCode] && stockData.qt[sinaCode][1]) || '';
            resolve({ klines, name });
          } catch (e) { resolve({ error: '解析分时数据失败' }); }
        });
      });
      req.on('error', () => resolve({ error: '获取分时数据失败' }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ error: '请求超时' }); });
    });
    if (!tencentResult.error) return tencentResult;
    try {
      return await fetchEastMoneyIntraday(sinaCode);
    } catch (eastMoneyError) {
      try {
        return await fetchYahooIntraday(sinaCode);
      } catch (yahooError) {
        return { error: `分时主源失败（${tencentResult.error}）；东方财富失败（${eastMoneyError.message}）；Yahoo失败（${yahooError.message}）` };
      }
    }
  }

  // Daily/Weekly/Monthly: page backwards until the listing/inception date.
  // Tencent returns at most ~640 rows per request, so a single request silently
  // truncates older history for long-lived stocks and funds.
  const periodMap = { daily: 'day', weekly: 'week', monthly: 'month' };
  const tencentPeriod = periodMap[period] || 'day';
  try {
    return await fetchCompleteTencentKline(sinaCode, tencentPeriod);
  } catch (tencentError) {
    console.warn(`[K-line] Tencent source failed for ${sinaCode}/${tencentPeriod}:`, tencentError.message);
    try {
      const fallback = await fetchEastMoneyKline(sinaCode, tencentPeriod);
      stockKlineHistoryCache.set(`${sinaCode}:${tencentPeriod}`, {
        savedAt: Date.now(), ttl: STOCK_KLINE_CACHE_MS, value: fallback
      });
      return fallback;
    } catch (eastMoneyError) {
      console.warn(`[K-line] East Money source failed for ${sinaCode}/${tencentPeriod}:`, eastMoneyError.message);
      try {
        const thirdSource = await fetchYahooKline(sinaCode, tencentPeriod);
        stockKlineHistoryCache.set(`${sinaCode}:${tencentPeriod}`, {
          savedAt: Date.now(), ttl: STOCK_KLINE_CACHE_MS, value: thirdSource
        });
        return thirdSource;
      } catch (yahooError) {
        return { error: `腾讯失败（${tencentError.message}）；东方财富失败（${eastMoneyError.message}）；Yahoo失败（${yahooError.message}）` };
      }
    }
  }
});

// ===== Stock Basic Info Fetching — East Money push2 API =====
// Fetches stock basic info: name, price, market cap, PE, PB, industry, etc.
// Also fetches company introduction and main business from F10 API.
// input: stockCode (e.g. "600519", "000001", "00700")
// returns: { name, code, price, change, changePercent, marketCap, floatMarketCap,
//            pe, peTtm, pb, industry, mainBusiness, orgProfile, listingDate, ... } or { error }
ipcMain.handle('stock:info', async (event, stockCode) => {
  if (!stockCode) return { error: '请输入股票代码' };

  const code = stockCode.trim();
  let secid = '';
  let market = '';

  // Determine secid and market based on code
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith('6')) {
      secid = '1.' + code;
      market = 'sh';
    } else if (code.startsWith('0') || code.startsWith('3')) {
      secid = '0.' + code;
      market = 'sz';
    } else {
      secid = '1.' + code;
      market = 'sh';
    }
  } else if (/^\d{1,5}$/.test(code)) {
    const padded = code.padStart(5, '0');
    secid = '116.' + padded;
    market = 'hk';
  } else if (/^hk\d{1,5}$/i.test(code)) {
    const padded = code.replace(/^hk/i, '').padStart(5, '0');
    secid = '116.' + padded;
    market = 'hk';
  } else if (/^(sh|sz)\d{6}$/i.test(code)) {
    const m = code.substring(0, 2).toLowerCase();
    const c = code.substring(2);
    secid = (m === 'sh' ? '1.' : '0.') + c;
    market = m;
  } else {
    // Try searching by name (Chinese or English)
    const searchUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(code)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=1`;
    const searchResult = await new Promise((resolve) => {
      const req = https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(body);
            if (json.QuotationCodeTable && json.QuotationCodeTable.Data && json.QuotationCodeTable.Data.length > 0) {
              resolve(json.QuotationCodeTable.Data[0]);
            } else { resolve(null); }
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
    if (!searchResult) return { error: '未找到匹配的股票，请检查名称或代码' };
    const resultCode = String(searchResult.Code || '');
    const mkt = String(searchResult.MktNum || '');
    if (/^\d{6}$/.test(resultCode)) {
      if (resultCode.startsWith('6')) { secid = '1.' + resultCode; market = 'sh'; }
      else if (resultCode.startsWith('0') || resultCode.startsWith('3')) { secid = '0.' + resultCode; market = 'sz'; }
      else { secid = '1.' + resultCode; market = 'sh'; }
    } else if (/^\d{1,5}$/.test(resultCode)) {
      secid = '116.' + resultCode.padStart(5, '0'); market = 'hk';
    } else {
      return { error: '未找到匹配的股票' };
    }
  }

  // Resolve code from secid
  const resolvedCode = secid.split('.')[1] || code;

  // Build Tencent API code (sh600519, sz000001, hk00700)
  let tencentCode = '';
  if (market === 'hk') {
    tencentCode = 'hk' + resolvedCode.padStart(5, '0');
  } else {
    tencentCode = market + resolvedCode;
  }

  // Fetch basic metrics from Tencent API (qt.gtimg.cn)
  const tencentUrl = `https://qt.gtimg.cn/q=${tencentCode}`;

  const tencentPromise = new Promise((resolve) => {
    const req = https.get(tencentUrl, {
      headers: {
        'Referer': 'https://gu.qq.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          let body;
          try {
            const decoder = new TextDecoder('gbk');
            body = decoder.decode(buffer);
          } catch (e) {
            body = buffer.toString('utf8');
          }
          // Format: v_sh600519="1~贵州茅台~600519~1304.66~..."
          // HK stocks have different field layout (78 fields vs 88 for A-share)
          const match = body.match(/v_\w+="([^"]*)"/);
          if (!match) { resolve(null); return; }
          const fields = match[1].split('~');
          if (fields.length < 35) { resolve(null); return; }

          const isHK = market === 'hk';
          const price = parseFloat(fields[3]) || 0;
          const yesterdayClose = parseFloat(fields[4]) || 0;
          const marketCapYi = parseFloat(fields[44]) || 0;  // 亿
          const floatMarketCapYi = parseFloat(fields[45]) || 0;  // 亿

          // Field positions differ between A-share and HK
          const pb = isHK ? (parseFloat(fields[47]) || 0) : (parseFloat(fields[46]) || 0);
          const week52High = isHK ? (parseFloat(fields[48]) || 0) : (parseFloat(fields[67]) || 0);
          const week52Low = isHK ? (parseFloat(fields[49]) || 0) : (parseFloat(fields[68]) || 0);
          const volumeRatio = isHK ? (parseFloat(fields[50]) || 0) : (parseFloat(fields[49]) || 0);
          // HK field [57] appears to be ROE; A-share [57] is turnover amount
          const roeFromApi = isHK ? (parseFloat(fields[57]) || 0) : 0;

          resolve({
            code: fields[2] || resolvedCode,
            name: (fields[1] || '').replace(/\s/g, ''),
            price: price,
            change: parseFloat(fields[31]) || 0,
            changePercent: parseFloat(fields[32]) || 0,
            open: parseFloat(fields[5]) || 0,
            yesterdayClose: yesterdayClose,
            high: parseFloat(fields[33]) || 0,
            low: parseFloat(fields[34]) || 0,
            volume: parseFloat(fields[36]) || 0,
            turnoverRate: parseFloat(fields[38]) || 0,
            peDynamic: parseFloat(fields[39]) || 0,
            peTtm: parseFloat(fields[39]) || 0,
            amplitude: parseFloat(fields[43]) || 0,
            marketCap: marketCapYi * 100000000,    // 亿 → 元
            floatMarketCap: floatMarketCapYi * 100000000,
            pb: pb,
            volumeRatio: volumeRatio,
            week52High: week52High,
            week52Low: week52Low,
            totalShares: isHK ? (parseFloat(fields[69]) || 0) : (parseFloat(fields[72]) || 0),
            floatShares: isHK ? (parseFloat(fields[70]) || 0) : (parseFloat(fields[73]) || 0),
            peStatic: 0,
            dividendYield: isHK ? (parseFloat(fields[47]) || 0) : 0,
            pegRatio: 0,
            roe: roeFromApi,
            roeChange: 0,
            roeReportDate: '',
            netProfitGrowth: 0,
            grossMargin: 0,
            mainInflow: 0,
          });
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });

  // Fetch company info — A-share uses datacenter F10, HK uses emweb F10
  const f10Code = market === 'hk' ? resolvedCode.padStart(5, '0') : resolvedCode;

  let f10Promise;
  if (market === 'hk') {
    // HK: use emweb.securities.eastmoney.com/PC_HKF10/CompanyProfile
    const hkF10Url = `https://emweb.securities.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax?code=${f10Code}`;
    f10Promise = new Promise((resolve) => {
      const req = https.get(hkF10Url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://emweb.securities.eastmoney.com/' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(body);
            if (json.gszl || json.zqzl) {
              resolve({
                ORG_PROFILE: (json.gszl && json.gszl.gsjs) || '',
                MAIN_BUSINESS: '',
                PROVINCE: '',
                LISTING_DATE: (json.zqzl && json.zqzl.ssrq) || '',
                EM2016: (json.gszl && json.gszl.sshy) || '',
                EMPLOYEE_NUM: (json.gszl && json.gszl.ygrs) ? parseInt(json.gszl.ygrs.replace(/,/g, '')) : 0,
                isHK: true,
              });
            } else { resolve(null); }
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  } else {
    // A-share: use datacenter F10
    const f10Url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_PROFILE,MAIN_BUSINESS,PROVINCE,LISTING_DATE,ORG_CODE,EM2016&filter=(SECURITY_CODE=%22${f10Code}%22)`;
    f10Promise = new Promise((resolve) => {
      const req = https.get(f10Url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://emweb.securities.eastmoney.com/' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(body);
            if (json.success && json.result && json.result.data && json.result.data.length > 0) {
              resolve(json.result.data[0]);
            } else { resolve(null); }
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  }

  const [tencentData, f10Data] = await Promise.all([tencentPromise, f10Promise]);

  if (!tencentData && !f10Data) return { error: '获取股票信息失败' };

  // Fetch financial metrics (ROE, gross margin, net profit growth, dividend yield) from F10
  // Only A-share has F10 financial data; HK stocks get ROE from Tencent API field [57]
  let f10FinPromise = Promise.resolve(null);
  let f10DivPromise = Promise.resolve(null);

  if (market !== 'hk') {
    const f10FinUrl = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=SECURITY_CODE,ROEJQ,ROEJQTZ,XSMLL,PARENTNETPROFITTZ,ROIC,BPS,REPORT_DATE,REPORT_DATE_NAME&filter=(SECURITY_CODE=%22${f10Code}%22)&pageSize=1&pageNumber=1`;
    f10FinPromise = new Promise((resolve) => {
      const req = https.get(f10FinUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(body);
            if (json.success && json.result && json.result.data && json.result.data.length > 0) {
              resolve(json.result.data[0]);
            } else { resolve(null); }
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    });

  }

  // Dividend data: fetch multiple records for TTM calculation (both A-share and HK)
  const f10DivUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=SECURITY_CODE,PRETAX_BONUS_RMB,DIVIDENT_RATIO,NOTICE_DATE&filter=(SECURITY_CODE=%22${f10Code}%22)&pageSize=10&pageNumber=1&sortColumns=NOTICE_DATE&sortTypes=-1`;
  f10DivPromise = new Promise((resolve) => {
    const req = https.get(f10DivUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(body);
          if (json.success && json.result && json.result.data && json.result.data.length > 0) {
            resolve(json.result.data);
          } else { resolve(null); }
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(6000, () => { req.destroy(); resolve(null); });
  });

  const [f10FinData, f10DivData] = await Promise.all([f10FinPromise, f10DivPromise]);

  // Extract industry from EM2016 (e.g., "食品饮料-饮料-白酒" → "白酒")
  let industry = '';
  if (f10Data && f10Data.EM2016) {
    const parts = f10Data.EM2016.split('-');
    industry = parts[parts.length - 1] || f10Data.EM2016;
  }

  // Fetch industry peers using F10 EM2016 classification (A-share only)
  let peers = [];
  if (f10Data && f10Data.EM2016 && market !== 'hk') {
    try {
      const em2016Encoded = encodeURIComponent(f10Data.EM2016);
      const peerUrl = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECURITY_CODE,SECURITY_NAME_ABBR&filter=(EM2016=%22${em2016Encoded}%22)&pageSize=15&pageNumber=1`;
      const peerList = await new Promise((resolve) => {
        const req = https.get(peerUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const json = JSON.parse(body);
              if (json.success && json.result && json.result.data) {
                resolve(json.result.data);
              } else { resolve([]); }
            } catch (e) { resolve([]); }
          });
        });
        req.on('error', () => resolve([]));
        req.setTimeout(6000, () => { req.destroy(); resolve([]); });
      });

      // Filter to A-share codes only and batch fetch from Tencent
      const peerCodes = peerList
        .map(p => String(p.SECURITY_CODE || ''))
        .filter(c => /^\d{6}$/.test(c) && !c.startsWith('2') && !c.startsWith('9'))
        .slice(0, 10);

      if (peerCodes.length > 0) {
        const tencentPeerCodes = peerCodes.map(c => {
          if (c.startsWith('6')) return 'sh' + c;
          if (c.startsWith('0') || c.startsWith('3')) return 'sz' + c;
          return 'sh' + c;
        });
        const peerUrl2 = `https://qt.gtimg.cn/q=${tencentPeerCodes.join(',')}`;
        peers = await new Promise((resolve) => {
          const req = https.get(peerUrl2, {
            headers: { 'Referer': 'https://gu.qq.com', 'User-Agent': 'Mozilla/5.0' }
          }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              try {
                const buffer = Buffer.concat(chunks);
                let body;
                try {
                  const decoder = new TextDecoder('gbk');
                  body = decoder.decode(buffer);
                } catch (e) { body = buffer.toString('utf8'); }
                const results = [];
                const lines = body.split('\n');
                for (const line of lines) {
                  const m = line.match(/v_(\w+)="([^"]*)"/);
                  if (m) {
                    const f = m[2].split('~');
                    if (f.length >= 47) {
                      results.push({
                        code: f[2] || m[1],
                        name: (f[1] || '').replace(/\s/g, ''),
                        price: parseFloat(f[3]) || 0,
                        pe: parseFloat(f[39]) || 0,
                        pb: parseFloat(f[46]) || 0,
                        changePercent: parseFloat(f[32]) || 0,
                        marketCap: (parseFloat(f[44]) || 0) * 100000000,
                        roe: 0,
                        industry: industry
                      });
                    }
                  }
                }
                resolve(results);
              } catch (e) { resolve([]); }
            });
          });
          req.on('error', () => resolve([]));
          req.setTimeout(6000, () => { req.destroy(); resolve([]); });
        });
      }
    } catch (e) { peers = []; }
  }

  // Merge financial data into result
  const finData = tencentData || {};
  if (f10FinData) {
    finData.roe = f10FinData.ROEJQ || finData.roe || 0;
    finData.roeChange = f10FinData.ROEJQTZ || 0;
    finData.roeReportDate = f10FinData.REPORT_DATE_NAME || '';
    finData.grossMargin = f10FinData.XSMLL || 0;
    finData.netProfitGrowth = f10FinData.PARENTNETPROFITTZ ? (f10FinData.PARENTNETPROFITTZ * 100) : 0;
    finData.roic = f10FinData.ROIC || 0;
    finData.bps = f10FinData.BPS || 0;
  }
  if (f10DivData && Array.isArray(f10DivData) && f10DivData.length > 0 && market !== 'hk') {
    // Calculate TTM (trailing twelve months) dividend yield using current price
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    let ttmBonus = 0;
    for (const record of f10DivData) {
      if (record.NOTICE_DATE && record.PRETAX_BONUS_RMB > 0) {
        const noticeDate = new Date(record.NOTICE_DATE);
        if (noticeDate >= oneYearAgo) {
          ttmBonus += record.PRETAX_BONUS_RMB;
        }
      }
    }

    // PRETAX_BONUS_RMB is per 10 shares; convert to per share and calculate yield
    if (ttmBonus > 0 && finData.price && finData.price > 0) {
      finData.dividendYield = (ttmBonus / 10 / finData.price) * 100;
      finData.pretaxBonus = ttmBonus;
    } else if (f10DivData[0] && f10DivData[0].DIVIDENT_RATIO) {
      // Fallback: use API-provided ratio (based on announcement date price)
      finData.dividendYield = f10DivData[0].DIVIDENT_RATIO * 100;
      finData.pretaxBonus = f10DivData[0].PRETAX_BONUS_RMB || 0;
    }
  }
  // Compute PEG if we have PE and growth
  if (finData.peTtm && finData.peTtm > 0 && finData.netProfitGrowth && finData.netProfitGrowth > 0) {
    finData.pegRatio = finData.peTtm / finData.netProfitGrowth;
  }

  return {
    ...finData,
    orgProfile: f10Data ? (f10Data.ORG_PROFILE || '') : '',
    mainBusiness: f10Data ? (f10Data.MAIN_BUSINESS || '') : '',
    listingDate: f10Data ? (f10Data.LISTING_DATE || '') : '',
    province: f10Data ? (f10Data.PROVINCE || '') : '',
    city: '',
    employeeNum: f10Data ? (f10Data.EMPLOYEE_NUM || 0) : 0,
    industry: industry,
    market: market,
    secid: secid,
    peers: peers,
  };
});

// ===== Stock Search — East Money Search API =====
// Searches stocks by name or code (supports Chinese and English)
// input: keyword (e.g. "贵州茅台", "茅台", "maotai")
// returns: [{ code, name, market }] or []
ipcMain.handle('stock:search', async (event, keyword) => {
  if (!keyword || keyword.trim().length < 1) return [];

  const query = keyword.trim();
  const searchUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`;

  return new Promise((resolve) => {
    const req = https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(body);
          if (!json.QuotationCodeTable || !json.QuotationCodeTable.Data) {
            resolve([]);
            return;
          }
          const results = json.QuotationCodeTable.Data.filter(d => {
            const code = String(d.Code || '');
            const mkt = String(d.MktNum || '');
            return /^\d{5,6}$/.test(code) && (mkt === '1' || mkt === '0' || mkt === '116');
          }).map(d => {
            const mkt = String(d.MktNum || '');
            let market = 'sh';
            if (mkt === '0') market = 'sz';
            else if (mkt === '116') market = 'hk';
            return {
              code: String(d.Code),
              name: d.Name,
              market: market
            };
          });
          resolve(results);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });
});

// ===== Macroeconomic Data Fetching — East Money Datacenter API =====
// Fetches latest macro indicators: CPI, PPI, PMI, GDP, Retail, M1/M2,
// Industrial Growth, Fixed Asset Investment, Customs Trade, Electricity
// Returns: { cpi, ppi, pmi, gdp, retail, moneySupply, industrialGrowth, fixedAssetInvest, customsTrade, electricity }
function fetchMacroReport(reportName, filter) {
  let url = `https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=1&pageNumber=1&reportName=${reportName}&columns=ALL`;
  if (filter) url += `&filter=${filter.replace(/"/g, '%22')}`;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          if (!data.success || !data.result || !data.result.data || data.result.data.length === 0) {
            resolve(null);
            return;
          }
          resolve(data.result.data[0]);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

ipcMain.handle('macro:fetch', async () => {
  const [cpiData, ppiData, pmiData, gdpData, retailData, moneyData,
         indusData, investData, customsData, elecData] = await Promise.all([
    fetchMacroReport('RPT_ECONOMY_CPI'),
    fetchMacroReport('RPT_ECONOMY_PPI'),
    fetchMacroReport('RPT_ECONOMY_PMI'),
    fetchMacroReport('RPT_ECONOMY_GDP'),
    fetchMacroReport('RPT_ECONOMY_TOTAL_RETAIL'),
    fetchMacroReport('RPT_ECONOMY_CURRENCY_SUPPLY'),
    fetchMacroReport('RPT_ECONOMY_INDUS_GROW'),
    fetchMacroReport('RPT_ECONOMY_ASSET_INVEST'),
    fetchMacroReport('RPT_ECONOMY_CUSTOMS'),
    fetchMacroReport('RPT_INDUSTRY_INDEX', '(INDICATOR_ID="EMI00011561")')
  ]);

  const result = {};

  if (cpiData) {
    result.cpi = {
      value: parseFloat(cpiData.NATIONAL_BASE) || 0,
      yoy: parseFloat(cpiData.NATIONAL_SAME) || 0,
      mom: parseFloat(cpiData.NATIONAL_SEQUENTIAL) || 0,
      date: cpiData.TIME || ''
    };
  }

  if (ppiData) {
    result.ppi = {
      value: parseFloat(ppiData.BASE) || 0,
      yoy: parseFloat(ppiData.BASE_SAME) || 0,
      date: ppiData.TIME || ''
    };
  }

  if (pmiData) {
    result.pmi = {
      value: parseFloat(pmiData.MAKE_INDEX) || 0,
      yoy: parseFloat(pmiData.MAKE_SAME) || 0,
      nmakeValue: parseFloat(pmiData.NMAKE_INDEX) || 0,
      nmakeYoy: parseFloat(pmiData.NMAKE_SAME) || 0,
      date: pmiData.TIME || ''
    };
  }

  if (gdpData) {
    result.gdp = {
      value: parseFloat(gdpData.DOMESTICL_PRODUCT_BASE) || 0,
      yoy: parseFloat(gdpData.SUM_SAME) || 0,
      primary: parseFloat(gdpData.FIRST_PRODUCT_BASE) || 0,
      secondary: parseFloat(gdpData.SECOND_PRODUCT_BASE) || 0,
      tertiary: parseFloat(gdpData.THIRD_PRODUCT_BASE) || 0,
      date: gdpData.TIME || gdpData.QUARTER || ''
    };
  }

  if (retailData) {
    result.retail = {
      value: parseFloat(retailData.RETAIL_TOTAL) || 0,
      yoy: parseFloat(retailData.RETAIL_TOTAL_SAME) || 0,
      mom: parseFloat(retailData.RETAIL_TOTAL_SEQUENTIAL) || 0,
      date: retailData.TIME || ''
    };
  }

  if (moneyData) {
    result.moneySupply = {
      m1: parseFloat(moneyData.CURRENCY) || 0,
      m1Yoy: parseFloat(moneyData.CURRENCY_SAME) || 0,
      m2: parseFloat(moneyData.BASIC_CURRENCY) || 0,
      m2Yoy: parseFloat(moneyData.BASIC_CURRENCY_SAME) || 0,
      date: moneyData.TIME || ''
    };
  }

  if (indusData) {
    result.industrialGrowth = {
      yoy: parseFloat(indusData.BASE_SAME) || 0,
      accumulateYoy: parseFloat(indusData.BASE_ACCUMULATE) || 0,
      date: indusData.TIME || ''
    };
  }

  if (investData) {
    result.fixedAssetInvest = {
      value: parseFloat(investData.BASE) || 0,
      yoy: parseFloat(investData.BASE_SAME) || 0,
      accumulate: parseFloat(investData.BASE_ACCUMULATE) || 0,
      date: investData.TIME || ''
    };
  }

  if (customsData) {
    result.customsTrade = {
      export: parseFloat(customsData.EXIT_BASE) || 0,
      exportYoy: parseFloat(customsData.EXIT_BASE_SAME) || 0,
      import: parseFloat(customsData.IMPORT_BASE) || 0,
      importYoy: parseFloat(customsData.IMPORT_BASE_SAME) || 0,
      date: customsData.TIME || ''
    };
  }

  if (elecData) {
    result.electricity = {
      value: parseFloat(elecData.INDICATOR_VALUE) || 0,
      changeRate: parseFloat(elecData.CHANGE_RATE) || 0,
      date: (elecData.REPORT_DATE || '').split(' ')[0] || ''
    };
  }

  return result;
});

// ===== Macroeconomic Historical Data =====
// Fetches historical time series data for macro indicators
// indicator: 'cpi' | 'ppi' | 'pmi' | 'gdp' | 'retail' | 'm2' | 'm1' | 'industrialGrowth' | 'fixedAssetInvest' | 'customsExport' | 'customsImport' | 'electricity'
// period: '5y' | '3y' | '1y'
// Returns: { data: [{date, value, yoy?}], name } or { error }
function fetchMacroHistoryReport(reportName, valueField, yoyField, filter, limit) {
  const pageSize = limit || 240;
  let url = `https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=${pageSize}&pageNumber=1&reportName=${reportName}&columns=ALL`;
  if (filter) url += `&filter=${filter.replace(/"/g, '%22')}`;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          if (!data.success || !data.result || !data.result.data || data.result.data.length === 0) {
            resolve([]);
            return;
          }
          const result = data.result.data.map(item => {
            const date = (item.TIME || item.REPORT_DATE || item.QUARTER || '').split(' ')[0] || '';
            const value = parseFloat(item[valueField]) || 0;
            const yoy = yoyField ? (parseFloat(item[yoyField]) || 0) : null;
            return { date, value, yoy };
          }).filter(item => item.date && item.value > 0);
          // Sort ascending by date
          result.sort((a, b) => a.date.localeCompare(b.date));
          resolve(result);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

ipcMain.handle('macro:fetch-history', async (event, { indicator, period }) => {
  const barCount = { '5y': 60, '3y': 36, '1y': 12, 'all': 240 };
  const limit = barCount[period] || 60;

  let reportName, valueField, yoyField, filter = null, name = '';

  switch (indicator) {
    case 'cpi':
      reportName = 'RPT_ECONOMY_CPI';
      valueField = 'NATIONAL_BASE';
      yoyField = 'NATIONAL_SAME';
      name = 'CPI 居民消费价格指数';
      break;
    case 'ppi':
      reportName = 'RPT_ECONOMY_PPI';
      valueField = 'BASE';
      yoyField = 'BASE_SAME';
      name = 'PPI 工业品出厂价格指数';
      break;
    case 'pmi':
      reportName = 'RPT_ECONOMY_PMI';
      valueField = 'MAKE_INDEX';
      yoyField = 'MAKE_SAME';
      name = 'PMI 采购经理人指数';
      break;
    case 'gdp':
      reportName = 'RPT_ECONOMY_GDP';
      valueField = 'DOMESTICL_PRODUCT_BASE';
      yoyField = 'SUM_SAME';
      name = 'GDP 国内生产总值';
      break;
    case 'retail':
      reportName = 'RPT_ECONOMY_TOTAL_RETAIL';
      valueField = 'RETAIL_TOTAL';
      yoyField = 'RETAIL_TOTAL_SAME';
      name = '社会消费品零售总额';
      break;
    case 'm2':
      reportName = 'RPT_ECONOMY_CURRENCY_SUPPLY';
      valueField = 'BASIC_CURRENCY';
      yoyField = 'BASIC_CURRENCY_SAME';
      name = 'M2 货币供应量';
      break;
    case 'm1':
      reportName = 'RPT_ECONOMY_CURRENCY_SUPPLY';
      valueField = 'CURRENCY';
      yoyField = 'CURRENCY_SAME';
      name = 'M1 货币供应量';
      break;
    case 'industrialGrowth':
      reportName = 'RPT_ECONOMY_INDUS_GROW';
      valueField = 'BASE_SAME';
      yoyField = 'BASE_ACCUMULATE';
      name = '规模以上工业增加值同比';
      break;
    case 'fixedAssetInvest':
      reportName = 'RPT_ECONOMY_ASSET_INVEST';
      valueField = 'BASE_ACCUMULATE';
      yoyField = 'BASE_SAME';
      name = '固定资产投资累计值';
      break;
    case 'customsExport':
      reportName = 'RPT_ECONOMY_CUSTOMS';
      valueField = 'EXIT_BASE';
      yoyField = 'EXIT_BASE_SAME';
      name = '出口总额';
      break;
    case 'customsImport':
      reportName = 'RPT_ECONOMY_CUSTOMS';
      valueField = 'IMPORT_BASE';
      yoyField = 'IMPORT_BASE_SAME';
      name = '进口总额';
      break;
    case 'electricity':
      reportName = 'RPT_INDUSTRY_INDEX';
      valueField = 'INDICATOR_VALUE';
      yoyField = 'CHANGE_RATE';
      filter = '(INDICATOR_ID="EMI00011561")';
      name = '全社会用电量';
      break;
    default:
      return { error: '不支持的宏观指标' };
  }

  const data = await fetchMacroHistoryReport(reportName, valueField, yoyField, filter, limit);
  if (data.length === 0) {
    return { error: '暂无历史数据' };
  }
  return { data, name };
});

// ===== Gold Price Fetching =====
// Primary: Sina Finance gold futures (nf_AU0) — same API infrastructure as stock prices, very reliable
// Fallback: Shanghai Gold Exchange official API
// Returns: { name, code, current, yesterdayClose, open, high, low, change, changePercent }
ipcMain.handle('market:fetch-gold', async () => {
  // Try Sina gold futures first (most reliable, same API as stock prices)
  try {
    const sinaGold = await fetchSinaGoldPrice();
    if (sinaGold && sinaGold.current > 0) {
      return sinaGold;
    }
  } catch (e) {
    console.error('Sina gold fetch error, trying SGE:', e.message);
  }

  // Fallback: SGE official API
  try {
    const sgeGold = await fetchSgeGoldPrice();
    if (sgeGold && sgeGold.current > 0) {
      return sgeGold;
    }
  } catch (e) {
    console.error('SGE gold fetch error:', e.message);
  }

  return null;
});

// Fetch gold price from Sina Finance futures API (nf_AU0 = 沪金连续)
function fetchSinaGoldPrice() {
  return new Promise((resolve) => {
    const code = 'nf_AU0';
    const url = `http://hq.sinajs.cn/list=${code}`;
    const req = http.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          let body;
          try {
            const decoder = new TextDecoder('gbk');
            body = decoder.decode(buffer);
          } catch (e) {
            body = buffer.toString('utf8');
          }

          const match = body.match(/var hq_str_nf_AU0="([^"]*)"/);
          if (!match) { resolve(null); return; }

          const fields = match[1].split(',');
          if (fields.length < 9) { resolve(null); return; }

          // Sina futures format:
          // [0]=name, [1]=time, [2]=yesterdayClose, [3]=open, [4]=high, [5]=low,
          // [6]=bid1, [7]=ask1, [8]=current, [9]=settlement, [10]=yesterdaySettlement, ...
          const current = parseFloat(fields[8]) || 0;
          const yesterdayClose = parseFloat(fields[2]) || 0;
          const open = parseFloat(fields[3]) || 0;
          const high = parseFloat(fields[4]) || 0;
          const low = parseFloat(fields[5]) || 0;

          if (current <= 0) { resolve(null); return; }

          const change = yesterdayClose > 0 ? current - yesterdayClose : 0;
          const changePercent = yesterdayClose > 0 ? (change / yesterdayClose * 100) : 0;

          resolve({
            name: '沪金',
            code: 'AU0',
            current,
            yesterdayClose,
            open,
            high: high > 0 ? high : current,
            low: low > 0 ? low : current,
            change,
            changePercent
          });
        } catch (e) {
          console.error('Sina gold parse error:', e);
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// Fetch gold price from Shanghai Gold Exchange official API
async function fetchSgeGoldPrice() {
  try {
    const intraday = await fetchSgeQuotations('Au99.99');
    if (!intraday || !intraday.data || intraday.data.length === 0) return null;

    const prices = intraday.data.map(parseFloat).filter(v => !isNaN(v) && v > 0);
    if (prices.length === 0) return null;

    const current = prices[prices.length - 1];
    const open = prices[0];
    const high = parseFloat(intraday.max) || Math.max(...prices);
    const low = parseFloat(intraday.min) || Math.min(...prices);

    let yesterdayClose = 0;
    try {
      const daily = await fetchSgeDaily('Au99.99');
      if (daily && daily.length >= 2) {
        const lastDay = daily[daily.length - 1];
        yesterdayClose = lastDay[2] || 0;
      }
    } catch (e) { /* ignore */ }

    const change = yesterdayClose > 0 ? current - yesterdayClose : 0;
    const changePercent = yesterdayClose > 0 ? (change / yesterdayClose * 100) : 0;

    return {
      name: '黄金9999',
      code: 'Au99.99',
      current,
      yesterdayClose,
      open,
      high,
      low,
      change,
      changePercent
    };
  } catch (e) {
    return null;
  }
}
function fetchSgeQuotations(instid) {
  return new Promise((resolve) => {
    const postData = `instid=${encodeURIComponent(instid)}`;
    const options = {
      hostname: 'www.sge.com.cn',
      path: '/graph/quotations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(postData),
        'Referer': 'https://www.sge.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    };

    const req = https.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          resolve(data);
        } catch (e) {
          console.error('SGE quotations parse error:', e);
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// Fetch SGE daily history data for a given instrument
// Returns array of [date, open, close, low, high]
function fetchSgeDaily(instid) {
  return new Promise((resolve) => {
    const postData = `instid=${encodeURIComponent(instid)}`;
    const options = {
      hostname: 'www.sge.com.cn',
      path: '/graph/Dailyhq',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(postData),
        'Referer': 'https://www.sge.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    };

    const req = https.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          resolve(data.time || []);
        } catch (e) {
          console.error('SGE daily parse error:', e);
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.write(postData);
    req.end();
  });
}

// ===== Index K-line History =====
// Fetches historical K-line data for market indices using Tencent API
// Supports periods: 5y, 3y, 1y, 3m, 1m
// Index code mapping from Sina format to Tencent format
ipcMain.handle('market:fetch-index-history', async (event, { sinaCode, period }) => {
  // Convert Sina index code to Tencent code
  let tencentCode = sinaCode;
  if (sinaCode.startsWith('s_')) {
    tencentCode = sinaCode.substring(2); // s_sh000001 -> sh000001
  } else if (sinaCode.startsWith('rt_hk')) {
    tencentCode = 'hk' + sinaCode.substring(5); // rt_hkHSI -> hkHSI
  }

  // Calculate number of bars based on period
  const barCount = {
    '5y': 1300,
    '3y': 800,
    '1y': 260,
    '3m': 70,
    '1m': 25
  };
  const count = barCount[period] || 260;

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,${count},qfq`;

  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'Referer': 'https://gu.qq.com', 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          if (data.code !== 0 || !data.data) { resolve({ error: '暂无K线数据' }); return; }

          const stockData = data.data[tencentCode];
          if (!stockData) { resolve({ error: '暂无K线数据' }); return; }

          // Tencent format: try qfqday first, then day
          const klineArr = stockData['qfqday'] || stockData['day'];
          if (!klineArr || klineArr.length === 0) { resolve({ error: '暂无K线数据' }); return; }

          // Tencent format: [date, open, close, high, low, volume]
          const klines = klineArr.map(k => ({
            date: k[0],
            open: parseFloat(k[1]) || 0,
            close: parseFloat(k[2]) || 0,
            high: parseFloat(k[3]) || 0,
            low: parseFloat(k[4]) || 0
          }));

          // Get name from qt data if available
          let name = '';
          if (stockData.qt && stockData.qt[tencentCode]) {
            name = stockData.qt[tencentCode][1] || '';
          }

          resolve({ klines, name });
        } catch (e) {
          console.error('Index kline parse error:', e);
          resolve({ error: '解析K线数据失败' });
        }
      });
    });
    req.on('error', () => resolve({ error: '获取K线数据失败' }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: '请求超时' }); });
  });
});

// ===== Gold K-line History =====
// Fetches historical K-line data for domestic gold (SGE Au99.99)
// Uses SGE official Dailyhq API — ~10 years of daily data
ipcMain.handle('market:fetch-gold-history', async (event, { period }) => {
  try {
    const daily = await fetchSgeDaily('Au99.99');
    if (!daily || daily.length === 0) {
      return { error: '暂无黄金历史数据' };
    }

    // Convert SGE format: [date, open, close, low, high] -> { date, open, close, high, low }
    let klines = daily.map(d => ({
      date: d[0],
      open: parseFloat(d[1]) || 0,
      close: parseFloat(d[2]) || 0,
      low: parseFloat(d[3]) || 0,
      high: parseFloat(d[4]) || 0
    })).filter(k => k.date && k.close > 0);

    // Filter by period
    const now = new Date();
    const beg = new Date();
    switch (period) {
      case '5y': beg.setFullYear(now.getFullYear() - 5); break;
      case '3y': beg.setFullYear(now.getFullYear() - 3); break;
      case '1y': beg.setFullYear(now.getFullYear() - 1); break;
      case '3m': beg.setMonth(now.getMonth() - 3); break;
      case '1m': beg.setMonth(now.getMonth() - 1); break;
      default: beg.setFullYear(now.getFullYear() - 1);
    }

    const begStr = beg.toISOString().split('T')[0];
    klines = klines.filter(k => k.date >= begStr);

    if (klines.length === 0) {
      return { error: '该时间段暂无数据' };
    }

    return { klines, name: '黄金9999' };
  } catch (e) {
    console.error('Gold history error:', e);
    return { error: '获取黄金历史数据失败' };
  }
});

// Menu bar — minimal, Mac-native
function buildMenu() {
  const template = [
    {
      label: '价值投资助手',
      submenu: [
        { role: 'about', label: '关于价值投资助手' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出价值投资助手' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
