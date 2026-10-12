import {
  createIcons, ScanLine, Smartphone, Copy, ExternalLink, Keyboard, Wifi,
  Trash2, ScanBarcode, Camera, SwitchCamera, Flashlight, Send, Pause, Check
} from 'lucide';
const icons = {
  ScanLine, Smartphone, Copy, ExternalLink, Keyboard, Wifi,
  Trash2, ScanBarcode, Camera, SwitchCamera, Flashlight, Send, Pause, Check
};
export function refreshIcons() { createIcons({ icons, attrs: { 'aria-hidden': 'true' } }); }
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
export function time(value) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}
