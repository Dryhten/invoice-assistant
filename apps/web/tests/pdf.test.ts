import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib'
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
})
