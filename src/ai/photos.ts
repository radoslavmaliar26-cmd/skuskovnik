import { db } from '../db/db'
import { fmtTime } from '../lib/text'
import type { ContentBlock } from './anthropic'

export const MAX_PHOTO_PX = 1568
const MAX_PHOTOS_PER_REQUEST = 12

/** Zmenší obrázok na max. 1568 px na dlhšej strane a vráti JPEG. */
export async function resizeImage(blob: Blob, max = MAX_PHOTO_PX): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Obrázok sa nepodarilo spracovať.')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Obrázok sa nepodarilo uložiť.'))), 'image/jpeg', 0.85))
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}

/** Fotky tabule/slajdov z daného časového rozsahu ako obrázkové bloky pre Claude. */
export async function photosForPrompt(lectureId: string, from: number, to: number): Promise<{ blocks: ContentBlock[]; note: string }> {
  let photos = await db.photos.where('lectureId').equals(lectureId).toArray()
  photos = photos.filter((p) => p.t >= from - 1 && p.t < to + 1).sort((a, b) => a.t - b.t).slice(0, MAX_PHOTOS_PER_REQUEST)
  if (!photos.length) return { blocks: [], note: '' }
  const blocks: ContentBlock[] = photos.map((p) => ({
    type: 'image',
    source: { type: 'base64', media_type: p.mime || 'image/jpeg', data: toBase64(p.data) },
  }))
  const note = `\n\nPRILOŽENÉ FOTKY tabule/slajdov (v poradí): ${photos.map((p, i) => `foto ${i + 1} [${fmtTime(p.t)}]`).join(', ')}. Využi ich obsah (vzorce, nákresy) a priraď ich k správnej sekcii podľa času.`
  return { blocks, note }
}
