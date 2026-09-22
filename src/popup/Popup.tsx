import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Paper,
  Chip,
  Divider,
  Fade,
} from "@mui/material";
import {
  Logout as LogoutIcon,
  Clear as ClearIcon,
  ContentCopyOutlined as CopyIcon,
  Check as CheckIcon,
  CenterFocusStrongOutlined as FocusModeIcon,
  Bolt as AutofillModeIcon,
  CheckCircle as AnswerIcon,
  AutoAwesome as NarrativeIcon,
  HelpOutlined as ClarificationIcon,
  InfoOutlined as MissingIcon,
  InsertDriveFileOutlined as DocumentIcon,
  FormatListBulleted as MultipleIcon,
  ErrorOutlined as ErrorIcon,
  EditOutlined as ManualAnswerIcon,
  Refresh as RefreshIcon,
  VerifiedUserOutlined as ShieldIcon,
  ArrowForward as ArrowIcon,
  LockOutlined as LockIcon,
} from "@mui/icons-material";
import { CaseSelector } from "./CaseSelector";
import { BRAND_PRIMARY } from "../theme";
import immpalLogo from "../assets/immpal-logo.png";

type AssistMode = "focus" | "autofill";

interface ResolvedQuestionPayload {
  question: {
    title: string;
    headings: string[];
    mainText: string[];
    url: string;
    fields: any[];
  };
  resolution: {
    status: string;
    answer?: string;
    message?: string;
    sourceReference?: string;
    documentId?: string;
    documentName?: string;
    downloadUrl?: string;
    multipleAnswers?: string[];
  };
}

const STATUS_META: Record<
  string,
  {
    label: string;
    bg: string;
    fg: string;
    border: string;
    icon: React.ReactElement;
  }
> = {
  ANSWER_AVAILABLE: {
    label: "Verified Answer Found",
    bg: "#ECFDF5",
    fg: "#059669",
    border: "#A7F3D0",
    icon: <AnswerIcon sx={{ fontSize: 16, color: "#059669" }} />,
  },
  SUGGESTED_NARRATIVE: {
    label: "Suggested Narrative",
    bg: "#EFF6FF",
    fg: "#2563EB",
    border: "#BFDBFE",
    icon: <NarrativeIcon sx={{ fontSize: 16, color: "#2563EB" }} />,
  },
  CLARIFICATION_REQUIRED: {
    label: "Clarification Needed",
    bg: "#FFFBEB",
    fg: "#D97706",
    border: "#FDE68A",
    icon: <ClarificationIcon sx={{ fontSize: 16, color: "#D97706" }} />,
  },
  INFORMATION_MISSING: {
    label: "Information Missing",
    bg: "#F8FAFC",
    fg: "#64748B",
    border: "#E2E8F0",
    icon: <MissingIcon sx={{ fontSize: 16, color: "#64748B" }} />,
  },
  DOCUMENT_REQUIRED: {
    label: "Document Required",
    bg: "#F0FDFA",
    fg: "#0D9488",
    border: "#99F6E4",
    icon: <DocumentIcon sx={{ fontSize: 16, color: "#0D9488" }} />,
  },
  MULTIPLE_POSSIBLE_FACTS: {
    label: "Multiple Matches",
    bg: "#F5F3FF",
    fg: "#7C3AED",
    border: "#DDD6FE",
    icon: <MultipleIcon sx={{ fontSize: 16, color: "#7C3AED" }} />,
  },
  ERROR: {
    label: "Resolution Notice",
    bg: "#FEF2F2",
    fg: "#DC2626",
    border: "#FECACA",
    icon: <ErrorIcon sx={{ fontSize: 16, color: "#DC2626" }} />,
  },
};

export interface AutofillSummaryItem {
  key: string;
  label: string;
  value?: string;
  reason?: string;
}

export interface AutofillSummaryReport {
  filledCount: number;
  skippedCount: number;
  totalCount: number;
  filledItems: AutofillSummaryItem[];
  skippedItems: AutofillSummaryItem[];
}

