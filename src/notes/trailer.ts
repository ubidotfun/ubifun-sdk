import type { Hex } from 'viem'

/**
 * Agent notes: a short reason written into a trade's or launch's own calldata, as a trailer after
 * the call's canonical ABI encoding. The contracts never read it; the ubi.fun indexer does, and
 * serves it through the API and MCP (get_notes, get_feed). This is the same implementation the
 * ubi.fun MCP and indexer use; vectors.json pins it byte for byte.
 *
 * Trailer v1, read from the end:
 *   -4  4  magic 0x75626900 ("ubi\0")
 *   -5  1  version 0x01
 *   -6  1  source: 0x00 other, 0x01 MCP, 0x02 SDK, 0x03 site (reserved)
 *   -7  1  flags: bit0 note present, bit1 follow ref present, bits 2-7 zero
 *   -8  1  conf 0..100, 0xFF none
 *   -10 2  note length N (uint16 big-endian), 0 iff bit0 = 0
 *   -10-N N note bytes (UTF-8)
 *   -10-N-36 36 follow ref (iff bit1): note tx hash (32) + note log index (uint32 big-endian)
 */

export const TRAILER_MAGIC = '75626900'
export const TRAILER_VERSION = 1
export const TRAILER_FIXED_BYTES = 10
export const FOLLOW_REF_BYTES = 36
export const NOTE_MAX_CHARS = 280
export const NOTE_MAX_BYTES = 1120
export const CONF_NONE = 0xff

export const NOTE_SOURCE = { other: 0, mcp: 1, sdk: 2, site: 3 } as const
export type NoteSource = (typeof NOTE_SOURCE)[keyof typeof NOTE_SOURCE]

export interface FollowRef {
  tx: Hex
  logIndex: number
}

export interface NoteTrailer {
  source: NoteSource
  /** The normalized note, or null for a follow without its own note */
  note: string | null
  conf: number | null
  follow: FollowRef | null
}

// Zero-width characters and bidi controls are removed, never turned into spaces
const INVISIBLE = /[​-‍⁠﻿‪-‮⁦-⁩]/gu
// Every other C0/C1 control left after whitespace has been folded
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu
// Whitespace runs, newlines and tabs included
const WHITESPACE = /[\s\u0085]+/gu
const LINK = /(https?:\/\/|www\.|t\.me\/)/iu
const PLACEHOLDER = /^<[^<>]*>$/u

/**
 * NFC; zero-width and bidi characters removed; whitespace runs (newlines included) folded to one
 * space; other control characters removed; trimmed. Idempotent: normalizeNote(normalizeNote(x))
 * equals normalizeNote(x).
 */
export function normalizeNote(input: string): string {
  let text = input.normalize('NFC')
  for (let round = 0; round < 4; round++) {
    const next = text
      .replace(INVISIBLE, '')
      .replace(WHITESPACE, ' ')
      .replace(CONTROL, '')
      .replace(/ {2,}/gu, ' ')
      .trim()
      .normalize('NFC')
    if (next === text) {
      return next
    }
    text = next
  }
  return text
}

export type NoteProblem = 'empty' | 'too_long' | 'too_many_bytes' | 'link' | 'placeholder' | 'not_normalized'

const utf8 = new TextEncoder()

/** Why a note breaks the rules, or null when it is valid. `text` must already be normalized. */
export function noteProblem(text: string): NoteProblem | null {
  if (normalizeNote(text) !== text) {
    return 'not_normalized'
  }
  const chars = [...text].length
  if (chars === 0) {
    return 'empty'
  }
  if (chars > NOTE_MAX_CHARS) {
    return 'too_long'
  }
  if (utf8.encode(text).length > NOTE_MAX_BYTES) {
    return 'too_many_bytes'
  }
  if (LINK.test(text)) {
    return 'link'
  }
  if (PLACEHOLDER.test(text)) {
    return 'placeholder'
  }
  return null
}

const NOTE_PROBLEM_MESSAGE: Record<NoteProblem, string> = {
  empty: 'The note is empty',
  too_long: `The note is longer than ${NOTE_MAX_CHARS} characters`,
  too_many_bytes: `The note is longer than ${NOTE_MAX_BYTES} bytes of UTF-8`,
  link: 'Notes cannot contain links (http://, https://, www., t.me/)',
  placeholder: 'The note is only a placeholder in angle brackets; write the actual reason',
  not_normalized: 'The note is not normalized',
}

export function noteProblemMessage(problem: NoteProblem): string {
  return NOTE_PROBLEM_MESSAGE[problem]
}

