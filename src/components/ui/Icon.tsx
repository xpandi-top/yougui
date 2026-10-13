import { Box, type SxProps, type Theme } from '@mui/material'
import { iconById, uiIcon } from '../../catalog.ts'

interface Props {
  /** ui 图标 key（如 "search"）或完整 id（如 "items-battery"） */
  name: string
  size?: number
  strokeWidth?: number
  label?: string
  sx?: SxProps<Theme>
}

/** 统一 24px 线性图标；内容来自随版本打包的 manifest（非用户输入）。 */
export function Icon({ name, size = 22, strokeWidth = 1.6, label, sx }: Props) {
  const def = name.includes('-') ? iconById(name) : uiIcon(name)
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      sx={[{ flexShrink: 0, display: 'block' }, ...(Array.isArray(sx) ? sx : [sx])]}
      dangerouslySetInnerHTML={{ __html: def?.body ?? '' }}
    />
  )
}
