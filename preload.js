const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  // Preview window API — opens a separate floating window for attachment preview
  // This window can be moved freely outside the main app window
  openPreview: (data) => ipcRenderer.invoke('preview:open', data),

  // Close the preview window
  closePreview: () => ipcRenderer.invoke('preview:close'),

  // Minimize the preview window
  minimizePreview: () => ipcRenderer.invoke('preview:minimize'),

  // Toggle maximize/zoom the preview window
  maximizePreview: () => ipcRenderer.invoke('preview:maximize'),

  // Focus the main window (bring it above preview window)
  focusMainWindow: () => ipcRenderer.invoke('preview:focus-main'),

  // Focus the preview window itself (bring it above main window)
  focusPreviewWindow: () => ipcRenderer.invoke('preview:focus-self'),

  // Listen for preview data (used by preview.html window)
  onPreviewData: (callback) => {
    ipcRenderer.on('preview:data', (event, data) => callback(data));
  },

  // Fetch real-time stock prices from Sina Finance API
  // codes: array of Sina codes like ['sh600519', 'sz000001']
  // returns: { 'sh600519': { name, open, yesterdayClose, current, high, low }, ... }
  fetchStockPrices: (codes) => ipcRenderer.invoke('stock:fetch', codes),

  // Fetch real-time market indices (Shanghai Composite, Shenzhen Component, ChiNext, STAR 50, Hang Seng Tech)
  // returns: array of { code, name, current, change, changePercent }
  fetchMarketIndices: () => ipcRenderer.invoke('market:fetch-indices'),

  // Fetch latest financial news from 同花顺
  // returns: array of { title, url, intro, publishTime, media, tags }
  fetchFinancialNews: () => ipcRenderer.invoke('market:fetch-news'),

  // Fetch full content of a news article from its URL
  // returns: { title, content }
  fetchNewsContent: (url) => ipcRenderer.invoke('market:fetch-news-content', url),

  // Fetch real-time exchange rates against CNY
  // codes: optional array of Sina fx codes like ['fx_susdcny', 'fx_seurcny', 'fx_shkdcny']
  // If omitted, fetches all available currencies
  // returns: array of { code, name, current, yesterdayClose, change, changePercent }
  fetchExchangeRates: (codes) => ipcRenderer.invoke('market:fetch-fx', codes),

  // Fetch historical FX daily K-line data
  // sinaCode: e.g. 'fx_susdcny', period: '5y'|'3y'|'1y'|'3m'|'1m'
  // returns: { klines: [{date,open,close,high,low}], name } or { error }
  fetchFxHistory: (params) => ipcRenderer.invoke('market:fetch-fx-history', params),

  // Fetch stock K-line data (intraday/daily/weekly/monthly)
  // params: { sinaCode, stockCode, market, period }
  // returns: { klines: [{date,open,close,high,low}], name } or { error }
  fetchStockKline: (params) => ipcRenderer.invoke('stock:fetch-kline', params),

  // Show a system notification for price alerts
  showStockNotification: (options) => ipcRenderer.invoke('stock:notify', options),

  // Fetch stock basic info (name, price, PE, PB, market cap, industry, company intro, peers)
  // code: stock code like "600519", "000001", "00700" or name like "茅台"
  // returns: { name, code, price, marketCap, pe, pb, industry, orgProfile, mainBusiness, peers, ... } or { error }
  fetchStockInfo: (code) => ipcRenderer.invoke('stock:info', code),

  // Search stocks by name or code (supports Chinese and English)
  // keyword: e.g. "贵州茅台", "茅台", "600519"
  // returns: [{ code, name, market }] or []
  searchStocks: (keyword) => ipcRenderer.invoke('stock:search', keyword),

  // Fetch macroeconomic indicators (CPI, PPI, PMI, Retail Sales, M1/M2)
  // returns: { cpi, ppi, pmi, retail, moneySupply }
  fetchMacroData: () => ipcRenderer.invoke('macro:fetch'),

  // Fetch real-time domestic gold price (Shanghai Gold Exchange Au99.99 spot)
  // returns: { name, code, current, yesterdayClose, open, high, low, change, changePercent } or null
  fetchGoldPrice: () => ipcRenderer.invoke('market:fetch-gold'),

  // Fetch historical K-line data for market indices
  // params: { sinaCode, period } period: '5y'|'3y'|'1y'|'3m'|'1m'
  // returns: { klines: [{date,open,close,high,low}], name } or { error }
  fetchIndexHistory: (params) => ipcRenderer.invoke('market:fetch-index-history', params),

  // Fetch historical K-line data for domestic gold
  // params: { period } period: '5y'|'3y'|'1y'|'3m'|'1m'
  // returns: { klines: [{date,open,close,high,low}], name } or { error }
  fetchGoldHistory: (params) => ipcRenderer.invoke('market:fetch-gold-history', params),

  // Fetch historical data for macroeconomic indicators
  // params: { indicator, period } indicator: 'cpi'|'ppi'|'pmi'|'gdp'|'retail'|'m2'|'m1'|..., period: '5y'|'3y'|'1y'
  // returns: { data: [{date, value, yoy}], name } or { error }
  fetchMacroHistory: (params) => ipcRenderer.invoke('macro:fetch-history', params),

  // Save a file using native save dialog
  // params: { defaultPath, content (string or Buffer), filters: [{name, extensions: []}] }
  // returns: { success, filePath, canceled, error }
  saveFile: (params) => ipcRenderer.invoke('file:save', params),

  // Cloud Drive sync APIs
  // Check available cloud drives and current selection
  icloudAvailable: () => ipcRenderer.invoke('icloud:available'),
  // Save data to cloud drive
  icloudSave: (params) => ipcRenderer.invoke('icloud:save', params),
  // Load data from cloud drive
  icloudLoad: () => ipcRenderer.invoke('icloud:load'),
  // Get cloud sync status
  icloudStatus: () => ipcRenderer.invoke('icloud:status'),
  // Open the app's cloud folder in file manager
  icloudOpenFolder: () => ipcRenderer.invoke('icloud:open-folder'),
  // Select one of the automatically detected cloud drives
  cloudSetPath: (params) => ipcRenderer.invoke('cloud:set-path', params),
  // Clear the selected drive and revert to auto-detection
  cloudClearPath: () => ipcRenderer.invoke('cloud:clear-path'),
  // Baidu Netdisk OAuth and remote backup APIs
  baiduBeginAuth: () => ipcRenderer.invoke('baidu:begin-auth'),
  baiduExchangeCode: (params) => ipcRenderer.invoke('baidu:exchange-code', params),
  baiduStatus: () => ipcRenderer.invoke('baidu:status'),
  baiduSave: (params) => ipcRenderer.invoke('baidu:save', params),
  baiduLoad: () => ipcRenderer.invoke('baidu:load'),
  baiduLogout: () => ipcRenderer.invoke('baidu:logout'),

  // Windows titlebar controls (frameless window)
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximizeToggle: () => ipcRenderer.invoke('win:maximize-toggle'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winIsMaximized: () => ipcRenderer.invoke('win:is-maximized')
});
