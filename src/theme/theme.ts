// 新中式主题：宣纸、墨绿、朱砂。颜色集中在这里，组件只用 theme token。
import { createTheme } from '@mui/material/styles'

export const SERIF = "'Songti SC','STSong','Noto Serif CJK SC','Noto Serif SC','Source Han Serif SC',serif"
export const SANS = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif"

declare module '@mui/material/styles' {
  interface Palette {
    paper: { line: string; muted: string; soft: string; warn: string; seal: string }
  }
  interface PaletteOptions {
    paper?: { line: string; muted: string; soft: string; warn: string; seal: string }
  }
}

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#35463D', contrastText: '#F4EFE5' },
        secondary: { main: '#934A3A', contrastText: '#FBF7EF' },
        background: { default: '#F4EFE5', paper: '#FBF8F1' },
        text: { primary: '#2B3A32', secondary: '#7D735F' },
        divider: '#DCD4C4',
        error: { main: '#A23B2A' },
        warning: { main: '#B26A2B' },
        success: { main: '#3F6B4F' },
        paper: { line: '#DCD4C4', muted: '#8B806B', soft: '#E9EEE7', warn: '#F9E9D8', seal: '#934A3A' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#A9C3B0', contrastText: '#18201B' },
        secondary: { main: '#D88A75', contrastText: '#1C1512' },
        background: { default: '#171C19', paper: '#1F2622' },
        text: { primary: '#E9E3D6', secondary: '#A79F8C' },
        divider: '#38423C',
        error: { main: '#E48471' },
        warning: { main: '#D9A066' },
        success: { main: '#8DBB97' },
        paper: { line: '#38423C', muted: '#A79F8C', soft: '#26302A', warn: '#3A2E22', seal: '#B85A45' },
      },
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: SANS,
    fontSize: 15,
    h1: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.9rem', letterSpacing: '0.08em' },
    h2: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.5rem', letterSpacing: '0.06em' },
    h3: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.2rem', letterSpacing: '0.05em' },
    h4: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.1rem', letterSpacing: '0.04em' },
    subtitle1: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.04em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 44, borderRadius: 4 } },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: ({ theme }) => ({ backgroundImage: 'none', border: `1px solid ${theme.vars.palette.divider}` }) },
    },
    MuiDialog: {
      styleOverrides: { paper: { margin: 16, width: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)' } },
    },
    MuiTextField: { defaultProps: { fullWidth: true } },
    MuiListItemButton: { styleOverrides: { root: { minHeight: 52 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 4 } } },
    MuiBottomNavigationAction: { styleOverrides: { root: { minWidth: 56 } } },
  },
})
