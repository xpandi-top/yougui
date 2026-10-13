// 二维码生成（按需加载 qrcode）。四模块静区、M 级纠错、黑白高反差。
export async function qrSvg(text: string): Promise<string> {
  const QR = (await import('qrcode')).default
  return QR.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } })
}

export async function qrPngDataUrl(text: string, size = 600): Promise<string> {
  const QR = (await import('qrcode')).default
  return QR.toDataURL(text, { errorCorrectionLevel: 'M', margin: 4, width: size })
}
