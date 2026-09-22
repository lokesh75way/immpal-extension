import { createTheme } from '@mui/material/styles';

// Immpal FE Brand Colors
export const BRAND_PRIMARY = '#2563EB'; // Immpal Electric Blue
export const BRAND_DARK = '#1D4ED8';
export const BRAND_LIGHT = '#3B82F6';
export const BRAND_NAVY = '#1E3A8A';

export const theme = createTheme({
  palette: {
    primary: {
      main: BRAND_PRIMARY,
      light: BRAND_LIGHT,
      dark: BRAND_DARK,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#0F766E', // Emerald / Teal
      light: '#14B8A6',
      dark: '#0D9488',
    },
    background: {
      default: '#F8FAFC', // Slate light matching Immpal FE layout
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0F172A', // Slate 900
      secondary: '#64748B', // Slate 500
    },
    divider: '#E2E8F0',
    success: { 
      main: '#10B981',
      light: '#ECFDF5',
      contrastText: '#FFFFFF',
    },
    warning: { 
      main: '#F59E0B',
      light: '#FFFBEB',
      contrastText: '#FFFFFF',
    },
    error: { 
      main: '#EF4444',
      light: '#FEF2F2',
      contrastText: '#FFFFFF',
    },
    info: { 
      main: BRAND_PRIMARY,
      light: '#EFF6FF',
      contrastText: '#FFFFFF',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: [
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h6: { 
      fontWeight: 700, 
      letterSpacing: -0.3,
      color: '#0F172A',
    },
    subtitle1: {
      fontWeight: 700,
      letterSpacing: -0.2,
    },
    subtitle2: { 
      fontWeight: 600,
      color: '#334155',
    },
    body1: {
      fontSize: '0.925rem',
      lineHeight: 1.5,
      color: '#0F172A',
    },
    body2: { 
      fontSize: '0.85rem',
      lineHeight: 1.45,
      color: '#334155',
    },
    caption: { 
      fontSize: '0.75rem',
      fontWeight: 500,
      color: '#64748B',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          borderRadius: 8,
          boxShadow: 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        contained: {
          color: '#FFFFFF',
          boxShadow: '0 2px 4px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.15)',
          },
          '&:active': {
            transform: 'translateY(0)',
          },
          '&.Mui-disabled': {
            color: '#94A3B8',
            backgroundColor: '#E2E8F0',
            background: '#E2E8F0',
            boxShadow: 'none',
          },
        },
        outlined: {
          borderColor: '#CBD5E1',
          color: '#334155',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            backgroundColor: '#F8FAFC',
            borderColor: '#94A3B8',
            color: BRAND_PRIMARY,
          },
          '&.Mui-disabled': {
            color: '#94A3B8',
            borderColor: '#E2E8F0',
            backgroundColor: '#F8FAFC',
          },
        },
        text: {
          color: '#475569',
          '&:hover': {
            color: BRAND_PRIMARY,
            backgroundColor: 'transparent',
          },
          '&.Mui-disabled': {
            color: '#94A3B8',
          },
        },
      },
      variants: [
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            background: `linear-gradient(135deg, ${BRAND_PRIMARY} 0%, #1D4ED8 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
            '&:hover': {
              background: `linear-gradient(135deg, ${BRAND_LIGHT} 0%, ${BRAND_PRIMARY} 100%)`,
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
            },
            '&.Mui-disabled': {
              color: '#94A3B8',
              background: '#E2E8F0',
              backgroundColor: '#E2E8F0',
              boxShadow: 'none',
            },
          },
        },
        {
          props: { variant: 'contained', color: 'success' },
          style: {
            background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
            color: '#FFFFFF',
            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.25)',
            '&:hover': {
              background: 'linear-gradient(135deg, #34D399 0%, #10B981 100%)',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
            },
            '&.Mui-disabled': {
              color: '#94A3B8',
              background: '#E2E8F0',
              backgroundColor: '#E2E8F0',
              boxShadow: 'none',
            },
          },
        },
        {
          props: { variant: 'contained', color: 'secondary' },
          style: {
            background: 'linear-gradient(135deg, #0F766E 0%, #0D9488 100%)',
            color: '#FFFFFF',
            boxShadow: '0 2px 4px rgba(15, 118, 110, 0.25)',
            '&:hover': {
              background: 'linear-gradient(135deg, #14B8A6 0%, #0F766E 100%)',
              boxShadow: '0 4px 12px rgba(15, 118, 110, 0.35)',
            },
            '&.Mui-disabled': {
              color: '#94A3B8',
              background: '#E2E8F0',
              backgroundColor: '#E2E8F0',
              boxShadow: 'none',
            },
          },
        },
        {
          props: { variant: 'contained', color: 'error' },
          style: {
            background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
            color: '#FFFFFF',
            boxShadow: '0 2px 4px rgba(239, 68, 68, 0.25)',
            '&:hover': {
              background: 'linear-gradient(135deg, #F87171 0%, #EF4444 100%)',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.35)',
            },
            '&.Mui-disabled': {
              color: '#94A3B8',
              background: '#E2E8F0',
              backgroundColor: '#E2E8F0',
              boxShadow: 'none',
            },
          },
        },
        {
          props: { variant: 'outlined', color: 'success' },
          style: {
            borderColor: '#86EFAC',
            color: '#059669',
            backgroundColor: '#F0FDF4',
            '&:hover': {
              backgroundColor: '#DCFCE7',
              borderColor: '#4ADE80',
              color: '#047857',
            },
          },
        },
      ],
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          backgroundColor: '#F1F5F9',
          borderRadius: 8,
          padding: 3,
          gap: 3,
          border: '1px solid #E2E8F0',
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.8125rem',
          border: 'none !important',
          borderRadius: '6px !important',
          color: '#64748B',
          padding: '6px 14px',
          transition: 'all 0.15s ease-in-out',
          '&.Mui-selected': {
            backgroundColor: '#FFFFFF',
            color: BRAND_PRIMARY,
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
            fontWeight: 700,
          },
          '&.Mui-selected:hover': {
            backgroundColor: '#FFFFFF',
          },
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
            color: '#334155',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { 
          fontWeight: 600,
          fontSize: '0.75rem',
          borderRadius: 6,
          height: 24,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          borderRadius: 8,
          borderColor: '#E2E8F0',
          transition: 'all 0.15s ease',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CBD5E1',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: BRAND_PRIMARY,
            borderWidth: 2,
            boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)',
          },
        },
        input: {
          padding: '10px 14px',
          fontSize: '0.875rem',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: '#E2E8F0',
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.02)',
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          fontWeight: 600,
          fontSize: '0.875rem',
        },
      },
    },
  },
});
