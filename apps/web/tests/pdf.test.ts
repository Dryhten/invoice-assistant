import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib'
import { buildMergedInvoicePdf } from '../src/pdf'

type PageBox = {
  x: number
  y: number
  width: number
  height: number
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function createPdfFile(name: string, mediaSize: [number, number], cropBox?: PageBox) {
  const source = await PDFDocument.create()
  const page = source.addPage(mediaSize)
  if (cropBox) {
    page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height)
  }
  page.drawText('invoice', { x: 40, y: cropBox ? cropBox.y + 40 : 40, size: 16 })

  const bytes = await source.save()
  const arrayBuffer = bytesToArrayBuffer(bytes)
  return {
    name,
    type: 'application/pdf',
    arrayBuffer: async () => arrayBuffer,
  } as File
}

function createHeaderCommentPdfFile(commentSeparator: string, streamComment = '') {
  // Synthetic data only: reproduce a content object glued to the producer's header comment.
  const content = `${streamComment}BT /F1 12 Tf 20 40 Td (SAMPLE INVOICE) Tj ET\n`
  const compressed = deflateSync(content).toString('latin1')
  const objects: [number, string][] = [
    [5, `<< /Length 6 0 R /Filter /FlateDecode >>\nstream\n${compressed}\nendstream`],
    [6, String(compressed.length)],
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 397] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  ]
  let pdf = `%PDF-1.7\n% synthetic invoice\n%%ULC:1.01.01${commentSeparator}`
  const offsets = new Map<number, number>()
  for (const [id, body] of objects) {
    offsets.set(id, pdf.length)
    pdf += `${id} 0 obj\n${body}\nendobj\n`
  }
  const xrefOffset = pdf.length
  pdf += 'xref\n0 7\n0000000000 65535 f \n'
  for (let id = 1; id <= 6; id += 1) {
    pdf += `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  const bytes = Uint8Array.from(pdf, (character) => character.charCodeAt(0))
  const arrayBuffer = bytesToArrayBuffer(bytes)
  return {
    name: 'synthetic-invoice.pdf',
    type: 'application/pdf',
    arrayBuffer: async () => arrayBuffer,
  } as File
}

async function readFirstEmbeddedPageBox(file: File) {
  const blob = await buildMergedInvoicePdf([file])
  if (!blob) {
    throw new Error('Expected merged PDF blob')
  }

  const merged = await PDFDocument.load(await blobToArrayBuffer(blob))
  const resources = merged.getPage(0).node.Resources()
  const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  const firstXObjectRef = xObjects?.entries()[0]?.[1]
  if (!firstXObjectRef) {
    throw new Error('Expected embedded PDF page XObject')
  }

  const firstXObject = merged.context.lookup(firstXObjectRef, PDFStream)
  return firstXObject.dict.lookup(PDFName.of('BBox'), PDFArray).asRectangle()
}

describe('PDF merge helper', () => {
  it('returns null when there are no supported files', async () => {
    await expect(buildMergedInvoicePdf([])).resolves.toBeNull()
    await expect(buildMergedInvoicePdf([new File(['plain text'], 'notes.txt', { type: 'text/plain' })])).resolves.toBeNull()
  })

  it('embeds the visible crop box instead of shrinking an A4 media box', async () => {
    const file = await createPdfFile('cropped-invoice.pdf', [595, 842], {
      x: 0,
      y: 426,
      width: 595,
      height: 416,
    })

    const embeddedBox = await readFirstEmbeddedPageBox(file)

    expect(embeddedBox).toEqual({ x: 0, y: 426, width: 595, height: 416 })
  })

  it('keeps ordinary uncropped PDF pages mergeable', async () => {
    const file = await createPdfFile('ordinary-invoice.pdf', [595, 397])

    const embeddedBox = await readFirstEmbeddedPageBox(file)

    expect(embeddedBox).toEqual({ x: 0, y: 0, width: 595, height: 397 })
  })

  it.each([' ', '\t', '\n', '\r\n'])('preserves invoice content with a %j header separator', async (separator) => {
    const file = createHeaderCommentPdfFile(separator)
    const originalBytes = new Uint8Array(await file.arrayBuffer()).slice()
    const blob = await buildMergedInvoicePdf([file])
    expect(blob).not.toBeNull()
    const merged = await PDFDocument.load(await blobToArrayBuffer(blob!))
    expect(merged.getPageCount()).toBe(1)
    const xObjects = merged.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const embedded = xObjects.lookup(xObjects.keys()[0])
    if (!(embedded instanceof PDFRawStream)) {
      throw new Error('Expected embedded PDF page stream')
    }
    const content = new TextDecoder().decode(decodePDFRawStream(embedded).decode())
    expect(content).toContain('(SAMPLE INVOICE) Tj')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(originalBytes)
  })

  it('leaves producer-like comments inside content streams untouched', async () => {
    const streamComment = '%%ULC:1.01.01 99 0 obj\n'
    const file = createHeaderCommentPdfFile('\n', streamComment)
    const blob = await buildMergedInvoicePdf([file])
    const merged = await PDFDocument.load(await blobToArrayBuffer(blob!))
    const xObjects = merged.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const embedded = xObjects.lookup(xObjects.keys()[0])
    if (!(embedded instanceof PDFRawStream)) {
      throw new Error('Expected embedded PDF page stream')
    }
    const content = new TextDecoder().decode(decodePDFRawStream(embedded).decode())
    expect(content).toContain(streamComment)
    expect(content).toContain('(SAMPLE INVOICE) Tj')
  })
})
