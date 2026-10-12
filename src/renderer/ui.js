import {
  createIcons, ScanLine, Smartphone, Copy, ExternalLink, Keyboard, Wifi,
  Trash2, ScanBarcode, Camera, SwitchCamera, Flashlight, Send, Pause, Check, Settings
} from 'lucide';
const icons = {
  ScanLine, Smartphone, Copy, ExternalLink, Keyboard, Wifi,
  Trash2, ScanBarcode, Camera, SwitchCamera, Flashlight, Send, Pause, Check, Settings
};
export function refreshIcons() { createIcons({ icons, attrs: { 'aria-hidden': 'true' } }); }
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
export function time(value, language = 'zh') {
  return new Date(value).toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
}
