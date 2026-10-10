// Minimal dependency-free ZIP reader/writer for the release packaging scripts.
// Replaces System.IO.Compression.ZipFile usage from the PowerShell pipeline.
// Supports the subset these scripts require: deflate/store entries, UTF-8
// names, ZIP64 archives, raw (recompression-free) entry copies, and the Unix
// external attributes needed to reject filesystem links.
import { open, readFile } from 'node:fs/promises'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const ZIP64_LIMIT = 0xffffffff
const ZIP64_EXTRA = 0x0001

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export class ZipReader {
  #buffer

  constructor(buffer) {
    this.#buffer = buffer
    this.entries = this.#readCentralDirectory()
  }

  static async open(path) {
    return new ZipReader(await readFile(path))
  }

  #findEndOfCentralDirectory() {
    const buffer = this.#buffer
    const floor = Math.max(0, buffer.length - 22 - 65535)
    for (let offset = buffer.length - 22; offset >= floor; offset -= 1) {
      if (buffer.readUInt32LE(offset) !== EOCD) continue
      let count = buffer.readUInt16LE(offset + 10)
      let directorySize = buffer.readUInt32LE(offset + 12)
      let directoryOffset = buffer.readUInt32LE(offset + 16)
      if (count === 0xffff || directorySize === ZIP64_LIMIT || directoryOffset === ZIP64_LIMIT) {
        const locator = offset - 20
        if (locator < 0 || buffer.readUInt32LE(locator) !== EOCD64_LOCATOR) throw new Error('Missing ZIP64 end-of-central-directory locator')
        const eocd64 = Number(buffer.readBigUInt64LE(locator + 8))
        if (buffer.readUInt32LE(eocd64) !== EOCD64) throw new Error('Invalid ZIP64 end-of-central-directory record')
        count = Number(buffer.readBigUInt64LE(eocd64 + 32))
        directorySize = Number(buffer.readBigUInt64LE(eocd64 + 40))
        directoryOffset = Number(buffer.readBigUInt64LE(eocd64 + 48))
      }
      return { count, directorySize, directoryOffset }
    }
    throw new Error('Not a ZIP archive: end-of-central-directory record is missing')
  }

  #readCentralDirectory() {
    const buffer = this.#buffer
    const { count, directoryOffset } = this.#findEndOfCentralDirectory()
    const entries = []
    let offset = directoryOffset
    for (let index = 0; index < count; index += 1) {
      if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER) throw new Error('Corrupt ZIP central directory')
      const flags = buffer.readUInt16LE(offset + 8)
      if (flags & 0x0001) throw new Error('Encrypted ZIP entries are not supported')
      const entry = {
        versionMadeBy: buffer.readUInt16LE(offset + 4),
        method: buffer.readUInt16LE(offset + 10),
        dosTime: buffer.readUInt16LE(offset + 12),
        dosDate: buffer.readUInt16LE(offset + 14),
        crc32: buffer.readUInt32LE(offset + 16),
        compressedSize: buffer.readUInt32LE(offset + 20),
        uncompressedSize: buffer.readUInt32LE(offset + 24),
        externalAttributes: buffer.readUInt32LE(offset + 38),
        headerOffset: buffer.readUInt32LE(offset + 42),
      }
      const nameLength = buffer.readUInt16LE(offset + 28)
      const extraLength = buffer.readUInt16LE(offset + 30)
      const commentLength = buffer.readUInt16LE(offset + 32)
      entry.name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
      let extraOffset = offset + 46 + nameLength
      const extraEnd = extraOffset + extraLength
      while (extraOffset + 4 <= extraEnd) {
        const id = buffer.readUInt16LE(extraOffset)
        const size = buffer.readUInt16LE(extraOffset + 2)
        if (id === ZIP64_EXTRA) {
          let field = extraOffset + 4
          for (const key of ['uncompressedSize', 'compressedSize', 'headerOffset']) {
            if (entry[key] === ZIP64_LIMIT && field + 8 <= extraOffset + 4 + size) {
              entry[key] = Number(buffer.readBigUInt64LE(field))
              field += 8
            }
          }
        }
        extraOffset += 4 + size
      }
      entry.isDirectory = entry.name.endsWith('/')
      entries.push(entry)
      offset = extraEnd + commentLength
    }
    return entries
  }

  // Raw stored bytes of one entry, without decompressing.
  rawData(entry) {
    const buffer = this.#buffer
    const offset = entry.headerOffset
    if (buffer.readUInt32LE(offset) !== LOCAL_HEADER) throw new Error(`Corrupt ZIP local header: ${entry.name}`)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    return buffer.subarray(start, start + entry.compressedSize)
  }

  read(entry) {
    const raw = this.rawData(entry)
    let data
    if (entry.method === 0) data = Buffer.from(raw)
    else if (entry.method === 8) data = inflateRawSync(raw)
    else throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`)
    if (data.length !== entry.uncompressedSize || (crc32(data) >>> 0) !== entry.crc32) {
      throw new Error(`Corrupt ZIP entry: ${entry.name}`)
    }
    return data
  }
}

export class ZipWriter {
  #handle
  #offset = 0
  #directory = []

  constructor(handle) {
    this.#handle = handle
  }

  // Creates the archive file exclusively; an existing file is never replaced.
  static async create(path) {
    return new ZipWriter(await open(path, 'wx'))
  }

  async #write(buffer) {
    await this.#handle.write(buffer)
    this.#offset += buffer.length
  }

  async #writeEntry(name, { method, crc, data, uncompressedSize, externalAttributes, versionMadeBy, dosTime, dosDate }) {
    const nameBytes = Buffer.from(name, 'utf8')
    if (nameBytes.length > 0xffff) throw new Error(`ZIP entry name is too long: ${name}`)
    const headerOffset = this.#offset
    const zip64 = data.length >= ZIP64_LIMIT || uncompressedSize >= ZIP64_LIMIT
    const local = Buffer.alloc(30 + nameBytes.length + (zip64 ? 20 : 0))
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(zip64 ? 45 : 20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(zip64 ? ZIP64_LIMIT : data.length, 18)
    local.writeUInt32LE(zip64 ? ZIP64_LIMIT : uncompressedSize, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(zip64 ? 20 : 0, 28)
    nameBytes.copy(local, 30)
    if (zip64) {
      const extra = 30 + nameBytes.length
      local.writeUInt16LE(ZIP64_EXTRA, extra)
      local.writeUInt16LE(16, extra + 2)
      local.writeBigUInt64LE(BigInt(uncompressedSize), extra + 4)
      local.writeBigUInt64LE(BigInt(data.length), extra + 12)
    }
    await this.#write(local)
    await this.#write(data)
    this.#directory.push({
      nameBytes, method, crc: crc >>> 0, compressedSize: data.length, uncompressedSize,
      externalAttributes: externalAttributes >>> 0, versionMadeBy, dosTime, dosDate, headerOffset,
    })
  }

  async addEntry(name, data, { compress = true, externalAttributes = 0, date = new Date() } = {}) {
    const { time, date: dosDate } = dosDateTime(date)
    const deflated = compress ? deflateRawSync(data, { level: 9 }) : null
    const useDeflate = deflated !== null && deflated.length < data.length
    await this.#writeEntry(name, {
      method: useDeflate ? 8 : 0,
      crc: crc32(data),
      data: useDeflate ? deflated : data,
      uncompressedSize: data.length,
      externalAttributes,
      versionMadeBy: 45,
      dosTime: time,
      dosDate,
    })
  }

  // Copies an already-compressed entry from a ZipReader without recompression,
  // preserving its metadata.
  async addRawEntry(entry, rawData) {
    await this.#writeEntry(entry.name, {
      method: entry.method,
      crc: entry.crc32,
      data: rawData,
      uncompressedSize: entry.uncompressedSize,
      externalAttributes: entry.externalAttributes,
      versionMadeBy: entry.versionMadeBy,
      dosTime: entry.dosTime,
      dosDate: entry.dosDate,
    })
  }

  async close() {
    const directoryOffset = this.#offset
    for (const entry of this.#directory) {
      const zip64Fields = []
      if (entry.uncompressedSize >= ZIP64_LIMIT) zip64Fields.push(BigInt(entry.uncompressedSize))
      if (entry.compressedSize >= ZIP64_LIMIT) zip64Fields.push(BigInt(entry.compressedSize))
      if (entry.headerOffset >= ZIP64_LIMIT) zip64Fields.push(BigInt(entry.headerOffset))
      const extraLength = zip64Fields.length ? 4 + zip64Fields.length * 8 : 0
      const record = Buffer.alloc(46 + entry.nameBytes.length + extraLength)
      record.writeUInt32LE(CENTRAL_HEADER, 0)
      record.writeUInt16LE(entry.versionMadeBy, 4)
      record.writeUInt16LE(zip64Fields.length ? 45 : 20, 6)
      record.writeUInt16LE(0x0800, 8)
      record.writeUInt16LE(entry.method, 10)
      record.writeUInt16LE(entry.dosTime, 12)
      record.writeUInt16LE(entry.dosDate, 14)
      record.writeUInt32LE(entry.crc, 16)
      record.writeUInt32LE(entry.compressedSize >= ZIP64_LIMIT ? ZIP64_LIMIT : entry.compressedSize, 20)
      record.writeUInt32LE(entry.uncompressedSize >= ZIP64_LIMIT ? ZIP64_LIMIT : entry.uncompressedSize, 24)
      record.writeUInt16LE(entry.nameBytes.length, 28)
      record.writeUInt16LE(extraLength, 30)
      record.writeUInt32LE(entry.externalAttributes, 38)
      record.writeUInt32LE(entry.headerOffset >= ZIP64_LIMIT ? ZIP64_LIMIT : entry.headerOffset, 42)
      entry.nameBytes.copy(record, 46)
      if (extraLength) {
        const extra = 46 + entry.nameBytes.length
        record.writeUInt16LE(ZIP64_EXTRA, extra)
        record.writeUInt16LE(zip64Fields.length * 8, extra + 2)
        zip64Fields.forEach((value, index) => record.writeBigUInt64LE(value, extra + 4 + index * 8))
      }
      await this.#write(record)
    }
    const directorySize = this.#offset - directoryOffset
    const count = this.#directory.length
    if (count > 0xffff || directorySize >= ZIP64_LIMIT || directoryOffset >= ZIP64_LIMIT) {
      const eocd64Offset = this.#offset
      const eocd64 = Buffer.alloc(56)
      eocd64.writeUInt32LE(EOCD64, 0)
      eocd64.writeBigUInt64LE(44n, 4)
      eocd64.writeUInt16LE(45, 12)
      eocd64.writeUInt16LE(45, 14)
      eocd64.writeBigUInt64LE(BigInt(count), 24)
      eocd64.writeBigUInt64LE(BigInt(count), 32)
      eocd64.writeBigUInt64LE(BigInt(directorySize), 40)
      eocd64.writeBigUInt64LE(BigInt(directoryOffset), 48)
      await this.#write(eocd64)
      const locator = Buffer.alloc(20)
      locator.writeUInt32LE(EOCD64_LOCATOR, 0)
      locator.writeBigUInt64LE(BigInt(eocd64Offset), 8)
      locator.writeUInt32LE(1, 16)
      await this.#write(locator)
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(EOCD, 0)
    eocd.writeUInt16LE(Math.min(count, 0xffff), 8)
    eocd.writeUInt16LE(Math.min(count, 0xffff), 10)
    eocd.writeUInt32LE(Math.min(directorySize, ZIP64_LIMIT), 12)
    eocd.writeUInt32LE(Math.min(directoryOffset, ZIP64_LIMIT), 16)
    await this.#write(eocd)
    await this.#handle.close()
  }

  async abort() {
    await this.#handle.close().catch(() => {})
  }
}

// True when the entry's Unix mode marks a symbolic link.
export function isZipLink(entry) {
  return ((entry.externalAttributes >>> 16) & 0xf000) === 0xa000
}
