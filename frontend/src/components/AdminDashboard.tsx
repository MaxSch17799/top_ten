import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminReauthorize,
  ApiError,
  copyAdminQuestionBank,
  createAdminQuestionBank,
  fetchAdminQuestionBankDetail,
  fetchAdminQuestionBanks,
  fetchAdminUsageStatus,
  importAdminQuestionBank,
  restoreAdminQuestionBankRevision,
  updateAdminQuestionBank,
} from '../api';
import { clearAdminToken, clearOverrideToken, loadAdminToken, loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import type { AdminQuestionBankDetail, QuestionBankCatalogItem, UsageStatus } from '../lib/types';
import PasswordPromptDialog from './PasswordPromptDialog';

function promptsToEditorText(prompts: string[]): string {
  return prompts.join('\n');
}

function editorTextToPrompts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createCsvContent(detail: AdminQuestionBankDetail): string {
  const rows = ['question_id,prompt'];
  for (const question of detail.bank.questions) {
    const escaped = `"${question.prompt.replace(/"/g, '""')}"`;
    rows.push(`${question.id},${escaped}`);
  }
  return `${rows.join('\n')}\n`;
}

function triggerCsvDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function parseCsvFile(file: File): Promise<string[]> {
  const module = await import('papaparse');
  const Papa = module.default as typeof import('papaparse');
  const text = await file.text();
  const withHeaders = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const headerPrompts = withHeaders.data
    .map((row: Record<string, string>) => row.prompt ?? row.question ?? row.text ?? row['Prompt'] ?? row['Question'] ?? row['Text'] ?? '')
    .map((prompt: string) => String(prompt).trim())
    .filter(Boolean);
  if (headerPrompts.length > 0) {
    return headerPrompts;
  }
  const withoutHeaders = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });
  return withoutHeaders.data
    .map((row: string[]) => row.find((cell: string) => String(cell ?? '').trim()) ?? '')
    .map((prompt: string) => String(prompt).trim())
    .filter(Boolean);
}

