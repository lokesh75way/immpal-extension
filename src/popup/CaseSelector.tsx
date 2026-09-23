import React, { useEffect, useState } from 'react';
import {
  FormControl,
  Select,
  MenuItem,
  CircularProgress,
  Typography,
  Box,
  Avatar,
} from '@mui/material';
import {
  FolderOutlined as CaseIcon,
  CheckCircle as ActiveCheckIcon,
} from '@mui/icons-material';
import { fetchWithAuth } from '../utils/api';
import { BRAND_PRIMARY } from '../theme';

export interface CaseOption {
  id: string;
  caseEngineId: string;
  caseNumber: string;
  status: string;
  primaryApplicantName?: string;
  programPackageName?: string;
}

interface CaseSelectorProps {
  onCaseSelect: (caseId: string | null) => void;
  selectedCaseId: string | null;
  onCasesLoaded?: (count: number) => void;
}

export const CaseSelector: React.FC<CaseSelectorProps> = ({
  onCaseSelect,
  selectedCaseId,
  onCasesLoaded,
}) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCases = async () => {
      try {
        setLoading(true);
        const response = await fetchWithAuth('/cases/options?package_ready_only=true&limit=100');

        if (!response.ok) {
          throw new Error('Failed to fetch cases');
        }

        const data = await response.json();
        const items = data?.data?.items || data?.data || [];
        setCases(items);
        onCasesLoaded?.(items.length);

        if (items.length === 1) {
          onCaseSelect(items[0].id);
        }
      } catch (err: any) {
        console.error('Error fetching case options:', err);
        setError('Failed to load cases.');
      } finally {
        setLoading(false);
      }
    };

    fetchCases();
  }, []);


  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', py: 1, px: 0.5, gap: 1.5 }}>
        <CircularProgress size={16} sx={{ color: BRAND_PRIMARY }} />
        <Typography variant="body2" color="text.secondary">
          Loading your applications…
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="error" sx={{ py: 0.5 }}>
        {error}
      </Typography>
    );
  }

  if (cases.length === 0) {
    return (
      <Box sx={{ py: 1, px: 1, bgcolor: '#F8FAFC', borderRadius: 1, border: '1px dashed #CBD5E1' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          No applications ready for autofill. Prepare a package in Immpal first.
        </Typography>
      </Box>
    );
  }

  const selectedCase = cases.find((c) => c.id === selectedCaseId);

  return (
    <FormControl fullWidth size="small" variant="outlined">
      <Select
        value={selectedCaseId || ''}
        displayEmpty
        onChange={(e) => onCaseSelect(e.target.value as string)}
        renderValue={(selected) => {
          if (!selected || !selectedCase) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                <CaseIcon fontSize="small" sx={{ color: '#94A3B8' }} />
                <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                  Select an active case…
                </Typography>
              </Box>
            );
          }

          const initials = (selectedCase.primaryApplicantName || 'AP')
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, overflow: 'hidden' }}>
              <Avatar
                sx={{
                  width: 24,
                  height: 24,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  bgcolor: '#EFF6FF',
                  color: BRAND_PRIMARY,
                  border: '1px solid #BFDBFE',
                }}
              >
                {initials}
              </Avatar>
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, color: '#0F172A', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {selectedCase.primaryApplicantName || selectedCase.caseNumber}
                </Typography>
                {selectedCase.programPackageName && (
                  <Typography
                    variant="caption"
                    sx={{ color: '#64748B', display: 'block', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {selectedCase.programPackageName}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        }}
        sx={{
          backgroundColor: '#FFFFFF',
          borderRadius: 1,
          '& .MuiSelect-select': {
            py: 1.2,
            px: 1.5,
          },
        }}
      >
        <MenuItem value="" disabled>
          <Typography variant="body2" color="text.secondary">
            Select case…
          </Typography>
        </MenuItem>
        {cases.map((c) => {
          const initials = (c.primaryApplicantName || 'AP')
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          const isSelected = c.id === selectedCaseId;

          return (
            <MenuItem
              key={c.id}
              value={c.id}
              sx={{
                py: 1.25,
                px: 1.5,
                borderBottom: '1px solid #F1F5F9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                bgcolor: isSelected ? '#EFF6FF' : 'transparent',
                '&:hover': {
                  bgcolor: isSelected ? '#E0EEFF' : '#F8FAFC',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, overflow: 'hidden' }}>
                <Avatar
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    bgcolor: isSelected ? BRAND_PRIMARY : '#F1F5F9',
                    color: isSelected ? '#FFFFFF' : '#475569',
                  }}
                >
                  {initials}
                </Avatar>
                <Box sx={{ overflow: 'hidden' }}>
                  <Typography variant="body2" sx={{ fontWeight: isSelected ? 700 : 600, color: '#0F172A' }}>
                    {c.primaryApplicantName || c.caseNumber}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                    {c.programPackageName || c.caseNumber}
                  </Typography>
                </Box>
              </Box>
              {isSelected && <ActiveCheckIcon sx={{ fontSize: 18, color: BRAND_PRIMARY, ml: 1 }} />}
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
};
