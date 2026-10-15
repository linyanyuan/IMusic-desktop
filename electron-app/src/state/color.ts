/**
 * 颜色工具 —— Dart 侧设置项里的颜色是 ARGB int（如 0xff1ed760），
 * 抽屉与独立歌词窗口必须用同一套转换（含 alpha），否则同一设置两处观感不一致。
 */

/** 0xAARRGGBB → CSS rgba()（保留 alpha） */
export function argbToCss(value: number): string {
  const a = ((value >>> 24) & 0xff) / 255
  const r = (value >>> 16) & 0xff
  const g = (value >>> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
}
