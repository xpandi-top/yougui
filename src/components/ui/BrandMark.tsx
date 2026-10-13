import { Box, type SxProps, type Theme } from '@mui/material'

// App 图标定稿（app-icons/）：宣纸底、朱砂菱形框、「归」字矢量轮廓（不依赖设备字体）。
// 32px 及以下用光学调整版（印记更满、笔画加粗），与 favicon 一致。
const GLYPH = 'M429 725Q445 719 445.0 710.5Q445 702 433.0 695.5Q421 689 418.0 673.0Q415 657 415 623Q413 414 403.0 291.0Q393 168 375.0 114.0Q357 60 320.0 11.0Q283 -38 222.0 -79.5Q161 -121 66 -157L56 -142Q182 -76 241.5 -8.0Q301 60 325.0 156.0Q349 252 349 493Q349 607 345 759ZM830 313H559Q516 313 490 302L454 346Q492 341 537 341H830V582H546Q503 582 478 571L441 615Q479 610 524 610H818L858 665L929 607Q940 597 940.0 591.0Q940 585 930 579L900 558V51Q900 18 902 -10L905 -58Q905 -74 875.5 -91.0Q846 -108 838.0 -108.0Q830 -108 830 -93V9H498Q456 9 430 -1L393 43Q431 37 476 37H830ZM244 588 223 569V239Q223 174 224.5 144.5Q226 115 226 113Q226 101 199.0 88.0Q172 75 163.5 75.0Q155 75 155 96Q155 101 156.5 135.5Q158 170 158 242V566Q158 606 155 658L242 615Q254 609 254.0 603.0Q254 597 244 588Z'
const REGULAR = { diamond: 'M512 128L896 512 512 896 128 512Z', frame: 26, glyph: 'translate(329.32751091703057 622.410480349345) scale(0.36681222707423583 -0.36681222707423583)', glyphStroke: 0 }
const SMALL = { diamond: 'M512 80L944 512 512 944 80 512Z', frame: 34, glyph: 'translate(316.27947598253274 630.296943231441) scale(0.3930131004366812 -0.3930131004366812)', glyphStroke: 25.44 }

interface Props {
  size?: number
  /** 带宣纸底色的方形图块（与主屏幕图标一致）；否则透明底，只画印记 */
  tile?: boolean
  /** 印记颜色；不传时跟随主题朱砂色（深色模式更亮），图块模式固定为定稿配色 */
  color?: string
  label?: string
  sx?: SxProps<Theme>
}

export function BrandMark({ size = 40, tile = false, color, label, sx }: Props) {
  const v = size <= 32 ? SMALL : REGULAR
  const ink = tile ? '#934A3A' : (color ?? 'currentColor')
  return (
    <Box
      component="svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      sx={[{ display: 'block', flexShrink: 0, borderRadius: tile ? '22%' : 0, color: 'paper.seal' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {tile && <rect width="1024" height="1024" fill="#F4EFE5" />}
      <path d={v.diamond} fill="none" stroke={ink} strokeWidth={v.frame} strokeLinejoin="miter" />
      <path
        d={GLYPH}
        fill={ink}
        stroke={v.glyphStroke ? ink : undefined}
        strokeWidth={v.glyphStroke || undefined}
        strokeLinejoin="round"
        transform={v.glyph}
      />
    </Box>
  )
}
