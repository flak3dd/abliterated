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
});