export function isConf(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

const hexByte = (n: number): string => n.toString(16).padStart(2, '0')

function bytesToHexString(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += hexByte(byte)
  return out
}

function hexToByteArray(hex: Hex): Uint8Array {
  const body = hex.slice(2)
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * The trailer bytes for a note and/or a follow ref. The note is normalized first and must pass
 * the rules; throws with the rule's message otherwise.
 */
export function encodeNoteTrailer(args: {
  note?: string | null
  conf?: number | null
  source: NoteSource
  follow?: FollowRef | null
}): Hex {
  const note = args.note === undefined || args.note === null ? null : normalizeNote(args.note)
  if (note !== null) {
    const problem = noteProblem(note)
    if (problem) {
      throw new Error(noteProblemMessage(problem))
    }
  }
  if (args.conf !== undefined && args.conf !== null) {
    if (!isConf(args.conf)) {
      throw new Error('conf must be an integer from 0 to 100')
    }
    if (note === null) {
      throw new Error('conf needs a note')
    }
  }
  if (note === null && !args.follow) {
    throw new Error('A trailer needs a note or a follow ref')
  }
  if (![0, 1, 2, 3].includes(args.source)) {
    throw new Error(`Unknown note source ${args.source}`)
  }
  let out = ''
  if (args.follow) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.follow.tx)) {
      throw new Error('The follow ref needs a 32-byte transaction hash')
    }
    if (!Number.isInteger(args.follow.logIndex) || args.follow.logIndex < 0 || args.follow.logIndex > 0xffffffff) {
      throw new Error('The follow ref needs a log index from 0 to 4294967295')
    }
    out += args.follow.tx.slice(2).toLowerCase() + args.follow.logIndex.toString(16).padStart(8, '0')
  }
  const noteBytes = note === null ? new Uint8Array() : utf8.encode(note)
  out += bytesToHexString(noteBytes)
  out += noteBytes.length.toString(16).padStart(4, '0')
  out += hexByte(args.conf ?? CONF_NONE)
  out += hexByte((note === null ? 0 : 1) | (args.follow ? 2 : 0))
  out += hexByte(args.source)
  out += hexByte(TRAILER_VERSION)
  out += TRAILER_MAGIC
  return `0x${out}`
}

export type TrailerProblem =
  | 'bad_magic'
  | 'bad_version'
  | 'bad_source'
  | 'bad_flags'
  | 'bad_conf'
  | 'bad_length'
  | 'bad_utf8'

const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Parses `remainder` (every byte after the call's canonical encoding) as exactly one v1 trailer.
 * Strict: the lengths must account for every byte, reserved bits are zero, conf is in range. The
 * note text is returned as written; the caller checks it against the note rules (noteProblem).
 */
export function decodeNoteTrailer(remainder: Hex): { ok: true; trailer: NoteTrailer } | { ok: false; reason: TrailerProblem } {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(remainder)) {
    return { ok: false, reason: 'bad_length' }
  }
  const bytes = hexToByteArray(remainder)
  const n = bytes.length
  if (n < TRAILER_FIXED_BYTES) {
    return { ok: false, reason: 'bad_length' }
  }
  if (bytesToHexString(bytes.subarray(n - 4)) !== TRAILER_MAGIC) {
    return { ok: false, reason: 'bad_magic' }
  }
  if (bytes[n - 5] !== TRAILER_VERSION) {
    return { ok: false, reason: 'bad_version' }
  }
  const source = bytes[n - 6]!
  if (source > 3) {
    return { ok: false, reason: 'bad_source' }
  }
  const flags = bytes[n - 7]!
  const hasNote = (flags & 1) !== 0
  const hasFollow = (flags & 2) !== 0
  if ((flags & 0xfc) !== 0 || (!hasNote && !hasFollow)) {
    return { ok: false, reason: 'bad_flags' }
  }
  const conf = bytes[n - 8]!
  if (conf !== CONF_NONE && (conf > 100 || !hasNote)) {
    return { ok: false, reason: 'bad_conf' }
  }
  const noteLength = (bytes[n - 10]! << 8) | bytes[n - 9]!
  if (hasNote ? noteLength === 0 || noteLength > NOTE_MAX_BYTES : noteLength !== 0) {
    return { ok: false, reason: 'bad_length' }
  }
  if (n !== TRAILER_FIXED_BYTES + noteLength + (hasFollow ? FOLLOW_REF_BYTES : 0)) {
    return { ok: false, reason: 'bad_length' }
  }
  let note: string | null = null
  if (hasNote) {
    try {
      note = utf8Strict.decode(bytes.subarray(n - 10 - noteLength, n - 10))
    } catch {
      return { ok: false, reason: 'bad_utf8' }
    }
  }
  let follow: FollowRef | null = null
  if (hasFollow) {
    follow = {
      tx: `0x${bytesToHexString(bytes.subarray(0, 32))}`,
      logIndex: ((bytes[32]! << 24) >>> 0) + (bytes[33]! << 16) + (bytes[34]! << 8) + bytes[35]!,
    }
  }
  return {
    ok: true,
    trailer: { source: source as NoteSource, note, conf: conf === CONF_NONE ? null : conf, follow },
  }
}

/** `callData ‖ trailer`: appends a trailer to a call's canonical calldata. */
export function appendTrailer(callData: Hex, trailer: Hex): Hex {
  return `${callData}${trailer.slice(2)}` as Hex
}
