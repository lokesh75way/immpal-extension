import { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography, IconButton, Tooltip, TextField, CircularProgress, Switch, FormControlLabel } from '@mui/material';
import { Logout as LogoutIcon, Clear as ClearIcon } from '@mui/icons-material';
import { CaseSelector } from './CaseSelector';

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

const Popup = () => {
  const [token, setToken] = useState<string | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const [resolutionData, setResolutionData] = useState<ResolvedQuestionPayload | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Manual Override State
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAnswer, setManualAnswer] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [consistencyResult, setConsistencyResult] = useState<{ status: string, rationale?: string } | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Clarification response (distinct from "I'll answer this myself")
  const [clarificationAnswer, setClarificationAnswer] = useState("");

  // Session completion confirmation
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);

  const checkToken = () => {
    chrome.storage.local.get("immpalAuthToken", (result) => {
      setToken((result.immpalAuthToken as string) || null);
    });
  };

  useEffect(() => {
    checkToken();

    // Every message and stored value is scoped to the tab this panel is
    // currently showing -- resolve it once up front so selecting a case (or
    // anything detected) never leaks into or gets overwritten by another tab.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      setCurrentTabId(tabId);

      chrome.runtime.sendMessage({ type: "GET_ACTIVE_CASE", tabId }, (response) => {
        if (response?.caseId) setSelectedCaseId(response.caseId);
      });

      chrome.runtime.sendMessage({ type: "GET_LAST_RESOLUTION", tabId }, (response) => {
        if (response && response.data) setResolutionData(response.data);
      });

      chrome.runtime.sendMessage({ type: "GET_SESSION_STATE", tabId }, (response) => {
        setShowCompletionPrompt(response?.sessionState === "COMPLETION_CONFIRMATION");
      });
    });

    const listener = (request: any) => {
      if (request.type === "TOKEN_UPDATED") {
        checkToken();
      } else if (
        (request.type === "QUESTION_RESOLVED" || request.type === "QUESTION_DETECTED") &&
        request.payload &&
        request.tabId === currentTabIdRef.current
      ) {
        setResolutionData(request.payload);
        setCopySuccess(null);
        setShowManualInput(false);
        setManualAnswer("");
        setClarificationAnswer("");
        setConsistencyResult(null);
        setIsSaved(false);
        setShowCompletionPrompt(false);
      } else if (request.type === "SESSION_COMPLETION_PROMPT" && request.tabId === currentTabIdRef.current) {
        setShowCompletionPrompt(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Get pause state
    chrome.storage.local.get(["isPaused"], (res) => {
      setIsPaused(!!res.isPaused);
    });

    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // The message listener above is registered once on mount (before
  // currentTabId is known), so it reads the latest tab id via a ref rather
  // than closing over a stale null.
  const currentTabIdRef = useRef<number | null>(null);
  useEffect(() => {
    currentTabIdRef.current = currentTabId;
  }, [currentTabId]);

  // Update active case in background script when user selects one; clear all
  // session state (including stale completion prompts) whenever the case
  // actually changes or is cleared -- session state must never outlive its
  // case. Skips the initial mount so it doesn't race the mount-time restore
  // of a still-valid lastResolution/sessionState above.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (currentTabId === null) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (selectedCaseId) {
        chrome.runtime.sendMessage({ type: "SET_ACTIVE_CASE", caseId: selectedCaseId, tabId: currentTabId });
      }
      return;
    }
    setResolutionData(null);
    setShowCompletionPrompt(false);
    chrome.storage.local.remove([`lastResolution_${currentTabId}`, `sessionState_${currentTabId}`]);
    if (selectedCaseId) {
      chrome.runtime.sendMessage({ type: "SET_ACTIVE_CASE", caseId: selectedCaseId, tabId: currentTabId });
    }
  }, [selectedCaseId, currentTabId]);

  const handleTogglePause = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = !e.target.checked; // checked means Active, so isPaused is false
    setIsPaused(val);
    chrome.storage.local.set({ isPaused: val });
  };

  const handleClearQuestion = () => {
    setResolutionData(null);
    chrome.storage.local.remove(["lastResolution"]);
  };

  const handleEndSession = () => {
    chrome.storage.local.remove(
      ["activeCopilotCaseId", "lastResolution", "sessionState"],
      () => {
        setSelectedCaseId(null);
        setResolutionData(null);
        setCopySuccess(null);
        setShowManualInput(false);
        setManualAnswer("");
        setClarificationAnswer("");
        setConsistencyResult(null);
        setIsSaved(false);
        setShowCompletionPrompt(false);
      }
    );
  };

  const handleSignOut = () => {
    chrome.storage.local.remove(["immpalAuthToken", "immpalRefreshToken"], () => {
      setToken(null);
    });
  };

  const handleCopy = async (textToCopy?: string) => {
    const text = textToCopy || resolutionData?.resolution?.answer;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(text);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleCheckConsistency = () => {
    if (!manualAnswer || !resolutionData?.question?.fields?.length) return;
    setIsChecking(true);
    setConsistencyResult(null);
    
    const fieldKey = resolutionData.question.fields[0].label || resolutionData.question.fields[0].placeholder || resolutionData.question.fields[0].name;

    chrome.runtime.sendMessage({
      type: "CHECK_CONSISTENCY",
      payload: { field_key: fieldKey, user_answer: manualAnswer }
    }, (response) => {
      setIsChecking(false);
      if (response?.success && response.data) {
        setConsistencyResult(response.data);
      } else {
        setConsistencyResult({ status: "ERROR", rationale: response?.error || "Unknown error" });
      }
    });
  };

  const handleSaveOverride = () => {
    if (!manualAnswer || !consistencyResult || !resolutionData?.question?.fields?.length) return;

    const fieldKey = resolutionData.question.fields[0].label || resolutionData.question.fields[0].placeholder || resolutionData.question.fields[0].name;

    chrome.runtime.sendMessage({
      type: "SAVE_OVERRIDE",
      payload: {
        field_key: fieldKey,
        user_answer: manualAnswer,
        status: consistencyResult.status,
        rationale: consistencyResult.rationale
      }
    }, (response) => {
      if (response?.success) {
        setIsSaved(true);
      }
    });
  };

  const handleCompletionResponse = (finished: boolean) => {
    chrome.runtime.sendMessage({
      type: "SESSION_COMPLETION_RESPONSE",
      payload: { finished },
    }, () => {
      setShowCompletionPrompt(false);
    });
  };

  return (
    <Box sx={{ width: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column', bgcolor: '#ffffff', boxSizing: 'border-box' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid #e0e0e0' }}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 'bold', color: '#172033' }}>
          Immpal Copilot
        </Typography>
        {token && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FormControlLabel
              control={<Switch size="small" checked={!isPaused} onChange={handleTogglePause} color="success" />}
              label={<Typography variant="caption">{!isPaused ? "Active" : "Paused"}</Typography>}
              sx={{ m: 0 }}
            />
            <Tooltip title="Sign Out">
              <IconButton size="small" onClick={handleSignOut} sx={{ color: 'text.secondary' }}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      
      {token ? (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 'bold' }}>Active Case</Typography>
              {selectedCaseId && (
                <Button
                  size="small"
                  onClick={handleEndSession}
                  sx={{ textTransform: 'none', fontSize: '11px', color: 'text.secondary', minWidth: 0, p: '2px 6px' }}
                >
                  End Copilot Session
                </Button>
              )}
            </Box>
            <CaseSelector
              onCaseSelect={setSelectedCaseId}
              selectedCaseId={selectedCaseId}
            />
          </Box>

          <Box sx={{ flex: 1, background: '#f4f5f7', p: 2, borderRadius: 2 }}>
            {showCompletionPrompt && selectedCaseId && (
              <Box sx={{ bgcolor: '#fff', p: 2, borderRadius: 1, border: '1px solid #dfe1e6', mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1.5 }}>
                  Are you finished with this questionnaire?
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button variant="contained" fullWidth size="small" onClick={() => handleCompletionResponse(true)} sx={{ textTransform: 'none' }}>
                    Yes, I'm finished
                  </Button>
                  <Button variant="outlined" fullWidth size="small" onClick={() => handleCompletionResponse(false)} sx={{ textTransform: 'none' }}>
                    No, I'm still working
                  </Button>
                </Box>
              </Box>
            )}
            {!selectedCaseId ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
                Please select a case above to begin.
              </Typography>
            ) : resolutionData ? (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Detected Fields:</Typography>
                  <Tooltip title="Clear Current Question">
                    <IconButton size="small" onClick={handleClearQuestion} sx={{ padding: '2px' }}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 2, wordBreak: 'break-word' }}>
                    {resolutionData.question.fields && resolutionData.question.fields.length > 0
                      ? resolutionData.question.fields.map((f: any) => f.label || f.placeholder || f.name || f.id).join(', ')
                      : (resolutionData.question.headings[0] || resolutionData.question.title)}
                  </Typography>

                  <Typography variant="caption" color="text.secondary">
                    {!resolutionData.resolution ? 'Reading this question…' :
                      resolutionData.resolution.status === "SUGGESTED_NARRATIVE" ? "Suggested response:" :
                        resolutionData.resolution.status === "CLARIFICATION_REQUIRED" ? "Clarification needed:" :
                          resolutionData.resolution.status === "INFORMATION_MISSING" ? "Information missing:" :
                            "Suggested answer:"}
                  </Typography>
                  <Box sx={{
                    bgcolor: '#fff', p: 1, borderRadius: 1, mb: 2, minHeight: '40px',
                    border: resolutionData.resolution?.status === "CLARIFICATION_REQUIRED" ? '1px solid #f59e0b' : '1px solid #dfe1e6',
                  }}>
                    <Typography variant="body2">
                      {!resolutionData.resolution ? "⏳ Reading this question…" :
                        resolutionData.resolution.status === "DOCUMENT_REQUIRED" ?
                          `We found a matching document: ${resolutionData.resolution.documentName || 'Document'}. Please download it and upload it here.` :
                          resolutionData.resolution.status === "MULTIPLE_POSSIBLE_FACTS" ?
                            "We found multiple possible answers for this field. Please select the correct one:" :
                            (resolutionData.resolution.answer || resolutionData.resolution.message || "No answer available.")}
                    </Typography>
                  </Box>

                  {resolutionData.resolution?.status === "CLARIFICATION_REQUIRED" && (
                    <Box sx={{ mb: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Answer the clarifying question above..."
                        value={clarificationAnswer}
                        onChange={(e) => setClarificationAnswer(e.target.value)}
                        sx={{ bgcolor: '#fff', mb: 1 }}
                      />
                      <Button
                        variant="contained"
                        fullWidth
                        size="small"
                        disabled={!clarificationAnswer}
                        onClick={() => {
                          setManualAnswer(clarificationAnswer);
                          setShowManualInput(true);
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        Submit clarification
                      </Button>
                    </Box>
                  )}

                  {resolutionData.resolution && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {resolutionData.resolution.answer && resolutionData.resolution.status !== "DOCUMENT_REQUIRED" && resolutionData.resolution.status !== "MULTIPLE_POSSIBLE_FACTS" && (
                        <Button
                          variant="contained"
                          fullWidth
                          color={copySuccess === resolutionData.resolution.answer ? "success" : "primary"}
                          onClick={() => handleCopy(resolutionData.resolution!.answer)}
                          sx={{ fontWeight: 'bold', textTransform: 'none' }}
                        >
                          {copySuccess === resolutionData.resolution.answer ? 'Copied!' : 'Copy to Clipboard'}
                        </Button>
                      )}
                      {resolutionData.resolution.status === "MULTIPLE_POSSIBLE_FACTS" && resolutionData.resolution.multipleAnswers && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {resolutionData.resolution.multipleAnswers.map((ans, idx) => (
                            <Button
                              key={idx}
                              variant="outlined"
                              fullWidth
                              color={copySuccess === ans ? "success" : "primary"}
                              onClick={() => handleCopy(ans)}
                              sx={{ fontWeight: 'bold', textTransform: 'none', justifyContent: 'flex-start', textAlign: 'left' }}
                            >
                              {copySuccess === ans ? 'Copied!' : ans}
                            </Button>
                          ))}
                        </Box>
                      )}
                      {resolutionData.resolution.status === "DOCUMENT_REQUIRED" && resolutionData.resolution.downloadUrl && (
                        <Button
                          variant="contained" 
                          fullWidth
                          color="primary"
                          onClick={() => window.open(resolutionData.resolution!.downloadUrl, '_blank')}
                          sx={{ fontWeight: 'bold', textTransform: 'none' }}
                        >
                          Download {resolutionData.resolution.documentName || "Document"}
                        </Button>
                      )}
                      {!showManualInput ? (
                        <Button
                          variant="outlined"
                          fullWidth
                          color="secondary"
                          onClick={() => setShowManualInput(true)}
                          sx={{ fontWeight: 'bold', textTransform: 'none' }}
                        >
                          I'll answer this myself
                        </Button>
                      ) : (
                        <Box sx={{ mt: 2, p: 2, bgcolor: '#f9fafb', borderRadius: 2, border: '1px solid #dfe1e6' }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold', mb: 1, display: 'block' }}>
                            Share my answer with IMMPAL
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="Type your answer here..."
                            value={manualAnswer}
                            onChange={(e) => setManualAnswer(e.target.value)}
                            sx={{ bgcolor: '#fff', mb: 1 }}
                          />
                          <Button
                            variant="contained" 
                              fullWidth
                              size="small"
                              color="primary"
                              onClick={handleCheckConsistency}
                              disabled={!manualAnswer || isChecking}
                              sx={{ textTransform: 'none' }}
                            >
                              {isChecking ? <CircularProgress size={20} color="inherit" /> : 'Check Consistency'}
                            </Button>

                            {consistencyResult && (
                              <Box sx={{ mt: 2 }}>
                                <Typography variant="body2" color={consistencyResult.status === 'CONSISTENT' ? 'success.main' : 'warning.main'} sx={{ fontWeight: 'bold' }}>
                                  Status: {consistencyResult.status}
                                </Typography>
                                {consistencyResult.rationale && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
                                    {consistencyResult.rationale}
                                  </Typography>
                                )}

                                {(consistencyResult.status === 'NEW_INFORMATION' || consistencyResult.status === 'CONFLICT') && (
                                  <Box sx={{ mt: 1, p: 1, bgcolor: '#fff3cd', borderRadius: 1 }}>
                                    <Typography variant="caption" color="text.primary" sx={{ display: 'block', mb: 1 }}>
                                      This differs from your Immpal profile. Save this answer to your Case for future forms?
                                    </Typography>
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      color="warning"
                                      fullWidth
                                      onClick={handleSaveOverride}
                                      disabled={isSaved}
                                      sx={{ textTransform: 'none', fontWeight: 'bold' }}
                                    >
                                    {isSaved ? 'Saved to Immpal ✓' : 'Save Update'}
                                  </Button>
                                </Box>
                              )}
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
                  Awaiting question detection...<br /><br />Navigate to an external portal to begin.
              </Typography>
            )}
          </Box>
        </Box>
      ) : (
        <Box sx={{ p: 3, textAlign: 'center', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Connect to the Immpal web app to fetch your case data and access the Copilot.
          </Typography>
          <Button 
            variant="contained" 
            color="primary" 
            fullWidth
            size="large"
            onClick={() => chrome.runtime.sendMessage({ type: "INITIATE_LOGIN" })}
            sx={{ py: 1.5, fontWeight: 'bold', textTransform: 'none', borderRadius: 2 }}
          >
            Login to Immpal
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default Popup;