async function parseSpreadsheetFile(file: File): Promise<{ prompts: string[]; note: string }> {
  const xlsx = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const prompts = rows
    .map((row) => row.prompt ?? row.question ?? row.text ?? row['Prompt'] ?? row['Question'] ?? row['Text'] ?? '')
    .map((prompt) => String(prompt).trim())
    .filter(Boolean);
  if (prompts.length > 0) {
    return { prompts, note: `Imported from the first worksheet: ${sheetName}` };
  }
  const fallbackRows = xlsx.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, defval: '' });
  return {
    prompts: fallbackRows
      .map((row) => row.find((cell) => String(cell ?? '').trim()) ?? '')
      .map((prompt) => String(prompt).trim())
      .filter(Boolean),
    note: `Imported from the first worksheet: ${sheetName}`,
  };
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [adminToken, setAdminToken] = useState<string | null>(() => loadAdminToken());
  const [banks, setBanks] = useState<QuestionBankCatalogItem[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AdminQuestionBankDetail | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorText, setEditorText] = useState('');
  const [importPrompts, setImportPrompts] = useState<string[]>([]);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePassword, setOverridePassword] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const pendingWriteRef = useRef<(() => Promise<void>) | null>(null);

  const isEditingDbBank = Boolean(!isCreating && selectedDetail && !selectedDetail.readOnly);
  const editorPromptCount = useMemo(() => editorTextToPrompts(editorText).length, [editorText]);

  const handleUnauthorized = useCallback(() => {
    clearAdminToken();
    clearOverrideToken();
    setAdminToken(null);
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const refreshBanks = useCallback(async (preserveSelection = true) => {
    if (!adminToken) {
      return;
    }
    try {
      const [bankResult, usageResult] = await Promise.all([
        fetchAdminQuestionBanks(adminToken),
        fetchAdminUsageStatus(adminToken),
      ]);
      setBanks(bankResult.banks);
      setUsage(usageResult);
      if (!preserveSelection && bankResult.banks.length > 0) {
        setSelectedBankId(bankResult.banks[0].id);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'UNAUTHORIZED') {
        handleUnauthorized();
        return;
      }
      setPageError(cause instanceof Error ? cause.message : 'Could not load admin data');
    }
  }, [adminToken, handleUnauthorized]);

  const loadDetail = useCallback(async (bankId: string) => {
    if (!adminToken) {
      return;
    }
    setBusyLabel('Loading bank...');
    setPageError(null);
    try {
      const result = await fetchAdminQuestionBankDetail(adminToken, bankId);
      setSelectedDetail(result.detail);
      setSelectedBankId(bankId);
      setIsCreating(false);
      setEditorName(result.detail.bank.name);
      setEditorDescription(result.detail.description);
      setEditorText(promptsToEditorText(result.detail.bank.questions.map((question) => question.prompt)));
      setImportPrompts([]);
      setImportNote(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'UNAUTHORIZED') {
        handleUnauthorized();
        return;
      }
      setPageError(cause instanceof Error ? cause.message : 'Could not load bank');
    } finally {
      setBusyLabel(null);
    }
  }, [adminToken, handleUnauthorized]);

  useEffect(() => {
    if (!adminToken) {
      navigate('/admin/login', { replace: true });
      return;
    }
    void refreshBanks(false);
  }, [adminToken, navigate, refreshBanks]);

  useEffect(() => {
    if (selectedBankId && !isCreating) {
      void loadDetail(selectedBankId);
    }
  }, [selectedBankId, isCreating, loadDetail]);

  const openOverrideModal = (action: () => Promise<void>) => {
    pendingWriteRef.current = action;
    setOverridePassword('');
    setOverrideError(null);
    setOverrideOpen(true);
  };

  const runWriteAction = async (action: (overrideToken: string | null) => Promise<void>) => {
    try {
      await action(loadOverrideToken());
      setOverrideOpen(false);
      setOverridePassword('');
      setOverrideError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'UNAUTHORIZED') {
        handleUnauthorized();
        return;
      }
      if (cause instanceof ApiError && cause.code === 'LIMIT_NEAR') {
        openOverrideModal(() => action(loadOverrideToken()));
        return;
      }
      throw cause;
    }
  };

  const startNewBank = () => {
    setIsCreating(true);
    setSelectedBankId(null);
    setSelectedDetail(null);
    setEditorName('');
    setEditorDescription('');
    setEditorText('');
    setImportPrompts([]);
    setImportNote(null);
    setPageError(null);
  };

  const handleSave = async () => {
    const prompts = editorTextToPrompts(editorText);
    if (!prompts.length) {
      setPageError('Enter at least one question');
      return;
    }
    setBusyLabel(isCreating ? 'Creating bank...' : 'Saving bank...');
    setPageError(null);
    try {
      await runWriteAction(async (overrideToken) => {
        const payload = {
          name: editorName,
          description: editorDescription,
          questions: prompts,
          changeSummary: isCreating ? 'Created manually' : 'Manual edit',
          overrideToken,
        };
        const result = isCreating
          ? await createAdminQuestionBank(adminToken!, payload)
          : await updateAdminQuestionBank(adminToken!, selectedDetail!.id, payload);
        setSelectedDetail(result.detail);
        setSelectedBankId(result.detail.id);
        setIsCreating(false);
        await refreshBanks();
      });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not save bank');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleCopy = async () => {
    if (!selectedDetail) {
      return;
    }
    setBusyLabel('Copying bank...');
    setPageError(null);
    try {
      await runWriteAction(async (overrideToken) => {
        const result = await copyAdminQuestionBank(adminToken!, selectedDetail.id, { overrideToken });
        setSelectedDetail(result.detail);
        setSelectedBankId(result.detail.id);
        setIsCreating(false);
        setEditorName(result.detail.bank.name);
        setEditorDescription(result.detail.description);
        setEditorText(promptsToEditorText(result.detail.bank.questions.map((question) => question.prompt)));
        await refreshBanks();
      });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not copy bank');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleExport = () => {
    const detail = selectedDetail;
    if (!detail) {
      return;
    }
    triggerCsvDownload(`${detail.bank.name.replace(/\s+/g, '_')}.csv`, createCsvContent(detail));
  };

  const handleImportFile = async (file: File) => {
    setBusyLabel('Parsing import...');
    setPageError(null);
    try {
      const lowerName = file.name.toLowerCase();
      const result = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
        ? await parseSpreadsheetFile(file)
        : { prompts: await parseCsvFile(file), note: 'Imported from CSV' };
      if (!result.prompts.length) {
        throw new Error('No prompts were found in the uploaded file');
      }
      setImportPrompts(result.prompts);
      setImportNote(`${result.note}. ${result.prompts.length} prompt(s) ready.`);
    } catch (cause) {
      setImportPrompts([]);
      setImportNote(null);
      setPageError(cause instanceof Error ? cause.message : 'Could not parse the uploaded file');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleImportIntoEditor = (mode: 'append' | 'overwrite') => {
    if (!importPrompts.length) {
      return;
    }
    const existing = editorTextToPrompts(editorText);
    const nextPrompts = mode === 'overwrite' ? importPrompts : [...existing, ...importPrompts];
    if (!editorName.trim()) {
      setEditorName(selectedDetail?.bank.name ? `${selectedDetail.bank.name} (Copy)` : 'Imported Bank');
    }
    setIsCreating(true);
    setSelectedBankId(null);
    setSelectedDetail(null);
    setEditorText(promptsToEditorText(nextPrompts));
  };

  const handleImportIntoBank = async (mode: 'append' | 'overwrite') => {
    if (!selectedDetail || selectedDetail.readOnly || !importPrompts.length) {
      return;
    }
    setBusyLabel(mode === 'append' ? 'Appending import...' : 'Overwriting bank...');
    setPageError(null);
    try {
      await runWriteAction(async (overrideToken) => {
        const result = await importAdminQuestionBank(adminToken!, selectedDetail.id, {
          name: selectedDetail.bank.name,
          description: selectedDetail.description,
          questions: importPrompts,
          mode,
          overrideToken,
        });
        setSelectedDetail(result.detail);
        setEditorName(result.detail.bank.name);
        setEditorDescription(result.detail.description);
        setEditorText(promptsToEditorText(result.detail.bank.questions.map((question) => question.prompt)));
        setImportPrompts([]);
        setImportNote(null);
        await refreshBanks();
      });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not import into bank');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleRestoreRevision = async (revision: number) => {
    if (!selectedDetail || selectedDetail.readOnly) {
      return;
    }
    setBusyLabel(`Restoring revision ${revision}...`);
    setPageError(null);
    try {
      await runWriteAction(async (overrideToken) => {
        const result = await restoreAdminQuestionBankRevision(adminToken!, selectedDetail.id, revision, { overrideToken });
        setSelectedDetail(result.detail);
        setEditorName(result.detail.bank.name);
        setEditorDescription(result.detail.description);
        setEditorText(promptsToEditorText(result.detail.bank.questions.map((question) => question.prompt)));
        await refreshBanks();
      });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not restore revision');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleOverrideSubmit = async () => {
    if (!overridePassword.trim()) {
      setOverrideError('Enter the admin password');
      return;
    }
    setOverrideLoading(true);
    setOverrideError(null);
    try {
      const result = await adminReauthorize(overridePassword.trim());
      saveOverrideToken(result.token);
      setOverrideOpen(false);
      const pending = pendingWriteRef.current;
      pendingWriteRef.current = null;
      if (pending) {
        await pending();
      }
    } catch (cause) {
      setOverrideError(cause instanceof Error ? cause.message : 'Override failed');
    } finally {
      setOverrideLoading(false);
    }
  };

  return (
    <main className="page sheet">
      <section className="game-view admin-page">
        <header className="game-header admin-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>Question Banks</h2>
            <p className="footnote">Static repo banks are read-only. Use Make a copy to create an editable database version.</p>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void refreshBanks()} disabled={Boolean(busyLabel)}>
              Refresh
            </button>
            <button className="primary" onClick={startNewBank} disabled={Boolean(busyLabel)}>
              New DB Bank
            </button>
            <button className="ghost" onClick={handleExport} disabled={!selectedDetail}>
              Export CSV
            </button>
            <button
              className="ghost"
              onClick={() => {
                clearAdminToken();
                clearOverrideToken();
                navigate('/admin/login', { replace: true });
              }}
            >
              Log out
            </button>
          </div>
        </header>

        {usage?.warningMessage && <p className="warning-banner">{usage.warningMessage}</p>}
        {pageError && <p className="error">{pageError}</p>}
        {busyLabel && <p className="status">{busyLabel}</p>}

        <div className="admin-grid">
          <section className="card admin-sidebar">
            <h3>Banks</h3>
            <div className="bank-list">
              {banks.map((bank) => (
                <button
                  key={bank.id}
                  type="button"
                  className={`bank-row ${selectedBankId === bank.id && !isCreating ? 'active' : ''}`}
                  onClick={() => setSelectedBankId(bank.id)}
                >
                  <span>{bank.name}</span>
                  <span className="bank-meta">{bank.readOnly ? 'Static' : `DB v${bank.version}`}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card admin-editor">
            <h3>{isCreating ? 'Create DB Bank' : selectedDetail?.readOnly ? 'Read-only Bank' : 'Edit DB Bank'}</h3>
            <div className="stack">
              <label className="field">
                <span>Name</span>
                <input
                  className="input"
                  value={editorName}
                  onChange={(event) => setEditorName(event.target.value)}
                  disabled={Boolean(selectedDetail?.readOnly && !isCreating)}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  className="input multiline-input"
                  value={editorDescription}
                  onChange={(event) => setEditorDescription(event.target.value)}
                  disabled={Boolean(selectedDetail?.readOnly && !isCreating)}
                />
              </label>
              <label className="field">
                <span>Questions (one prompt per line)</span>
                <textarea
                  className="input multiline-input tall-input"
                  value={editorText}
                  onChange={(event) => setEditorText(event.target.value)}
                  disabled={Boolean(selectedDetail?.readOnly && !isCreating)}
                />
              </label>
              <p className="footnote">{editorPromptCount} prompt(s) in the editor.</p>
              <div className="button-row">
                {!selectedDetail?.readOnly || isCreating ? (
                  <button className="primary" onClick={() => void handleSave()} disabled={Boolean(busyLabel)}>
                    {isCreating ? 'Create Bank' : 'Save Changes'}
                  </button>
                ) : null}
                {selectedDetail && (
                  <button className="secondary" onClick={() => void handleCopy()} disabled={Boolean(busyLabel)}>
                    Make a Copy
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="card admin-usage">
            <h3>Usage</h3>
            {usage ? (
              <div className="usage-grid">
                <p>DO duration est.: {usage.counters.estimatedDoDurationGbSecondsToday} / 13000 GB-s</p>
                <p>D1 rows read: {usage.counters.d1RowsReadToday} / 5000000</p>
                <p>D1 rows written: {usage.counters.d1RowsWrittenToday} / 100000</p>
                <p>Game creates: {usage.counters.gameCreatesToday}</p>
                <p>Active lobbies: {usage.counters.activeLobbies}</p>
                <p>Active games: {usage.counters.activeGames}</p>
                <p>Connected players: {usage.counters.connectedPlayersNow}</p>
                <p>Admin writes: {usage.counters.adminWritesToday}</p>
              </div>
            ) : (
              <p className="footnote">Usage data is loading.</p>
            )}
          </section>
        </div>

        <section className="card admin-import">
          <h3>Import</h3>
          <p className="footnote">CSV is supported. Excel uses the first worksheet only.</p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImportFile(file);
              }
            }}
          />
          {importNote && <p className="footnote">{importNote}</p>}
          {importPrompts.length > 0 && (
            <div className="button-row">
              {isEditingDbBank ? (
                <>
                  <button className="secondary" onClick={() => void handleImportIntoBank('append')} disabled={Boolean(busyLabel)}>
                    Append to Bank
                  </button>
                  <button className="primary" onClick={() => void handleImportIntoBank('overwrite')} disabled={Boolean(busyLabel)}>
                    Overwrite Bank
                  </button>
                </>
              ) : (
                <>
                  <button className="secondary" onClick={() => handleImportIntoEditor('append')} disabled={Boolean(busyLabel)}>
                    Append in Editor
                  </button>
                  <button className="primary" onClick={() => handleImportIntoEditor('overwrite')} disabled={Boolean(busyLabel)}>
                    Replace Editor
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {selectedDetail && !selectedDetail.readOnly && selectedDetail.revisions.length > 0 && (
          <section className="card admin-revisions">
            <h3>Revisions</h3>
            <div className="revision-list">
              {selectedDetail.revisions.map((revision) => (
                <div key={revision.revision} className="revision-row">
                  <div>
                    <p>Revision {revision.revision}</p>
                    <p className="footnote">{new Date(revision.createdAt).toLocaleString()} - {revision.questionCount} prompt(s)</p>
                    {revision.changeSummary && <p className="footnote">{revision.changeSummary}</p>}
                  </div>
                  <button className="secondary" onClick={() => void handleRestoreRevision(revision.revision)} disabled={Boolean(busyLabel)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>

      {overrideOpen && (
        <PasswordPromptDialog
          title="Override Needed"
          message="Free-tier usage is near the configured limit. Enter the admin password to continue in this tab."
          password={overridePassword}
          loading={overrideLoading}
          error={overrideError}
          confirmLabel="Unlock"
          onPasswordChange={setOverridePassword}
          onSubmit={handleOverrideSubmit}
          onClose={() => {
            pendingWriteRef.current = null;
            setOverrideOpen(false);
          }}
        />
      )}
    </main>
  );
}
