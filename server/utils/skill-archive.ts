import { gzipSync } from 'node:zlib'

/** Small fixed-file ustar bundle; no filesystem paths or credentials are taken from the request. */
export function skillArchive(files: { path: string; content: Buffer }[]) {
  const chunks: Buffer[] = []
  for (const file of files) {
    const name = `requirement-board/${file.path}`
    if (Buffer.byteLength(name) > 100 || name.includes('..') || name.includes('\\')) throw new Error('Invalid skill archive path')
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000644\0', 100, 8)
    header.write('0000000\0', 108, 8)
    header.write('0000000\0', 116, 8)
    header.write(file.content.length.toString(8).padStart(11, '0') + '\0', 124, 12)
    header.write('00000000000\0', 136, 12)
    header.fill(32, 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    const sum = header.reduce((total, byte) => total + byte, 0)
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    chunks.push(header, file.content, Buffer.alloc((512 - file.content.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}
