// 一次性/防御性工具：把已落盘的 QA 取证 JSON 里的凭据与签名参数脱敏。
// 探针本身已内联 redact；此脚本用于清理历史产物与二次校验。
import { readFileSync, writeFileSync } from 'node:fs'

export const SENSITIVE_QUERY =
  /\b(apikey|api_key|access_token|token|vuutv|vkey|sign|w_rid|deadline|auth)=([^&\s"'`\\]+)/gi

export function redactSecrets(value) {
  return value.replace(SENSITIVE_QUERY, (_m, key) => `${key}=***REDACTED***`)
}

const files = process.argv.slice(2)
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const out = redactSecrets(src)
  if (out !== src) {
    writeFileSync(file, out)
    console.log(`scrubbed ${file}`)
  } else {
    console.log(`clean ${file}`)
  }
}