export const cleanFieldLabel = (raw?: string | null): string => {
  if (!raw) return "";
  return raw
    .replace(/^[\s*•\-–—:]+/, "")
    .replace(/\s*\((required|optional|obligatoire|facultatif)\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const Popup = () => {
  const [token, setToken] = useState<string | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [assistMode, setAssistMode] = useState<AssistMode>("autofill"); // Default to Autofill for portal workflows
  // Whether the user has explicitly turned Copilot on for the current page in
  // this tab. Nothing scans or resolves fields until this is true, and it
  // resets to false on every navigation (see background.ts's resetPageState).
  const [pageActive, setPageActive] = useState(false);

  // Autofill mode state
  const [autofillStatus, setAutofillStatus] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [autofillResult, setAutofillResult] =
    useState<AutofillSummaryReport | null>(null);
  const [showFilledList, setShowFilledList] = useState(false);

  const [resolutionData, setResolutionData] =
    useState<ResolvedQuestionPayload | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [insertSuccess, setInsertSuccess] = useState(false);

  // Manual Override State
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAnswer, setManualAnswer] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [consistencyResult, setConsistencyResult] = useState<{
    status: string;
    rationale?: string;
    sourceReference?: string;
  } | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Session completion confirmation
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);

  const currentTabIdRef = useRef<number | null>(null);
  const previousCaseIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentTabIdRef.current = currentTabId;
  }, [currentTabId]);

  useEffect(() => {
    const checkToken = () => {
      chrome.storage.local.get(["immpalAuthToken"], (result) => {
        setToken(
          typeof result.immpalAuthToken === "string"
            ? result.immpalAuthToken
            : null,
        );
      });
    };

    checkToken();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      setCurrentTabId(tabId);

      // Verify and re-inject content script if missing or disconnected
      chrome.runtime.sendMessage({ type: "ENSURE_CONTENT_SCRIPT", tabId });

      chrome.runtime.sendMessage(
        { type: "GET_ACTIVE_CASE", tabId },
        (response) => {
          if (response?.caseId) {
            previousCaseIdRef.current = response.caseId;
            setSelectedCaseId(response.caseId);
          }
        },
      );

      chrome.runtime.sendMessage(
        { type: "GET_LAST_RESOLUTION", tabId },
        (response) => {
          if (response && response.data) setResolutionData(response.data);
        },
      );

      chrome.runtime.sendMessage(
        { type: "GET_SESSION_STATE", tabId },
        (response) => {
          setShowCompletionPrompt(
            response?.sessionState === "COMPLETION_CONFIRMATION",
          );
        },
      );

      chrome.runtime.sendMessage(
        { type: "GET_PAGE_ACTIVE", tabId },
        (response) => {
          setPageActive(Boolean(response?.active));
        },
      );

      chrome.storage.local.get([`autofillResult_${tabId}`], (res) => {
        if (res && res[`autofillResult_${tabId}`]) {
          setAutofillResult(
            res[`autofillResult_${tabId}`] as AutofillSummaryReport,
          );
        }
      });
    });

    const listener = (request: any) => {
      if (
        request.type === "AUTH_STATE_CHANGED" ||
        request.type === "TOKEN_UPDATED"
      ) {
        checkToken();
      } else if (
        (request.type === "QUESTION_RESOLVED" ||
          request.type === "QUESTION_DETECTED") &&
        request.payload
      ) {
        const curTab = currentTabIdRef.current;
        if (!curTab || request.tabId === curTab) {
          if (!curTab && request.tabId) {
            setCurrentTabId(request.tabId);
            currentTabIdRef.current = request.tabId;
          }
          setResolutionData(request.payload);
          setCopySuccess(null);
          setShowManualInput(false);
          setManualAnswer("");
          setConsistencyResult(null);
          setIsSaved(false);
          setShowCompletionPrompt(false);
        }
      } else if (
        request.type === "PAGE_NAVIGATED" &&
        (!currentTabIdRef.current || request.tabId === currentTabIdRef.current)
      ) {
        setAutofillResult(null);
        setResolutionData(null);
        setPageActive(false);
      } else if (
        request.type === "SESSION_COMPLETION_PROMPT" &&
        (!currentTabIdRef.current || request.tabId === currentTabIdRef.current)
      ) {
        setShowCompletionPrompt(true);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    const storageListener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName === "local") {
        if (changes.immpalAuthToken) {
          const val = changes.immpalAuthToken.newValue;
          setToken(typeof val === "string" ? val : null);
        }
        const curTab = currentTabIdRef.current;
        if (curTab && changes[`lastResolution_${curTab}`]) {
          const newRes = changes[`lastResolution_${curTab}`].newValue;
          if (newRes) {
            setResolutionData(newRes as ResolvedQuestionPayload);
          }
        }
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    const tabActivatedListener = (activeInfo: { tabId: number; windowId: number }) => {
      const newTabId = activeInfo.tabId;
      setCurrentTabId(newTabId);
      currentTabIdRef.current = newTabId;

      chrome.runtime.sendMessage({ type: "ENSURE_CONTENT_SCRIPT", tabId: newTabId });

      chrome.runtime.sendMessage(
        { type: "GET_ACTIVE_CASE", tabId: newTabId },
        (response) => {
          if (response?.caseId) {
            previousCaseIdRef.current = response.caseId;
            setSelectedCaseId(response.caseId);
          }
        },
      );

      chrome.runtime.sendMessage(
        { type: "GET_LAST_RESOLUTION", tabId: newTabId },
        (response) => {
          if (response && response.data) {
            setResolutionData(response.data);
          } else {
            setResolutionData(null);
          }
        },
      );

      chrome.runtime.sendMessage(
        { type: "GET_PAGE_ACTIVE", tabId: newTabId },
        (response) => {
          setPageActive(Boolean(response?.active));
        },
      );
    };
    chrome.tabs.onActivated.addListener(tabActivatedListener);

    chrome.storage.local.get(["assistMode"], (res) => {
      if (res.assistMode) {
        setAssistMode(res.assistMode === "focus" ? "focus" : "autofill");
      }
    });

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.tabs.onActivated.removeListener(tabActivatedListener);
    };
  }, []);

  useEffect(() => {
    if (!currentTabId || !selectedCaseId) return;

    // First time selectedCaseId is loaded on popup mount:
    if (previousCaseIdRef.current === null) {
      previousCaseIdRef.current = selectedCaseId;
      chrome.runtime.sendMessage({
        type: "SET_ACTIVE_CASE",
        caseId: selectedCaseId,
        tabId: currentTabId,
      });
      return;
    }

    // Same case ID already active on this tab:
    if (previousCaseIdRef.current === selectedCaseId) {
      return;
    }

    // User explicitly changed to a different case in the UI:
    previousCaseIdRef.current = selectedCaseId;
    setResolutionData(null);
    setAutofillResult(null);
    setCopySuccess(null);
    setShowManualInput(false);
    setManualAnswer("");
    setConsistencyResult(null);
    setIsSaved(false);
    setShowCompletionPrompt(false);
    chrome.storage.local.remove([
      `lastResolution_${currentTabId}`,
      `sessionState_${currentTabId}`,
      `autofillResult_${currentTabId}`,
    ]);
    chrome.runtime.sendMessage({
      type: "SET_ACTIVE_CASE",
      caseId: selectedCaseId,
      tabId: currentTabId,
    });
  }, [selectedCaseId, currentTabId]);

  const handleActivatePage = () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage(
      { type: "SET_PAGE_ACTIVE", tabId: currentTabId, active: true },
      () => setPageActive(true),
    );
  };

  const handleDeactivatePage = () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage(
      { type: "SET_PAGE_ACTIVE", tabId: currentTabId, active: false },
      () => setPageActive(false),
    );
  };

  const handleAssistModeChange = (
    _: React.MouseEvent<HTMLElement>,
    newMode: AssistMode | null,
  ) => {
    if (!newMode || newMode === assistMode) return;
    setAssistMode(newMode);
    setAutofillStatus(null);
    chrome.storage.local.set({ assistMode: newMode });
  };

  const handleAccept = async (answer: string, fieldKey?: string) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const targetKey =
      fieldKey || resolutionData?.question?.fields?.[0]?.fieldKey;
    if (tab && tab.id && targetKey) {
      setInsertSuccess(true);
      setTimeout(() => setInsertSuccess(false), 2000);
      chrome.tabs.sendMessage(
        tab.id,
        { type: "WRITE_FIELD_VALUE", fieldKey: targetKey, value: answer },
        () => {
          handleCopy(answer);
        },
      );
    } else {
      handleCopy(answer);
    }
  };

  const handleAdvanceNextField = async () => {
    let tabId = currentTabId;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = tab?.id ?? null;
    }
    if (!tabId) return;

    const targetKey =
      resolutionData?.question?.fields?.[0]?.fieldKey ||
      (resolutionData as any)?.fieldKey;

    chrome.tabs.sendMessage(
      tabId,
      { type: "ADVANCE_NEXT_FIELD", fieldKey: targetKey },
      () => {
        if (chrome.runtime.lastError) {
          console.warn("Could not advance to next field:", chrome.runtime.lastError.message);
        }
      }
    );
  };

  const handleStartAutofill = async (onlyEmpty = false) => {
    if (!selectedCaseId) return;

    setAutofillStatus({
      type: "info",
      message: onlyEmpty
        ? "Filling remaining fields…"
        : "Scanning portal and filling fields…",
    });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab && tab.id) {
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "AUTOFILL_FORM",
          payload: { caseId: selectedCaseId, options: { onlyEmpty } },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Could not send message to active tab.",
              chrome.runtime.lastError,
            );
            setAutofillStatus({
              type: "error",
              message:
                "Could not connect to webpage. Please refresh the page (Cmd+R or F5) and try again.",
            });
            setTimeout(() => setAutofillStatus(null), 4000);
          } else if (response && response.status === "error") {
            setAutofillStatus({
              type: "error",
              message: response.message || "Failed to autofill",
            });
            setTimeout(() => setAutofillStatus(null), 4000);
          } else {
            setAutofillStatus({
              type: "success",
              message: response?.message || "Form autofill complete!",
            });
            if (response?.summary) {
              setAutofillResult(response.summary);
              chrome.storage.local.set({
                [`autofillResult_${tab.id}`]: response.summary,
              });
            }
            setTimeout(() => setAutofillStatus(null), 4000);
          }
        },
      );
    } else {
      setAutofillStatus({ type: "error", message: "No active tab found." });
      setTimeout(() => setAutofillStatus(null), 4000);
    }
  };

  const handleJumpToField = async (fieldKey: string, switchToFocus = false) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.id) {
      if (switchToFocus) {
        setAssistMode("focus");
        chrome.storage.local.set({ assistMode: "focus" });
      }
      chrome.tabs.sendMessage(tab.id, { type: "FOCUS_FIELD", fieldKey });
    }
  };

  const handleReloadActiveTab = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.id) {
      chrome.tabs.reload(tab.id, {}, () => {
        setAutofillStatus({
          type: "info",
          message: "Page refreshed! Click Start Auto-fill when loaded.",
        });
        setTimeout(() => setAutofillStatus(null), 3000);
      });
    }
  };

  const handleClearQuestion = () => {
    setResolutionData(null);
    chrome.storage.local.remove([`lastResolution_${currentTabId}`]);
  };

  const handleSignOut = () => {
    chrome.storage.local.remove(
      ["immpalAuthToken", "immpalRefreshToken"],
      () => {
        setToken(null);
      },
    );
  };

  const handleCopy = async (textToCopy?: string) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(textToCopy);
      setTimeout(() => setCopySuccess(null), 2500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleCheckConsistency = () => {
    if (!manualAnswer || !resolutionData?.question?.fields?.length) return;
    setIsChecking(true);
    setConsistencyResult(null);

    const fieldKey =
      resolutionData.question.fields[0].fieldKey ||
      resolutionData.question.fields[0].name;
    const fieldLabel =
      cleanFieldLabel(resolutionData.question.fields[0].label) ||
      resolutionData.question.headings?.find(
        (h: string) => h && !h.toLowerCase().includes("application"),
      ) ||
      resolutionData.question.headings?.[0] ||
      resolutionData.question.title;

    chrome.runtime.sendMessage(
      {
        type: "CHECK_CONSISTENCY",
        tabId: currentTabId,
        payload: {
          field_key: fieldKey,
          user_answer: manualAnswer,
          label: fieldLabel || undefined,
        },
      },
      (response) => {
        setIsChecking(false);
        if (response?.success && response.data) {
          setConsistencyResult(response.data);
        } else {
          setConsistencyResult({
            status: "ERROR",
            rationale: response?.error || "Unknown error",
          });
        }
      },
    );
  };

  const handleSaveOverride = () => {
    if (
      !manualAnswer ||
      !consistencyResult ||
      !resolutionData?.question?.fields?.length
    )
      return;

    const fieldKey =
      resolutionData.question.fields[0].fieldKey ||
      resolutionData.question.fields[0].name;
    const fieldLabel =
      cleanFieldLabel(resolutionData.question.fields[0].label) ||
      resolutionData.question.headings?.find(
        (h: string) => h && !h.toLowerCase().includes("application"),
      ) ||
      resolutionData.question.headings?.[0] ||
      resolutionData.question.title;

    chrome.runtime.sendMessage(
      {
        type: "SAVE_OVERRIDE",
        tabId: currentTabId,
        payload: {
          field_key: fieldKey,
          user_answer: manualAnswer,
          status: consistencyResult.status,
          rationale: consistencyResult.rationale,
          label: fieldLabel || undefined,
        },
      },
      (response) => {
        if (response?.success) {
          setIsSaved(true);
          // Saving the override to the case dossier doesn't itself change
          // anything on the page -- write the confirmed answer into the
          // actual form field too, so the user doesn't have to type it twice.
          handleAccept(manualAnswer, fieldKey);
        }
      },
    );
  };

  const handleCompletionResponse = (finished: boolean) => {
    chrome.runtime.sendMessage(
      {
        type: "SESSION_COMPLETION_RESPONSE",
        tabId: currentTabId,
        payload: { finished },
      },
      () => {
        setShowCompletionPrompt(false);
      },
    );
  };

  // The manual-answer widget must match the portal field it's overriding --
  // a Yes/No radio question should offer Yes/No buttons, not a freeform text
  // box the user could type "yess" into. A file/document field has no
  // sensible "type an answer" flow at all.
  const activeField = resolutionData?.question?.fields?.[0];
  const activeFieldType = (activeField?.type || "").toLowerCase();
  const activeFieldOptions: string[] = Array.isArray(activeField?.options)
    ? activeField.options
    : [];
  const isFileField = activeFieldType === "file";
  const isChoiceField =
    (activeFieldType === "radio" || activeFieldType === "select") &&
    activeFieldOptions.length > 0;
  const isCheckboxField = activeFieldType === "checkbox";
  const isNarrativeField = activeFieldType === "textarea";

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      {/* Immpal Top Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          bgcolor: "#FFFFFF",
          borderBottom: "1px solid #E2E8F0",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Box
            component="img"
            src={immpalLogo}
            alt="immPAL"
            sx={{
              height: 25,
              width: "auto",
              display: "block",
            }}
          />
        </Box>

        {token ? (
          <Tooltip
            title={
              !selectedCaseId
                ? "Select an application first."
                : pageActive
                  ? "Active on this page. Click to turn off."
                  : "Not active on this page. Click to activate."
            }
            arrow
          >
            <Box
              onClick={
                !selectedCaseId
                  ? undefined
                  : pageActive
                    ? handleDeactivatePage
                    : handleActivatePage
              }
              role="button"
              tabIndex={0}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.25,
                py: 0.45,
                borderRadius: "6px",
                bgcolor: pageActive ? "#ECFDF5" : "#F8FAFC",
                border: "1px solid",
                borderColor: pageActive ? "#A7F3D0" : "#E2E8F0",
                cursor: selectedCaseId ? "pointer" : "default",
                opacity: selectedCaseId ? 1 : 0.6,
                userSelect: "none",
                transition: "all 0.15s ease",
                "&:hover": selectedCaseId
                  ? {
                      bgcolor: pageActive ? "#D1FAE5" : "#F1F5F9",
                      borderColor: pageActive ? "#6EE7B7" : "#CBD5E1",
                      transform: "translateY(-1px)",
                    }
                  : {},
                "&:active": {
                  transform: "translateY(0)",
                },
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  bgcolor: pageActive ? "#10B981" : "#94A3B8",
                  boxShadow: pageActive
                    ? "0 0 6px rgba(16, 185, 129, 0.45)"
                    : "none",
                }}
              />
              <Typography
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: pageActive ? "#065F46" : "#475569",
                  letterSpacing: 0.2,
                  lineHeight: 1,
                }}
              >
                {pageActive ? "Active" : "Not active"}
              </Typography>
            </Box>
          </Tooltip>
        ) : (
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.6,
              px: 1.1,
              py: 0.35,
              borderRadius: "6px",
              bgcolor: "#F8FAFC",
              border: "1px solid #E2E8F0",
            }}
          >
            <ShieldIcon sx={{ fontSize: 13, color: "#64748B" }} />
            <Typography
              sx={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "#64748B",
                letterSpacing: 0.2,
              }}
            >
              Ready to Connect
            </Typography>
          </Box>
        )}
      </Box>

      {token ? (
        <>
          <Box
            sx={{
              p: 2,
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: 1.75,
              overflowY: "auto",
            }}
          >
            {/* Assist Mode Switcher */}
            <ToggleButtonGroup
              value={assistMode}
              exclusive
              onChange={handleAssistModeChange}
              fullWidth
              size="small"
            >
              <ToggleButton value="autofill">
                <AutofillModeIcon sx={{ fontSize: 18, mr: 1 }} />
                Auto-fill Mode
              </ToggleButton>
              <ToggleButton value="focus">
                <FocusModeIcon sx={{ fontSize: 18, mr: 1 }} />
                Focus Assist
              </ToggleButton>
            </ToggleButtonGroup>

            {/* Active Case Selector Card */}
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: "#FFFFFF",
                borderColor: "#E2E8F0",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    letterSpacing: 0.5,
                    color: "#64748B",
                    fontSize: "0.6875rem",
                    textTransform: "uppercase",
                  }}
                >
                  ACTIVE APPLICATION
                </Typography>
              </Box>

              <CaseSelector
                onCaseSelect={(id) => setSelectedCaseId(id)}
                selectedCaseId={selectedCaseId}
              />
            </Paper>

            {/* PER-PAGE ACTIVATION GATE: Copilot never scans or resolves
                fields on a page until the user explicitly turns it on here --
                it does not run automatically just because a case is selected. */}
            {selectedCaseId && !pageActive ? (
              <Paper
                variant="outlined"
                sx={{
                  flex: 1,
                  p: 3,
                  borderRadius: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  bgcolor: "#FFFFFF",
                  borderColor: "#E2E8F0",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                }}
              >
                <Box
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: 1,
                    bgcolor: "#EFF6FF",
                    color: BRAND_PRIMARY,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 1.5,
                  }}
                >
                  <ShieldIcon sx={{ fontSize: 28 }} />
                </Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Not Active on This Page
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2, maxWidth: 280 }}
                >
                  Immpal only reads or fills this page's fields once you turn
                  it on here. It never runs automatically in the background.
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleActivatePage}
                  startIcon={<AutofillModeIcon sx={{ color: "#FFFFFF" }} />}
                  sx={{ fontWeight: 700, color: "#FFFFFF !important" }}
                >
                  Activate on This Page
                </Button>
              </Paper>
            ) : (
              <>
                {selectedCaseId && pageActive && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      px: 1.25,
                      py: 0.75,
                      borderRadius: 1,
                      bgcolor: "#ECFDF5",
                      border: "1px solid #A7F3D0",
                    }}
                  >
                    <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "#065F46" }}>
                      Active on this page
                    </Typography>
                    <Button
                      size="small"
                      onClick={handleDeactivatePage}
                      sx={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#065F46",
                        textTransform: "none",
                        minWidth: 0,
                        p: 0,
                        "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
                      }}
                    >
                      Turn off
                    </Button>
                  </Box>
                )}

            {/* AUTOFILL MODE VIEW */}
            {assistMode === "autofill" && (
              <Paper
                variant="outlined"
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 1,
                  display: "flex",
                  flexDirection: "column",
                  bgcolor: "#FFFFFF",
                  borderColor: "#E2E8F0",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                }}
              >
                {!selectedCaseId ? (
                  <Box
                    sx={{
                      textAlign: "center",
                      m: "auto",
                      py: 4,
                      color: "text.secondary",
                    }}
                  >
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 1,
                        bgcolor: "#EFF6FF",
                        color: BRAND_PRIMARY,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mx: "auto",
                        mb: 1.5,
                      }}
                    >
                      <AutofillModeIcon sx={{ fontSize: 28 }} />
                    </Box>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, mb: 0.5 }}
                    >
                      Select an Application to Autofill
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Choose your application above to connect your verified
                      profile data.
                    </Typography>
                  </Box>
                ) : (
                  <>
                    {/* Feature Overview OR Persistent Summary Results */}
                    {!autofillResult ? (
                      <Box
                        sx={{
                          bgcolor: "#F8FAFC",
                          p: 1.75,
                          borderRadius: 1,
                          border: "1px solid #E2E8F0",
                          mb: 2,
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.25,
                            mb: 1,
                          }}
                        >
                          <Box
                            sx={{
                              width: 32,
                              height: 32,
                              borderRadius: "6px",
                              bgcolor: "#EFF6FF",
                              color: BRAND_PRIMARY,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <AutofillModeIcon sx={{ fontSize: 20 }} />
                          </Box>
                          <Box>
                            <Typography
                              variant="subtitle2"
                              sx={{ fontWeight: 700, color: "#0F172A" }}
                            >
                              1-Click Form Autofill
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ color: "#64748B" }}
                            >
                              Cascading resolution of radios, dates & text
                            </Typography>
                          </Box>
                        </Box>

                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.75,
                            mt: 1.5,
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <ShieldIcon
                              sx={{ fontSize: 16, color: "#059669" }}
                            />
                            <Typography
                              variant="caption"
                              sx={{ color: "#334155", fontWeight: 600 }}
                            >
                              100% Governed Application Data
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <CheckIcon
                              sx={{ fontSize: 16, color: BRAND_PRIMARY }}
                            />
                            <Typography
                              variant="caption"
                              sx={{ color: "#334155", fontWeight: 600 }}
                            >
                              Auto-unhides dynamic child questions
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    ) : (
                      <Paper
                        elevation={0}
                        sx={{
                          p: 1.75,
                          borderRadius: 1,
                          border: "1px solid #E2E8F0",
                          bgcolor: "#FFFFFF",
                          mb: 2,
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            mb: 1.25,
                          }}
                        >
                          <Typography
                            variant="subtitle2"
                            sx={{ fontWeight: 700, color: "#0F172A" }}
                          >
                            Page Autofill Results
                          </Typography>
                          <Box sx={{ display: "flex", gap: 0.75 }}>
                            <Chip
                              label={`${autofillResult.filledCount} Filled`}
                              size="small"
                              sx={{
                                bgcolor: "#ECFDF5",
                                color: "#065F46",
                                fontWeight: 700,
                                border: "1px solid #A7F3D0",
                                fontSize: "0.725rem",
                                height: 22,
                              }}
                            />
                            {autofillResult.skippedCount > 0 && (
                              <Chip
                                label={`${autofillResult.skippedCount} Need Review`}
                                size="small"
                                sx={{
                                  bgcolor: "#FFFBEB",
                                  color: "#92400E",
                                  fontWeight: 700,
                                  border: "1px solid #FDE68A",
                                  fontSize: "0.725rem",
                                  height: 22,
                                }}
                              />
                            )}
                          </Box>
                        </Box>

                        {/* Skipped / Attention Items */}
                        {autofillResult.skippedCount > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: 800,
                                color: "#64748B",
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                                display: "block",
                                fontSize: "0.6875rem",
                                mb: 0.75,
                              }}
                            >
                              Questions Requiring Your Attention
                            </Typography>
                            <Box
                              sx={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 0.75,
                                maxHeight: 160,
                                overflowY: "auto",
                                pr: 0.5,
                              }}
                            >
                              {autofillResult.skippedItems.map((item) => (
                                <Box
                                  key={item.key}
                                  onClick={() => handleJumpToField(item.key, true)}
                                  sx={{
                                    p: 1,
                                    borderRadius: 1,
                                    bgcolor: "#FFFDF5",
                                    border: "1px solid #FEF3C7",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                    "&:hover": {
                                      bgcolor: "#FEF9C3",
                                      borderColor: "#FDE047",
                                    },
                                  }}
                                >
                                  <Box
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 1,
                                    }}
                                  >
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontWeight: 600,
                                        color: "#1E293B",
                                        fontSize: "0.8rem",
                                        lineHeight: 1.2,
                                      }}
                                    >
                                      {cleanFieldLabel(item.label)}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        color: BRAND_PRIMARY,
                                        fontWeight: 700,
                                        fontSize: "0.7rem",
                                        flexShrink: 0,
                                      }}
                                    >
                                      Jump ↗
                                    </Typography>
                                  </Box>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: "#92400E",
                                      display: "block",
                                      mt: 0.25,
                                      fontSize: "0.7rem",
                                    }}
                                  >
                                    {item.reason}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        )}

                        {/* Filled Items Collapsible */}
                        {autofillResult.filledCount > 0 && (
                          <Box sx={{ mt: 0.75 }}>
                            <Button
                              size="small"
                              onClick={() => setShowFilledList(!showFilledList)}
                              sx={{
                                color: "#475569",
                                fontSize: "0.725rem",
                                fontWeight: 600,
                                p: 0,
                                minWidth: 0,
                                textTransform: "none",
                                "&:hover": {
                                  bgcolor: "transparent",
                                  color: BRAND_PRIMARY,
                                },
                              }}
                            >
                              {showFilledList
                                ? "▾ Hide filled questions"
                                : `▸ View ${autofillResult.filledCount} filled questions`}
                            </Button>
                            {showFilledList && (
                              <Box
                                sx={{
                                  mt: 0.75,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 0.5,
                                  maxHeight: 130,
                                  overflowY: "auto",
                                  pr: 0.5,
                                }}
                              >
                                {autofillResult.filledItems.map((item) => (
                                  <Box
                                    key={item.key}
                                    onClick={() => handleJumpToField(item.key)}
                                    sx={{
                                      p: 0.75,
                                      bgcolor: "#F8FAFC",
                                      borderRadius: 1,
                                      border: "1px solid #E2E8F0",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 1,
                                      cursor: "pointer",
                                      "&:hover": { borderColor: "#CBD5E1" },
                                    }}
                                  >
                                    <Box
                                      sx={{ overflow: "hidden", minWidth: 0 }}
                                    >
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          fontWeight: 600,
                                          color: "#334155",
                                          display: "block",
                                        }}
                                        noWrap
                                      >
                                        {cleanFieldLabel(item.label)}
                                      </Typography>
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          color: "#64748B",
                                          display: "block",
                                        }}
                                        noWrap
                                      >
                                        {item.value}
                                      </Typography>
                                    </Box>
                                    <CheckIcon
                                      sx={{
                                        fontSize: 15,
                                        color: "#10B981",
                                        flexShrink: 0,
                                      }}
                                    />
                                  </Box>
                                ))}
                              </Box>
                            )}
                          </Box>
                        )}
                      </Paper>
                    )}

                    {/* Status Banner */}
                    {autofillStatus && (
                      <Fade in>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 1.75,
                            borderRadius: 1,
                            mb: 2,
                            border: "1px solid",
                            bgcolor:
                              autofillStatus.type === "success"
                                ? "#ECFDF5"
                                : autofillStatus.type === "error"
                                  ? "#FEF2F2"
                                  : "#EFF6FF",
                            borderColor:
                              autofillStatus.type === "success"
                                ? "#A7F3D0"
                                : autofillStatus.type === "error"
                                  ? "#FECACA"
                                  : "#BFDBFE",
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 1.25,
                            }}
                          >
                            {autofillStatus.type === "info" && (
                              <CircularProgress
                                size={18}
                                sx={{ color: BRAND_PRIMARY, mt: 0.25 }}
                              />
                            )}
                            {autofillStatus.type === "success" && (
                              <AnswerIcon
                                sx={{ fontSize: 20, color: "#059669", mt: 0.1 }}
                              />
                            )}
                            {autofillStatus.type === "error" && (
                              <ErrorIcon
                                sx={{ fontSize: 20, color: "#DC2626", mt: 0.1 }}
                              />
                            )}
                            <Box sx={{ flex: 1 }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  color:
                                    autofillStatus.type === "success"
                                      ? "#065F46"
                                      : autofillStatus.type === "error"
                                        ? "#991B1B"
                                        : "#1E40AF",
                                }}
                              >
                                {autofillStatus.type === "success"
                                  ? "Autofill Complete"
                                  : autofillStatus.type === "error"
                                    ? "Connection Notice"
                                    : "Autofilling Page…"}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  display: "block",
                                  color:
                                    autofillStatus.type === "success"
                                      ? "#047857"
                                      : autofillStatus.type === "error"
                                        ? "#B91C1C"
                                        : "#2563EB",
                                  mt: 0.25,
                                }}
                              >
                                {autofillStatus.message}
                              </Typography>

                              {/* Helpful 1-click reload if tab connection lost */}
                              {autofillStatus.type === "error" && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={handleReloadActiveTab}
                                  startIcon={<RefreshIcon fontSize="small" />}
                                  sx={{
                                    mt: 1,
                                    borderColor: "#FCA5A5",
                                    color: "#991B1B",
                                    fontSize: "0.75rem",
                                    py: 0.5,
                                    "&:hover": {
                                      bgcolor: "#FEE2E2",
                                      borderColor: "#EF4444",
                                    },
                                  }}
                                >
                                  Refresh Webpage Tab
                                </Button>
                              )}
                            </Box>
                          </Box>
                        </Paper>
                      </Fade>
                    )}

                    {/* Primary CTA / Actions */}
                    <Box
                      sx={{
                        mt: "auto",
                        pt: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                      }}
                    >
                      {autofillResult && autofillResult.skippedCount > 0 ? (
                        <>
                          <Button
                            variant="contained"
                            fullWidth
                            size="large"
                            onClick={() => {
                              if (autofillResult.skippedItems[0]) {
                                handleJumpToField(autofillResult.skippedItems[0].key, true);
                              } else {
                                setAssistMode("focus");
                                chrome.storage.local.set({ assistMode: "focus" });
                              }
                            }}
                            startIcon={<FocusModeIcon />}
                            sx={{
                              py: 1.4,
                              fontSize: "0.925rem",
                              fontWeight: 700,
                              letterSpacing: 0.2,
                              bgcolor: "#1E293B",
                              color: "#FFFFFF",
                              "&:hover": { bgcolor: "#0F172A" },
                            }}
                          >
                            Review Skipped in Focus Assist ({autofillResult.skippedCount}) →
                          </Button>
                          <Button
                            variant="outlined"
                            fullWidth
                            size="medium"
                            disabled={autofillStatus?.type === "info"}
                            onClick={() => handleStartAutofill(true)}
                            startIcon={
                              autofillStatus?.type === "info" ? (
                                <CircularProgress size={18} sx={{ color: BRAND_PRIMARY }} />
                              ) : (
                                <AutofillModeIcon sx={{ color: BRAND_PRIMARY }} />
                              )
                            }
                            sx={{
                              py: 0.9,
                              fontSize: "0.825rem",
                              fontWeight: 700,
                              textTransform: "none",
                              color: `${BRAND_PRIMARY} !important`,
                              borderColor: "#BFDBFE",
                              bgcolor: "#FFFFFF",
                              "&:hover": {
                                borderColor: BRAND_PRIMARY,
                                bgcolor: "#EFF6FF",
                              },
                              ...(autofillStatus?.type === "info"
                                ? {
                                    color: `${BRAND_PRIMARY} !important`,
                                    borderColor: `${BRAND_PRIMARY} !important`,
                                    bgcolor: "#EFF6FF !important",
                                    "&.Mui-disabled": {
                                      color: `${BRAND_PRIMARY} !important`,
                                      borderColor: `${BRAND_PRIMARY} !important`,
                                      bgcolor: "#EFF6FF !important",
                                    },
                                  }
                                : {}),
                            }}
                          >
                            {autofillStatus?.type === "info"
                              ? "Writing Answers to Form…"
                              : "Re-run Auto-fill"}
                          </Button>
                        </>
                      ) : autofillResult &&
                        autofillResult.skippedCount === 0 ? (
                        <>
                          <Box
                            sx={{
                              p: 1.5,
                              borderRadius: 1,
                              bgcolor: "#ECFDF5",
                              border: "1px solid #A7F3D0",
                              textAlign: "center",
                            }}
                          >
                            <Typography
                              variant="subtitle2"
                              sx={{ fontWeight: 700, color: "#065F46" }}
                            >
                              ✓ All Page Questions Answered
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                color: "#047857",
                                display: "block",
                                mt: 0.25,
                              }}
                            >
                              Ready to review and proceed to next page.
                            </Typography>
                          </Box>
                          <Button
                            variant="text"
                            size="small"
                            onClick={() => handleStartAutofill(false)}
                            sx={{
                              color: "#64748B",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              textTransform: "none",
                              py: 0.5,
                              "&:hover": {
                                color: BRAND_PRIMARY,
                                bgcolor: "transparent",
                              },
                            }}
                          >
                            Re-run Auto-fill
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="contained"
                          color="primary"
                          fullWidth
                          size="large"
                          disabled={autofillStatus?.type === "info"}
                          onClick={() => handleStartAutofill(false)}
                          startIcon={
                            autofillStatus?.type === "info" ? (
                              <CircularProgress size={20} sx={{ color: "#FFFFFF" }} />
                            ) : (
                              <AutofillModeIcon sx={{ color: "#FFFFFF" }} />
                            )
                          }
                          sx={{
                            py: 1.4,
                            fontSize: "0.925rem",
                            fontWeight: 700,
                            letterSpacing: 0.2,
                            color: "#FFFFFF !important",
                            background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                            ...(autofillStatus?.type === "info"
                              ? {
                                  background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important",
                                  color: "#FFFFFF !important",
                                  opacity: 0.92,
                                  "&.Mui-disabled": {
                                    background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important",
                                    color: "#FFFFFF !important",
                                  },
                                }
                              : {}),
                          }}
                        >
                          {autofillStatus?.type === "info"
                            ? "Writing Answers to Form…"
                            : "Start Auto-fill"}
                        </Button>
                      )}
                    </Box>
                  </>
                )}
              </Paper>
            )}

            {/* FOCUS ASSIST MODE VIEW */}
            {assistMode === "focus" && (
              <Paper
                variant="outlined"
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 1,
                  display: "flex",
                  flexDirection: "column",
                  bgcolor: "#FFFFFF",
                  borderColor: "#E2E8F0",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                }}
              >
                {showCompletionPrompt && selectedCaseId && (
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: 1,
                      border: "1px solid #FDE68A",
                      bgcolor: "#FFFBEB",
                      mb: 2,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, mb: 1.5, color: "#92400E" }}
                    >
                      Are you finished with this portal step?
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        variant="contained"
                        fullWidth
                        size="small"
                        onClick={() => handleCompletionResponse(true)}
                        sx={{
                          bgcolor: "#D97706",
                          color: "#FFFFFF !important",
                          fontWeight: 700,
                          "&:hover": { bgcolor: "#B45309" },
                        }}
                      >
                        Yes, finished
                      </Button>
                      <Button
                        variant="outlined"
                        fullWidth
                        size="small"
                        onClick={() => handleCompletionResponse(false)}
                        sx={{ color: "#92400E", borderColor: "#FCD34D" }}
                      >
                        Still working
                      </Button>
                    </Box>
                  </Paper>
                )}

                {!selectedCaseId ? (
                  <Box
                    sx={{
                      textAlign: "center",
                      m: "auto",
                      py: 4,
                      color: "text.secondary",
                    }}
                  >
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 1,
                        bgcolor: "#EFF6FF",
                        color: BRAND_PRIMARY,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mx: "auto",
                        mb: 1.5,
                      }}
                    >
                      <FocusModeIcon sx={{ fontSize: 32 }} />
                    </Box>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, mb: 0.5 }}
                    >
                      Select an Application to Start
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Select your application above to start inspecting portal
                      questions.
                    </Typography>
                  </Box>
                ) : resolutionData ? (
                  <>
                    {/* Question Header */}
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        mb: 1,
                      }}
                    >
                      <Box sx={{ flex: 1, pr: 1 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 800,
                            letterSpacing: 0.5,
                            color: "#64748B",
                            fontSize: "0.6875rem",
                            textTransform: "uppercase",
                          }}
                        >
                          DETECTED QUESTION
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            color: "#0F172A",
                            mt: 0.25,
                            wordBreak: "break-word",
                          }}
                        >
                          {cleanFieldLabel(
                            (() => {
                              const fields = resolutionData.question.fields || [];
                              const meaningfulLabels = fields
                                .map((f: any) =>
                                  cleanFieldLabel(f.label || f.placeholder),
                                )
                                .filter((lbl: string) => {
                                  if (!lbl) return false;
                                  // Reject raw machine keys (e.g. codePassport_select, mat-radio-group-37)
                                  const isOpaque =
                                    /^(mat-radio-group-|mat-input-|select_|input_|field_|:r)/i.test(
                                      lbl,
                                    ) ||
                                    (!lbl.includes(" ") &&
                                      (lbl.includes("_") || lbl.includes("-")));
                                  return !isOpaque;
                                });

                              if (meaningfulLabels.length > 0) {
                                return meaningfulLabels.join(", ");
                              }

                              const headingFallback =
                                resolutionData.question.headings?.find(
                                  (h: string) =>
                                    h && !h.toLowerCase().includes("application"),
                                ) ||
                                resolutionData.question.headings?.[0] ||
                                resolutionData.question.title;

                              if (headingFallback) return headingFallback;

                              const raw =
                                fields[0]?.label ||
                                fields[0]?.name ||
                                fields[0]?.id ||
                                "Form Question";
                              return raw
                                .replace(/[_]/g, " ")
                                .replace(/\b\w/g, (c: string) => c.toUpperCase());
                            })(),
                          )}
                        </Typography>
                      </Box>
                      <Tooltip title="Clear Active Inspection">
                        <IconButton
                          size="small"
                          onClick={handleClearQuestion}
                          sx={{
                            color: "#94A3B8",
                            "&:hover": { color: "#0F172A", bgcolor: "#F1F5F9" },
                          }}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>

                    <Divider sx={{ my: 1.25, borderColor: "#F1F5F9" }} />

                    {!resolutionData.resolution ? (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.25,
                          py: 2,
                          color: "text.secondary",
                        }}
                      >
                        <CircularProgress
                          size={18}
                          sx={{ color: BRAND_PRIMARY }}
                        />
                        <Typography variant="body2" sx={{ color: "#475569" }}>
                          Analyzing case facts with Copilot…
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {/* Status Chip */}
                        {(() => {
                          const status = resolutionData.resolution.status;
                          const meta = STATUS_META[status] || STATUS_META.ERROR;
                          return (
                            <Chip
                              size="small"
                              icon={meta.icon}
                              label={meta.label}
                              sx={{
                                mb: 1.5,
                                alignSelf: "flex-start",
                                bgcolor: meta.bg,
                                color: meta.fg,
                                border: `1px solid ${meta.border}`,
                                fontWeight: 700,
                                "& .MuiChip-icon": { ml: 0.75 },
                              }}
                            />
                          );
                        })()}

                        {/* Answer Card */}
                        <Box
                          sx={{
                            bgcolor: "#F8FAFC",
                            p: 2,
                            borderRadius: 1,
                            mb: 2,
                            border: "1px solid #E2E8F0",
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              color: "#0F172A",
                              lineHeight: 1.5,
                              fontWeight: 500,
                            }}
                          >
                            {resolutionData.resolution.status ===
                            "DOCUMENT_REQUIRED"
                              ? `We found a matching document: ${
                                  resolutionData.resolution.documentName ||
                                  "Document"
                                }. Please download it and upload it to the portal.`
                              : resolutionData.resolution.status ===
                                  "MULTIPLE_POSSIBLE_FACTS"
                                ? "We found multiple possible answers in the case profile. Select one:"
                                : resolutionData.resolution.answer ||
                                  resolutionData.resolution.message ||
                                  "No answer available."}
                          </Typography>

                          {resolutionData.resolution.sourceReference && (
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.6,
                                mt: 1.25,
                                pt: 1,
                                borderTop: "1px dashed #E2E8F0",
                              }}
                            >
                              <ShieldIcon sx={{ fontSize: 13, color: "#059669" }} />
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "#64748B",
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                }}
                              >
                                Source: {resolutionData.resolution.sourceReference}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </>
                    )}

                    {/* Actions (Insert / Copy / Download / Manual) */}
                    {resolutionData.resolution && (
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                        }}
                      >
                        {resolutionData.resolution.answer &&
                          resolutionData.resolution.status !==
                            "DOCUMENT_REQUIRED" &&
                          resolutionData.resolution.status !==
                            "MULTIPLE_POSSIBLE_FACTS" && (
                            <Box sx={{ display: "flex", gap: 1, alignItems: "stretch" }}>
                              <Button
                                variant="contained"
                                color={insertSuccess ? "success" : "primary"}
                                startIcon={
                                  insertSuccess ? (
                                    <CheckIcon sx={{ fontSize: 18, color: "#FFFFFF" }} />
                                  ) : (
                                    <AutofillModeIcon sx={{ fontSize: 18, color: "#FFFFFF" }} />
                                  )
                                }
                                onClick={() =>
                                  handleAccept(
                                    resolutionData.resolution!.answer!,
                                  )
                                }
                                sx={{
                                  flex: 1,
                                  py: 1.15,
                                  fontWeight: 700,
                                  fontSize: "0.875rem",
                                  color: "#FFFFFF !important",
                                }}
                              >
                                {insertSuccess
                                  ? "Inserted — Advancing…"
                                  : "Insert into Form Field"}
                              </Button>

                              <Tooltip
                                title={
                                  copySuccess === resolutionData.resolution.answer
                                    ? "Copied to clipboard!"
                                    : "Copy to clipboard"
                                }
                                arrow
                              >
                                <Button
                                  variant="outlined"
                                  startIcon={
                                    copySuccess === resolutionData.resolution.answer ? (
                                      <CheckIcon sx={{ fontSize: 17, color: "#059669" }} />
                                    ) : (
                                      <CopyIcon sx={{ fontSize: 17 }} />
                                    )
                                  }
                                  onClick={() =>
                                    handleCopy(resolutionData.resolution!.answer)
                                  }
                                  sx={{
                                    minWidth: 84,
                                    px: 1.5,
                                    fontWeight: 600,
                                    fontSize: "0.8125rem",
                                    borderRadius: "8px",
                                    borderColor:
                                      copySuccess === resolutionData.resolution.answer
                                        ? "#86EFAC"
                                        : "#CBD5E1",
                                    bgcolor:
                                      copySuccess === resolutionData.resolution.answer
                                        ? "#F0FDF4"
                                        : "#FFFFFF",
                                    color:
                                      copySuccess === resolutionData.resolution.answer
                                        ? "#059669"
                                        : "#334155",
                                    "&:hover": {
                                      bgcolor:
                                        copySuccess === resolutionData.resolution.answer
                                          ? "#DCFCE7"
                                          : "#F8FAFC",
                                      borderColor:
                                        copySuccess === resolutionData.resolution.answer
                                          ? "#4ADE80"
                                          : BRAND_PRIMARY,
                                      color:
                                        copySuccess === resolutionData.resolution.answer
                                          ? "#047857"
                                          : BRAND_PRIMARY,
                                    },
                                  }}
                                >
                                  {copySuccess === resolutionData.resolution.answer
                                    ? "Copied"
                                    : "Copy"}
                                </Button>
                              </Tooltip>
                            </Box>
                          )}

                        {resolutionData.resolution.status ===
                          "MULTIPLE_POSSIBLE_FACTS" &&
                          resolutionData.resolution.multipleAnswers && (
                            <Box
                              sx={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 1,
                              }}
                            >
                              {resolutionData.resolution.multipleAnswers.map(
                                (ans, idx) => (
                                  <Button
                                    key={idx}
                                    variant="outlined"
                                    fullWidth
                                    onClick={() => handleAccept(ans)}
                                    sx={{
                                      justifyContent: "flex-start",
                                      textAlign: "left",
                                      py: 1,
                                      borderColor:
                                        copySuccess === ans
                                          ? "#10B981"
                                          : "#E2E8F0",
                                      color:
                                        copySuccess === ans
                                          ? "#059669"
                                          : "#0F172A",
                                    }}
                                  >
                                    {ans}
                                  </Button>
                                ),
                              )}
                            </Box>
                          )}

                        {resolutionData.resolution.status ===
                          "DOCUMENT_REQUIRED" &&
                          resolutionData.resolution.downloadUrl && (
                            <Button
                              variant="contained"
                              fullWidth
                              color="secondary"
                              onClick={() =>
                                window.open(
                                  resolutionData.resolution!.downloadUrl,
                                  "_blank",
                                )
                              }
                              sx={{ py: 1.2, color: "#FFFFFF !important" }}
                            >
                              Download{" "}
                              {resolutionData.resolution.documentName ||
                                "Document"}
                            </Button>
                          )}

                        {/* When there is NO autofill answer (e.g. INFORMATION_MISSING or manual selection), provide a primary "Next Question" button --
                            but only when another field actually exists to jump to; on the page's last field there is nothing to advance to. */}
                        {!resolutionData.resolution.answer &&
                          resolutionData.resolution.status !== "MULTIPLE_POSSIBLE_FACTS" &&
                          (activeField?.hasNextField !== false ? (
                            <Button
                              variant="contained"
                              color="primary"
                              fullWidth
                              endIcon={<ArrowIcon sx={{ fontSize: 18, color: "#FFFFFF" }} />}
                              onClick={handleAdvanceNextField}
                              sx={{
                                py: 1.15,
                                fontWeight: 700,
                                fontSize: "0.875rem",
                                color: "#FFFFFF !important",
                                borderRadius: "8px",
                              }}
                            >
                              Focus Next Field
                            </Button>
                          ) : (
                            <Box
                              sx={{
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor: "#EFF6FF",
                                border: "1px solid #BFDBFE",
                                textAlign: "center",
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{ color: "#1E40AF", fontWeight: 600, display: "block" }}
                              >
                                This is the last question on this page. Once
                                you've filled it in, click{" "}
                                <strong>Save and continue</strong> on the
                                portal to proceed.
                              </Typography>
                            </Box>
                          ))}

                        {/* Manual Override & Next Question Navigation --
                            not offered for file/document fields, which have
                            no sensible "type an answer" flow. */}
                        {!isFileField && (!showManualInput ? (
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: resolutionData.resolution.answer ? "space-between" : "center",
                              alignItems: "center",
                              pt: 0.35,
                            }}
                          >
                            <Button
                              variant="text"
                              size="small"
                              startIcon={<ManualAnswerIcon sx={{ fontSize: 14 }} />}
                              onClick={() => setShowManualInput(true)}
                              sx={{
                                color: "#64748B",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                py: 0.4,
                                px: 1.25,
                                borderRadius: "6px",
                                textTransform: "none",
                                "&:hover": {
                                  color: BRAND_PRIMARY,
                                  bgcolor: "rgba(37, 99, 235, 0.04)",
                                },
                              }}
                            >
                              I'll answer this question myself
                            </Button>

                            {resolutionData.resolution.answer &&
                              (activeField?.hasNextField !== false ? (
                                <Button
                                  variant="text"
                                  size="small"
                                  endIcon={<ArrowIcon sx={{ fontSize: 14 }} />}
                                  onClick={handleAdvanceNextField}
                                  sx={{
                                    color: BRAND_PRIMARY,
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    py: 0.4,
                                    px: 1.25,
                                    borderRadius: "6px",
                                    textTransform: "none",
                                    "&:hover": {
                                      color: "#1D4ED8",
                                      bgcolor: "rgba(37, 99, 235, 0.04)",
                                    },
                                  }}
                                >
                                  Focus Next Field
                                </Button>
                              ) : (
                                <Typography
                                  sx={{
                                    fontSize: "0.7rem",
                                    fontWeight: 600,
                                    color: "#64748B",
                                    px: 1.25,
                                  }}
                                >
                                  Last question -- click Save and continue
                                </Typography>
                              ))}
                          </Box>
                        ) : (
                          <Paper
                            variant="outlined"
                            sx={{
                              mt: 1,
                              p: 1.75,
                              borderRadius: 1,
                              bgcolor: "#F8FAFC",
                              borderColor: "#E2E8F0",
                            }}
                          >
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                mb: 1,
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  fontWeight: 700,
                                  color: "#0F172A",
                                  fontSize: "0.775rem",
                                }}
                              >
                                Validate & Save to Immpal Dossier
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => {
                                  setShowManualInput(false);
                                  setConsistencyResult(null);
                                  setManualAnswer("");
                                }}
                                sx={{
                                  p: 0.25,
                                  color: "#94A3B8",
                                  "&:hover": { color: "#475569" },
                                }}
                              >
                                <ClearIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Box>
                            {isChoiceField ? (
                              <ToggleButtonGroup
                                exclusive
                                fullWidth
                                value={manualAnswer || null}
                                onChange={(_, val) => val !== null && setManualAnswer(val)}
                                sx={{
                                  mb: 1.5,
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 0.75,
                                  "& .MuiToggleButtonGroup-grouped": {
                                    border: "1px solid #E2E8F0 !important",
                                    borderRadius: "8px !important",
                                    textTransform: "none",
                                    flex: "1 1 auto",
                                  },
                                }}
                              >
                                {activeFieldOptions.map((option) => (
                                  <ToggleButton
                                    key={option}
                                    value={option}
                                    sx={{ fontSize: "0.8125rem", py: 0.75, px: 1.5 }}
                                  >
                                    {option}
                                  </ToggleButton>
                                ))}
                              </ToggleButtonGroup>
                            ) : isCheckboxField ? (
                              <ToggleButtonGroup
                                exclusive
                                fullWidth
                                value={manualAnswer || null}
                                onChange={(_, val) => val !== null && setManualAnswer(val)}
                                sx={{ mb: 1.5, display: "flex", gap: 0.75 }}
                              >
                                <ToggleButton value="true" sx={{ flex: 1, fontSize: "0.8125rem", py: 0.75 }}>
                                  Yes
                                </ToggleButton>
                                <ToggleButton value="false" sx={{ flex: 1, fontSize: "0.8125rem", py: 0.75 }}>
                                  No
                                </ToggleButton>
                              </ToggleButtonGroup>
                            ) : (
                              <TextField
                                fullWidth
                                size="small"
                                multiline={isNarrativeField}
                                minRows={isNarrativeField ? 4 : undefined}
                                placeholder={
                                  isNarrativeField
                                    ? "Type your narrative answer…"
                                    : "Type your manual answer…"
                                }
                                value={manualAnswer}
                                onChange={(e) => setManualAnswer(e.target.value)}
                                sx={{ mb: 1.5 }}
                              />
                            )}
                            <Button
                              variant="contained"
                              fullWidth
                              size="small"
                              onClick={handleCheckConsistency}
                              disabled={!manualAnswer || isChecking}
                              sx={{
                                py: 1,
                                fontWeight: 700,
                                color: "#FFFFFF !important",
                                ...(isChecking
                                  ? {
                                      background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important",
                                      color: "#FFFFFF !important",
                                      opacity: 0.92,
                                      "&.Mui-disabled": {
                                        background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important",
                                        color: "#FFFFFF !important",
                                      },
                                    }
                                  : !manualAnswer
                                  ? {
                                      background: "#E2E8F0 !important",
                                      bgcolor: "#E2E8F0 !important",
                                      color: "#94A3B8 !important",
                                      boxShadow: "none !important",
                                      "&.Mui-disabled": {
                                        background: "#E2E8F0 !important",
                                        bgcolor: "#E2E8F0 !important",
                                        color: "#94A3B8 !important",
                                      },
                                    }
                                  : {
                                      background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                                    }),
                              }}
                            >
                              {isChecking ? (
                                <CircularProgress size={18} sx={{ color: "#FFFFFF" }} />
                              ) : (
                                "Check Consistency with Dossier"
                              )}
                            </Button>

                            {consistencyResult && (
                              <Box
                                sx={{
                                  mt: 1.5,
                                  p: 1.5,
                                  bgcolor: "#FFFFFF",
                                  borderRadius: 1,
                                  border: "1px solid #E2E8F0",
                                }}
                              >
                                {(() => {
                                  const status = consistencyResult.status;
                                  let label = status;
                                  let color = "#D97706";
                                  let bg = "#FFFBEB";
                                  let border = "#FDE68A";

                                  if (status === "CONSISTENT") {
                                    label = "Consistent with Case";
                                    color = "#059669";
                                    bg = "#ECFDF5";
                                    border = "#A7F3D0";
                                  } else if (status === "NEW_INFORMATION") {
                                    label = "New Information";
                                    color = "#2563EB";
                                    bg = "#EFF6FF";
                                    border = "#BFDBFE";
                                  } else if (
                                    status === "DIFFERENT_FROM_CASE_HISTORY" ||
                                    status === "CONFLICT"
                                  ) {
                                    label = "Different from Case History";
                                    color = "#D97706";
                                    bg = "#FFFBEB";
                                    border = "#FDE68A";
                                  } else if (status === "UNABLE_TO_VERIFY") {
                                    label = "Unable to Verify";
                                    color = "#64748B";
                                    bg = "#F8FAFC";
                                    border = "#E2E8F0";
                                  }

                                  return (
                                    <Chip
                                      size="small"
                                      label={label}
                                      sx={{
                                        mb: 0.75,
                                        bgcolor: bg,
                                        color,
                                        border: `1px solid ${border}`,
                                        fontWeight: 700,
                                        fontSize: "0.75rem",
                                      }}
                                    />
                                  );
                                })()}
                                {consistencyResult.rationale && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", mt: 0.5, lineHeight: 1.45 }}
                                  >
                                    {consistencyResult.rationale}
                                  </Typography>
                                )}
                                {consistencyResult.sourceReference && (
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "block",
                                      mt: 0.5,
                                      color: "#64748B",
                                      fontSize: "0.6875rem",
                                      fontFamily: "monospace",
                                      bgcolor: "#F1F5F9",
                                      px: 0.75,
                                      py: 0.25,
                                      borderRadius: "4px",
                                      width: "fit-content",
                                    }}
                                  >
                                    🛡️ Source: {consistencyResult.sourceReference}
                                  </Typography>
                                )}

                                <Button
                                  variant={isSaved ? "contained" : "outlined"}
                                  size="small"
                                  fullWidth
                                  onClick={handleSaveOverride}
                                  disabled={isSaved}
                                  sx={{
                                    mt: 1,
                                    fontWeight: 700,
                                    ...(isSaved
                                      ? {
                                          bgcolor: "#10B981 !important",
                                          background: "#10B981 !important",
                                          color: "#FFFFFF !important",
                                          borderColor: "transparent !important",
                                          "&.Mui-disabled": {
                                            bgcolor: "#10B981 !important",
                                            background: "#10B981 !important",
                                            color: "#FFFFFF !important",
                                          },
                                        }
                                      : {
                                          color: BRAND_PRIMARY,
                                          borderColor: BRAND_PRIMARY,
                                          "&:hover": {
                                            bgcolor: "#EFF6FF",
                                            borderColor: "#1D4ED8",
                                          },
                                        }),
                                  }}
                                >
                                  {isSaved
                                    ? "Saved to Immpal ✓"
                                    : "Save Update to Case"}
                                </Button>
                              </Box>
                            )}
                          </Paper>
                        ))}
                      </Box>
                    )}
                  </>
                ) : (
                  <Box
                    sx={{
                      textAlign: "center",
                      m: "auto",
                      py: 4,
                      color: "text.secondary",
                    }}
                  >
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 1,
                        bgcolor: "#EFF6FF",
                        color: BRAND_PRIMARY,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mx: "auto",
                        mb: 1.5,
                      }}
                    >
                      <FocusModeIcon sx={{ fontSize: 28 }} />
                    </Box>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, mb: 0.5, color: "#0F172A" }}
                    >
                      Ready to Inspect
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ maxWidth: 240, mx: "auto" }}
                    >
                      Click or focus into any portal question to get verified
                      answers.
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      endIcon={<ArrowIcon sx={{ fontSize: 15 }} />}
                      onClick={handleAdvanceNextField}
                      sx={{
                        mt: 1.5,
                        fontWeight: 600,
                        fontSize: "0.775rem",
                        borderRadius: "8px",
                        borderColor: "#CBD5E1",
                        color: BRAND_PRIMARY,
                        textTransform: "none",
                        "&:hover": {
                          borderColor: BRAND_PRIMARY,
                          bgcolor: "rgba(37, 99, 235, 0.04)",
                        },
                      }}
                    >
                      Focus Next Field
                    </Button>
                  </Box>
                )}
              </Paper>
            )}
              </>
            )}
          </Box>

          {/* Bottom Workspace Session Footer */}
          <Box
            sx={{
              px: 2,
              py: 1.15,
              borderTop: "1px solid #E2E8F0",
              bgcolor: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.85 }}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: "#10B981",
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  color: "#64748B",
                  fontWeight: 600,
                  fontSize: "0.725rem",
                }}
              >
                Connected to Immpal Copilot
              </Typography>
            </Box>

            <Button
              size="small"
              onClick={handleSignOut}
              startIcon={<LogoutIcon sx={{ fontSize: 13 }} />}
              sx={{
                color: "#64748B",
                fontSize: "0.725rem",
                fontWeight: 600,
                py: 0.35,
                px: 1,
                minWidth: 0,
                borderRadius: 1,
                border: "1px solid transparent",
                "&:hover": {
                  color: "#DC2626",
                  bgcolor: "#FEF2F2",
                },
              }}
            >
              Sign Out
            </Button>
          </Box>
        </>
      ) : (
        /* Logged Out / Login View */
        <Box
          sx={{
            p: 2.5,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "space-between",
            background:
              "radial-gradient(ellipse 100% 50% at 50% 0%, rgba(37, 99, 235, 0.08) 0%, rgba(248, 250, 252, 0) 100%), #F8FAFC",
            overflowY: "auto",
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              pt: 2,
              px: 0.5,
            }}
          >
            {/* AI Copilot Badge */}
            <Box
              sx={{
                width: 60,
                height: 60,
                borderRadius: "16px",
                background: "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
                border: "1px solid #BFDBFE",
                boxShadow:
                  "0 8px 20px -4px rgba(37, 99, 235, 0.18), 0 2px 4px -1px rgba(37, 99, 235, 0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
                position: "relative",
              }}
            >
              <AutofillModeIcon
                sx={{
                  fontSize: 30,
                  color: BRAND_PRIMARY,
                  filter: "drop-shadow(0 2px 4px rgba(37, 99, 235, 0.25))",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  bottom: -3,
                  right: -3,
                  width: 19,
                  height: 19,
                  borderRadius: "50%",
                  bgcolor: "#FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 4px rgba(15, 23, 42, 0.1)",
                  border: "1px solid #E2E8F0",
                }}
              >
                <ShieldIcon sx={{ fontSize: 11, color: "#10B981" }} />
              </Box>
            </Box>

            <Typography
              variant="h6"
              sx={{
                fontWeight: 800,
                color: "#0F172A",
                mb: 0.75,
                fontSize: "1.25rem",
                letterSpacing: "-0.4px",
                lineHeight: 1.25,
              }}
            >
              Welcome to Immpal Copilot
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mb: 2.75,
                maxWidth: 290,
                fontSize: "0.84rem",
                lineHeight: 1.5,
              }}
            >
              Connect your verified application profile to autofill official
              immigration portal forms with 100% precision.
            </Typography>

            {/* Value Proposition Cards */}
            <Box
              sx={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 1.2,
                mb: 2.5,
                textAlign: "left",
              }}
            >
              <Paper
                variant="outlined"
                sx={{
                  p: 1.25,
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  bgcolor: "#FFFFFF",
                  borderRadius: "10px",
                  borderColor: "#E2E8F0",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    borderColor: "#CBD5E1",
                    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "8px",
                    bgcolor: "#EFF6FF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <AutofillModeIcon
                    sx={{ fontSize: 19, color: BRAND_PRIMARY }}
                  />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.8125rem",
                      color: "#0F172A",
                    }}
                  >
                    1-Click Portal Autofill
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#64748B",
                      lineHeight: 1.3,
                      display: "block",
                      fontSize: "0.72rem",
                    }}
                  >
                    Fills portal questions across all steps and sections.
                  </Typography>
                </Box>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  p: 1.25,
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  bgcolor: "#FFFFFF",
                  borderRadius: "10px",
                  borderColor: "#E2E8F0",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    borderColor: "#CBD5E1",
                    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "8px",
                    bgcolor: "#ECFDF5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <ShieldIcon sx={{ fontSize: 19, color: "#059669" }} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.8125rem",
                      color: "#0F172A",
                    }}
                  >
                    100% Verified Profile Data
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#64748B",
                      lineHeight: 1.3,
                      display: "block",
                      fontSize: "0.72rem",
                    }}
                  >
                    Directly mapped from your audited application package.
                  </Typography>
                </Box>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  p: 1.25,
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  bgcolor: "#FFFFFF",
                  borderRadius: "10px",
                  borderColor: "#E2E8F0",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    borderColor: "#CBD5E1",
                    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "8px",
                    bgcolor: "#F5F3FF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <FocusModeIcon sx={{ fontSize: 19, color: "#7C3AED" }} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.8125rem",
                      color: "#0F172A",
                    }}
                  >
                    Focus Assist & Consistency
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#64748B",
                      lineHeight: 1.3,
                      display: "block",
                      fontSize: "0.72rem",
                    }}
                  >
                    Real-time field validation to avoid application rejections.
                  </Typography>
                </Box>
              </Paper>
            </Box>
          </Box>

          {/* Action Button & Security Footer */}
          <Box sx={{ pt: 1, pb: 0.5 }}>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              size="large"
              endIcon={<ArrowIcon />}
              onClick={() =>
                chrome.runtime.sendMessage({ type: "INITIATE_LOGIN" })
              }
              sx={{
                py: 1.35,
                fontSize: "0.9375rem",
                fontWeight: 700,
                borderRadius: "10px",
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                boxShadow: "0 4px 14px rgba(37, 99, 235, 0.35)",
                "&:hover": {
                  background:
                    "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
                  boxShadow: "0 6px 20px rgba(37, 99, 235, 0.45)",
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  transform: "translateY(0)",
                },
              }}
            >
              Sign in to Immpal
            </Button>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.75,
                mt: 1.5,
              }}
            >
              <LockIcon sx={{ fontSize: 12, color: "#94A3B8" }} />
              <Typography
                variant="caption"
                sx={{
                  color: "#94A3B8",
                  fontSize: "0.71rem",
                  fontWeight: 500,
                }}
              >
                Secure authentication via your Immpal web session
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};
export default Popup;
