import React, { useEffect, useState } from 'react';
import { FormControl, Select, MenuItem, CircularProgress, Typography, Box } from '@mui/material';
import { fetchWithAuth } from '../utils/api';

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

export const CaseSelector: React.FC<CaseSelectorProps> = ({ onCaseSelect, selectedCaseId, onCasesLoaded }) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCases = async () => {
      try {
        setLoading(true);
        // TODO : add this for production - ?package_ready_only=true

        const response = await fetchWithAuth('/cases/options?package_ready_only=true');

        if (!response.ok) {
          throw new Error('Failed to fetch cases');
        }

        const data = await response.json();
        const items = data?.data?.items || data?.data || [];
        setCases(items);
        // Notify parent of how many cases were loaded
        onCasesLoaded?.(items.length);

        // Auto-select if there's only one case
        if (items.length === 1) {
          onCaseSelect(items[0].id);
        }
      } catch (err: any) {
        console.error("Error fetching case options:", err);
        setError("Failed to load cases.");
      } finally {
        setLoading(false);
      }
    };

    fetchCases();
  }, [onCaseSelect]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1 }}>
        <CircularProgress size={20} sx={{ mr: 2 }} />
        <Typography variant="body2" color="text.secondary">Loading cases...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="error">{error}</Typography>
    );
  }

  if (cases.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No completed cases ready for autofill.
      </Typography>
    );
  }

  return (
    <FormControl fullWidth size="small" variant="outlined">
      <Select
        value={selectedCaseId || ''}
        displayEmpty
        onChange={(e) => onCaseSelect(e.target.value as string)}
        sx={{
          bgcolor: '#fff',
          borderRadius: 1,
          '& .MuiSelect-select': { py: 1, px: 1.5 },
        }}
      >
        <MenuItem value="" disabled>
          <em>Select Case</em>
        </MenuItem>
        {cases.map((c) => {
          let displayName = c.caseNumber;

          if (c.primaryApplicantName && c.programPackageName) {
            displayName = `${c.primaryApplicantName} - ${c.programPackageName}`;
          } else if (c.primaryApplicantName) {
            displayName = `${c.primaryApplicantName} (${c.caseNumber})`;
          } else if (c.programPackageName) {
            displayName = `${c.programPackageName} (${c.caseNumber})`;
          }

          return (
            <MenuItem key={c.id} value={c.id}>
              {displayName}
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
};
