/**
 * Preload: expose a minimal desktop API to the renderer (contextIsolation).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ablitDesktop', {
  getLicense: () => ipcRenderer.invoke('ablit:getLicense'),
  setLicense: (key) => ipcRenderer.invoke('ablit:setLicense', key),
  getDeviceId: () => ipcRenderer.invoke('ablit:getDeviceId'),
  getVersion: () => ipcRenderer.invoke('ablit:getVersion'),
  webSearch: (opts) => ipcRenderer.invoke('ablit:webSearch', opts),
  openExternal: (url) => ipcRenderer.invoke('ablit:openExternal', url),
  sparkInstallPath: () => ipcRenderer.invoke('ablit:sparkInstallPath'),
  revealSparkInstall: () => ipcRenderer.invoke('ablit:revealSparkInstall'),
  onLicenseDeepLink: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, key) => {
      try {
        cb(typeof key === 'string' ? key : '');
      } catch {
        /* renderer callback errors stay in renderer */
      }
    };
    ipcRenderer.on('ablit:licenseDeepLink', handler);
    return () => {
      ipcRenderer.removeListener('ablit:licenseDeepLink', handler);
    };
  },
  platform: process.platform,
  checkUpdate: () => ipcRenderer.invoke('ablit:checkUpdate'),
  downloadUpdate: () => ipcRenderer.invoke('ablit:downloadUpdate'),
  quitAndInstall: () => ipcRenderer.invoke('ablit:quitAndInstall'),
  startSparkImage: (alias) => ipcRenderer.invoke('ablit:startSparkImage', alias),
  onUpdateStatus: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => {
      try {
        cb(payload);
      } catch {
        /* renderer */
      }
    };
    ipcRenderer.on('ablit:updateStatus', handler);
    return () => ipcRenderer.removeListener('ablit:updateStatus', handler);
  },
});
