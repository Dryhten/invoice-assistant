import { PDFDocument, PageSizes } from 'pdf-lib'

const A4 = PageSizes.A4
const MARGIN = 28
const GAP = 18

function getSlotPage(output: PDFDocument, slotIndex: number) {
  const pageIndex = Math.floor(slotIndex / 2)
  const slot = slotIndex % 2
  const targetPage = pageIndex < output.getPageCount() ? output.getPage(pageIndex) : output.addPage(A4)
  return { targetPage, slot }
}

async function addPdfFile(output: PDFDocument, file: File, startSlot: number): Promise<number> {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  let slotIndex = startSlot
  for (const sourcePage of source.getPages()) {
    const embeddedPage = await output.embedPage(sourcePage)
    const { targetPage, slot } = getSlotPage(output, slotIndex)
    const slotHeight = (A4[1] - MARGIN * 2 - GAP) / 2
    const maxWidth = A4[0] - MARGIN * 2
    const scale = Math.min(maxWidth / embeddedPage.width, slotHeight / embeddedPage.height)
    const width = embeddedPage.width * scale
    const height = embeddedPage.height * scale
    const x = (A4[0] - width) / 2
    const topY = A4[1] - MARGIN - slotHeight
    const bottomY = MARGIN
    const y = slot === 0 ? topY + (slotHeight - height) / 2 : bottomY + (slotHeight - height) / 2

    targetPage.drawPage(embeddedPage, { x, y, width, height })
    slotIndex += 1
  }
  return slotIndex
}

async function addImageFile(output: PDFDocument, file: File, startSlot: number): Promise<number> {
  const bytes = await readPdfCompatibleImage(file)
  const image = bytes.kind === 'png' ? await output.embedPng(bytes.data) : await output.embedJpg(bytes.data)
  const { targetPage, slot } = getSlotPage(output, startSlot)
  const slotHeight = (A4[1] - MARGIN * 2 - GAP) / 2
  const maxWidth = A4[0] - MARGIN * 2
  const scale = Math.min(maxWidth / image.width, slotHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const x = (A4[0] - width) / 2
  const topY = A4[1] - MARGIN - slotHeight
  const bottomY = MARGIN
  const y = slot === 0 ? topY + (slotHeight - height) / 2 : bottomY + (slotHeight - height) / 2
  targetPage.drawImage(image, { x, y, width, height })
  return startSlot + 1
}

async function readPdfCompatibleImage(file: File): Promise<{ kind: 'png' | 'jpg'; data: Uint8Array }> {
  if (file.type === 'image/png') {
    return { kind: 'png', data: new Uint8Array(await file.arrayBuffer()) }
  }
  if (file.type === 'image/jpeg' || /\.(jpg|jpeg)$/iu.test(file.name)) {
    return { kind: 'jpg', data: new Uint8Array(await file.arrayBuffer()) }
  }

  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建图片转换画布')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value)
      } else {
        reject(new Error('图片转换失败'))
      }
    }, 'image/jpeg', 0.92)
  })
  return { kind: 'jpg', data: new Uint8Array(await blob.arrayBuffer()) }
}

export async function buildMergedInvoicePdf(files: File[]): Promise<Blob | null> {
  if (files.length === 0) {
    return null
  }

  const output = await PDFDocument.create()
  let slotIndex = 0
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      slotIndex = await addPdfFile(output, file, slotIndex)
    } else if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp|bmp)$/iu.test(file.name)) {
      slotIndex = await addImageFile(output, file, slotIndex)
    }
  }

  if (slotIndex === 0) {
    return null
  }

  const bytes = await output.save()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}
