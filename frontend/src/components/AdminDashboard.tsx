import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  adminReauthorize,
  ApiError,
  copyAdminQuestionBank,
  createAdminQuestionBank,
  fetchAdminQuestionBankDetail,
  fetchAdminQuestionBanks,
  fetchAdminUsageStatus,
  restoreAdminQuestionBankRevision,
  updateAdminQuestionBank,
} from '../api';
import { clearAdminToken, clearOverrideToken, loadAdminToken, loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import type { AdminQuestionBankDetail, QuestionBankCatalogItem, UsageStatus } from '../lib/types';
import PasswordPromptDialog from './PasswordPromptDialog';

type AdminTheme = 'serious' | 'retro';
type AdminTab = 'edit' | 'create' | 'usage';
type EditorMode = 'dynamic' | 'text';
type DraftKey = 'edit' | 'create';
type ImportTarget = 'edit' | 'create';

interface EditorQuestionRow {
  id: string;
  prompt: string;
}

interface BankDraft {
  name: string;
  description: string;
  text: string;
  rows: EditorQuestionRow[];
}

type PendingAction =
  | { type: 'switch-tab'; nextTab: AdminTab }
  | { type: 'select-bank'; bankId: string }
  | { type: 'logout' };

interface UnsavedDialogState {
  draftKey: DraftKey;
  title: string;
  message: string;
}

interface ImportDialogState {
  open: boolean;
  target: ImportTarget;
  prompts: string[];
  note: string | null;
  error: string | null;
  parsing: boolean;
}

function createEditorRow(prompt = ''): EditorQuestionRow {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, prompt };
}

function makeDraft(name = '', description = '', prompts: string[] = []): BankDraft {
  return {
    name,
    description,
    text: prompts.join('\n'),
    rows: prompts.length > 0 ? prompts.map((prompt) => createEditorRow(prompt)) : [createEditorRow('')],
  };
}

function normalizePromptLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizePromptRows(rows: EditorQuestionRow[]): string[] {
  return rows.map((row) => row.prompt.trim()).filter(Boolean);
}

function getDraftPrompts(draft: BankDraft): string[] {
  return normalizePromptRows(draft.rows);
}

function setDraftPrompts(draft: BankDraft, prompts: string[]): BankDraft {
  return {
    ...draft,
    text: prompts.join('\n'),
    rows: prompts.length > 0 ? prompts.map((prompt) => createEditorRow(prompt)) : [createEditorRow('')],
  };
}

function syncDraftText(draft: BankDraft, text: string): BankDraft {
  const prompts = normalizePromptLines(text);
  return {
    ...draft,
    text,
    rows: prompts.length > 0 ? prompts.map((prompt) => createEditorRow(prompt)) : [createEditorRow('')],
  };
}

function syncDraftRows(draft: BankDraft, rows: EditorQuestionRow[]): BankDraft {
  const normalizedRows = rows.length > 0 ? rows : [createEditorRow('')];
  return {
    ...draft,
    rows: normalizedRows,
    text: normalizePromptRows(normalizedRows).join('\n'),
  };
}

function createCsvContent(prompts: string[]): string {
  const rows = ['question_id,prompt'];
  prompts.forEach((prompt, index) => {
    const escaped = `"${prompt.replace(/"/g, '""')}"`;
    rows.push(`q${String(index + 1).padStart(3, '0')},${escaped}`);
  });
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

function arePromptListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((prompt, index) => prompt === right[index]);
}

function isDraftBlank(draft: BankDraft): boolean {
  return !draft.name.trim() && !draft.description.trim() && getDraftPrompts(draft).length === 0;
}

function isEditDraftDirty(detail: AdminQuestionBankDetail | null, draft: BankDraft): boolean {
  if (!detail) {
    return false;
  }
  return (
    draft.name.trim() !== detail.bank.name.trim() ||
    draft.description.trim() !== detail.description.trim() ||
    !arePromptListsEqual(getDraftPrompts(draft), detail.bank.questions.map((question) => question.prompt))
  );
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

function AdminToggleGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="admin-toggle-group">
      <span className="admin-toggle-label">{label}</span>
      <div className="admin-toggle-set">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`admin-toggle-chip ${value === option.value ? 'active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortableQuestionRow({
  row,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  row: EditorQuestionRow;
  index: number;
  disabled: boolean;
  onChange: (id: string, prompt: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`question-row-editor ${isDragging ? 'dragging' : ''}`}
    >
      <button
        type="button"
        className="question-row-grip"
        aria-label={`Move question ${index + 1}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        ::
      </button>
      <span className="question-row-index">{index + 1}</span>
      <textarea
        className="input question-row-input"
        value={row.prompt}
        onChange={(event) => onChange(row.id, event.target.value)}
        disabled={disabled}
        rows={Math.max(2, Math.min(6, row.prompt.split(/\r?\n/).length))}
        placeholder="Question prompt"
      />
      <button type="button" className="ghost question-row-remove" onClick={() => onRemove(row.id)} disabled={disabled}>
        Remove
      </button>
    </div>
  );
}

function UnsavedChangesDialog({
  title,
  message,
  loading,
  onSave,
  onCancel,
  onDiscard,
}: {
  title: string;
  message: string;
  loading: boolean;
  onSave: () => Promise<unknown> | void;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="invite-card">
        <div className="invite-header">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onCancel} aria-label="Close unsaved changes dialog">
            X
          </button>
        </div>
        <p className="footnote">{message}</p>
        <div className="button-row">
          <button type="button" className="primary" onClick={() => void onSave()} disabled={loading}>
            {loading ? 'Saving...' : 'Save and continue'}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={loading}>
            Keep editing
          </button>
          <button type="button" className="ghost" onClick={onDiscard} disabled={loading}>
            Discard and continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({
  state,
  onFileSelected,
  onApply,
  onClose,
}: {
  state: ImportDialogState;
  onFileSelected: (file: File) => Promise<void>;
  onApply: (mode: 'append' | 'overwrite') => void;
  onClose: () => void;
}) {
  const targetLabel = state.target === 'edit' ? 'current edit draft' : 'new bank draft';

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="invite-card admin-modal-card">
        <div className="invite-header">
          <h3>Import Questions</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close import dialog">
            X
          </button>
        </div>
        <p className="footnote">Upload CSV or Excel. Excel imports the first worksheet only.</p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void onFileSelected(file);
            }
          }}
        />
        {state.parsing && <p className="status">Parsing import...</p>}
        {state.error && <p className="error">{state.error}</p>}
        {state.note && <p className="footnote">{state.note}</p>}
        {state.prompts.length > 0 && (
          <>
            <p className="footnote">{state.prompts.length} prompt(s) ready for {targetLabel}.</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => onApply('append')} disabled={state.parsing}>
                Append
              </button>
              <button type="button" className="primary" onClick={() => onApply('overwrite')} disabled={state.parsing}>
                Overwrite
              </button>
              <button type="button" className="ghost" onClick={onClose} disabled={state.parsing}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [adminToken, setAdminToken] = useState<string | null>(() => loadAdminToken());
  const [banks, setBanks] = useState<QuestionBankCatalogItem[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AdminQuestionBankDetail | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('edit');
  const [adminTheme, setAdminTheme] = useState<AdminTheme>(() => {
    if (typeof window === 'undefined') {
      return 'serious';
    }
    return window.localStorage.getItem('top10-admin-theme') === 'retro' ? 'retro' : 'serious';
  });
  const [editorMode, setEditorMode] = useState<EditorMode>('dynamic');
  const [editDraft, setEditDraft] = useState<BankDraft>(() => makeDraft());
  const [createDraft, setCreateDraft] = useState<BankDraft>(() => makeDraft());
  const [unsavedDialog, setUnsavedDialog] = useState<UnsavedDialogState | null>(null);
  const [unsavedSaving, setUnsavedSaving] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePassword, setOverridePassword] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [importDialog, setImportDialog] = useState<ImportDialogState>({
    open: false,
    target: 'edit',
    prompts: [],
    note: null,
    error: null,
    parsing: false,
  });
  const pendingWriteRef = useRef<(() => Promise<void>) | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);

  const editIsReadOnly = Boolean(selectedDetail?.readOnly);
  const editPrompts = getDraftPrompts(editDraft);
  const createPrompts = getDraftPrompts(createDraft);
  const editDirty = isEditDraftDirty(selectedDetail, editDraft);
  const createDirty = !isDraftBlank(createDraft);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('top10-admin-theme', adminTheme);
    }
  }, [adminTheme]);

  useEffect(() => {
    const hasUnsaved = editDirty || createDirty;
    if (!hasUnsaved || typeof window === 'undefined') {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [createDirty, editDirty]);

  const handleUnauthorized = useCallback(() => {
    clearAdminToken();
    clearOverrideToken();
    setAdminToken(null);
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const refreshAll = useCallback(async (preserveSelection = true) => {
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
      if (preserveSelection && selectedBankId && !bankResult.banks.some((bank) => bank.id === selectedBankId)) {
        setSelectedBankId(bankResult.banks[0]?.id ?? null);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'UNAUTHORIZED') {
        handleUnauthorized();
        return;
      }
      setPageError(cause instanceof Error ? cause.message : 'Could not load admin data');
    }
  }, [adminToken, handleUnauthorized, selectedBankId]);

  const loadBankDetail = useCallback(async (bankId: string) => {
    if (!adminToken) {
      return;
    }
    setBusyLabel('Loading bank...');
    setPageError(null);
    try {
      const result = await fetchAdminQuestionBankDetail(adminToken, bankId);
      const prompts = result.detail.bank.questions.map((question) => question.prompt);
      setSelectedDetail(result.detail);
      setSelectedBankId(bankId);
      setEditDraft(makeDraft(result.detail.bank.name, result.detail.description, prompts));
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
    void refreshAll(false);
  }, [adminToken, navigate, refreshAll]);

  useEffect(() => {
    if (selectedBankId) {
      void loadBankDetail(selectedBankId);
    }
  }, [selectedBankId, loadBankDetail]);

  const applyPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedDialog(null);
    if (!action) {
      return;
    }
    if (action.type === 'switch-tab') {
      setActiveTab(action.nextTab);
      return;
    }
    if (action.type === 'select-bank') {
      setSelectedBankId(action.bankId);
      return;
    }
    clearAdminToken();
    clearOverrideToken();
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const discardDraft = useCallback((draftKey: DraftKey) => {
    if (draftKey === 'create') {
      setCreateDraft(makeDraft());
      return;
    }
    if (selectedDetail) {
      setEditDraft(makeDraft(selectedDetail.bank.name, selectedDetail.description, selectedDetail.bank.questions.map((question) => question.prompt)));
    }
  }, [selectedDetail]);

  const beginGuardedAction = useCallback((action: PendingAction) => {
    if (activeTab === 'create' && createDirty) {
      pendingActionRef.current = action;
      setUnsavedDialog({
        draftKey: 'create',
        title: 'Unsaved new bank',
        message: 'You have unsaved changes in the create tab. Save them, keep editing, or discard them before continuing.',
      });
      return;
    }
    if (activeTab === 'edit' && editDirty) {
      pendingActionRef.current = action;
      setUnsavedDialog({
        draftKey: 'edit',
        title: 'Unsaved changes',
        message: 'You have unsaved edits in the current bank. Save them, keep editing, or discard them before continuing.',
      });
      return;
    }
    pendingActionRef.current = action;
    applyPendingAction();
  }, [activeTab, applyPendingAction, createDirty, editDirty]);

  const openOverrideModal = (action: () => Promise<void>) => {
    pendingWriteRef.current = action;
    setOverridePassword('');
    setOverrideError(null);
    setOverrideOpen(true);
  };

  const runWriteAction = useCallback(async (action: (overrideToken: string | null) => Promise<void>) => {
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
  }, [handleUnauthorized]);

  const saveEditDraft = useCallback(async (): Promise<boolean> => {
    if (!selectedDetail || selectedDetail.readOnly) {
      return false;
    }
    const prompts = getDraftPrompts(editDraft);
    if (!prompts.length) {
      setPageError('Enter at least one question');
      return false;
    }
    setBusyLabel('Saving bank...');
    setPageError(null);
    try {
      let saved = false;
      await runWriteAction(async (overrideToken) => {
        const result = await updateAdminQuestionBank(adminToken!, selectedDetail.id, {
          name: editDraft.name,
          description: editDraft.description,
          questions: prompts,
          changeSummary: 'Manual edit',
          overrideToken,
        });
        const nextPrompts = result.detail.bank.questions.map((question) => question.prompt);
        setSelectedDetail(result.detail);
        setEditDraft(makeDraft(result.detail.bank.name, result.detail.description, nextPrompts));
        await refreshAll();
        saved = true;
      });
      return saved;
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not save bank');
      return false;
    } finally {
      setBusyLabel(null);
    }
  }, [adminToken, editDraft, refreshAll, runWriteAction, selectedDetail]);

  const saveCreateDraft = useCallback(async (): Promise<boolean> => {
    const prompts = getDraftPrompts(createDraft);
    if (!prompts.length) {
      setPageError('Enter at least one question');
      return false;
    }
    setBusyLabel('Creating bank...');
    setPageError(null);
    try {
      let created = false;
      await runWriteAction(async (overrideToken) => {
        const result = await createAdminQuestionBank(adminToken!, {
          name: createDraft.name,
          description: createDraft.description,
          questions: prompts,
          changeSummary: 'Created manually',
          overrideToken,
        });
        const nextPrompts = result.detail.bank.questions.map((question) => question.prompt);
        setSelectedDetail(result.detail);
        setSelectedBankId(result.detail.id);
        setEditDraft(makeDraft(result.detail.bank.name, result.detail.description, nextPrompts));
        setCreateDraft(makeDraft());
        await refreshAll();
        created = true;
      });
      return created;
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not create bank');
      return false;
    } finally {
      setBusyLabel(null);
    }
  }, [adminToken, createDraft, refreshAll, runWriteAction]);

  const handleUnsavedSave = async () => {
    if (!unsavedDialog) {
      return;
    }
    setUnsavedSaving(true);
    const success = unsavedDialog.draftKey === 'edit' ? await saveEditDraft() : await saveCreateDraft();
    setUnsavedSaving(false);
    if (!success) {
      return;
    }
    applyPendingAction();
  };

  const handleUnsavedDiscard = () => {
    if (!unsavedDialog) {
      return;
    }
    discardDraft(unsavedDialog.draftKey);
    applyPendingAction();
  };

  const handleTabSwitch = (nextTab: AdminTab) => {
    if (nextTab === activeTab) {
      return;
    }
    beginGuardedAction({ type: 'switch-tab', nextTab });
  };

  const handleBankSelection = (nextBankId: string) => {
    if (!nextBankId || nextBankId === selectedBankId) {
      return;
    }
    beginGuardedAction({ type: 'select-bank', bankId: nextBankId });
  };

  const handleLogout = () => {
    beginGuardedAction({ type: 'logout' });
  };

  const handleEditTextChange = (value: string) => {
    setEditDraft((current) => syncDraftText(current, value));
  };

  const handleCreateTextChange = (value: string) => {
    setCreateDraft((current) => syncDraftText(current, value));
  };

  const handleRowChange = (draftKey: DraftKey, rowId: string, prompt: string) => {
    const updater = (current: BankDraft) =>
      syncDraftRows(
        current,
        current.rows.map((row) => (row.id === rowId ? { ...row, prompt } : row))
      );
    if (draftKey === 'edit') {
      setEditDraft(updater);
    } else {
      setCreateDraft(updater);
    }
  };

  const handleRowRemove = (draftKey: DraftKey, rowId: string) => {
    const updater = (current: BankDraft) =>
      syncDraftRows(
        current,
        current.rows.filter((row) => row.id !== rowId)
      );
    if (draftKey === 'edit') {
      setEditDraft(updater);
    } else {
      setCreateDraft(updater);
    }
  };

  const handleRowAdd = (draftKey: DraftKey) => {
    const updater = (current: BankDraft) => syncDraftRows(current, [...current.rows, createEditorRow('')]);
    if (draftKey === 'edit') {
      setEditDraft(updater);
    } else {
      setCreateDraft(updater);
    }
  };

  const handleDynamicDragEnd = (draftKey: DraftKey, event: DragEndEvent) => {
    const draft = draftKey === 'edit' ? editDraft : createDraft;
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = draft.rows.findIndex((row) => row.id === active.id);
    const newIndex = draft.rows.findIndex((row) => row.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    const nextDraft = syncDraftRows(draft, arrayMove(draft.rows, oldIndex, newIndex));
    if (draftKey === 'edit') {
      setEditDraft(nextDraft);
    } else {
      setCreateDraft(nextDraft);
    }
  };

  const openImportDialog = (target: ImportTarget) => {
    setImportDialog({
      open: true,
      target,
      prompts: [],
      note: null,
      error: null,
      parsing: false,
    });
  };

  const handleImportFile = async (file: File) => {
    setImportDialog((current) => ({ ...current, parsing: true, error: null }));
    try {
      const lowerName = file.name.toLowerCase();
      const result = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
        ? await parseSpreadsheetFile(file)
        : { prompts: await parseCsvFile(file), note: 'Imported from CSV' };
      if (!result.prompts.length) {
        throw new Error('No prompts were found in the uploaded file');
      }
      setImportDialog((current) => ({
        ...current,
        parsing: false,
        prompts: result.prompts,
        note: `${result.note}. ${result.prompts.length} prompt(s) ready.`,
        error: null,
      }));
    } catch (cause) {
      setImportDialog((current) => ({
        ...current,
        parsing: false,
        prompts: [],
        note: null,
        error: cause instanceof Error ? cause.message : 'Could not parse the uploaded file',
      }));
    }
  };

  const applyImportToDraft = (mode: 'append' | 'overwrite') => {
    if (!importDialog.prompts.length) {
      return;
    }
    const setter = importDialog.target === 'edit' ? setEditDraft : setCreateDraft;
    setter((current) => {
      const nextPrompts =
        mode === 'overwrite' ? importDialog.prompts : [...getDraftPrompts(current), ...importDialog.prompts];
      return setDraftPrompts(current, nextPrompts);
    });
    setImportDialog({
      open: false,
      target: importDialog.target,
      prompts: [],
      note: null,
      error: null,
      parsing: false,
    });
  };

  const handleExportDraft = (draftKey: DraftKey) => {
    const draft = draftKey === 'edit' ? editDraft : createDraft;
    const prompts = getDraftPrompts(draft);
    if (!prompts.length) {
      setPageError('There is nothing to export yet');
      return;
    }
    const baseName = draft.name.trim() || (draftKey === 'edit' ? 'question_bank' : 'new_bank');
    triggerCsvDownload(`${baseName.replace(/\s+/g, '_')}.csv`, createCsvContent(prompts));
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
        const prompts = result.detail.bank.questions.map((question) => question.prompt);
        setSelectedDetail(result.detail);
        setSelectedBankId(result.detail.id);
        setEditDraft(makeDraft(result.detail.bank.name, result.detail.description, prompts));
        await refreshAll();
      });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'Could not copy bank');
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
        const prompts = result.detail.bank.questions.map((question) => question.prompt);
        setSelectedDetail(result.detail);
        setEditDraft(makeDraft(result.detail.bank.name, result.detail.description, prompts));
        await refreshAll();
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

  const renderDraftEditor = (
    draftKey: DraftKey,
    draft: BankDraft,
    options: {
      readOnly?: boolean;
      title: string;
      count: number;
      importEnabled: boolean;
      saveLabel: string;
      onSave: () => Promise<unknown> | void;
      onNameChange: (value: string) => void;
      onDescriptionChange: (value: string) => void;
      onTextChange: (value: string) => void;
      onImport: () => void;
      onExport: () => void;
      extraActions?: React.ReactNode;
      footnote: string;
    }
  ) => (
    <section className="card admin-panel">
      <div className="admin-panel-head">
        <div>
          <h3>{options.title}</h3>
          <p className="footnote">{options.footnote}</p>
        </div>
        <p className="admin-editor-count">{options.count} prompt(s)</p>
      </div>

      <div className="admin-form-actions">
        <button type="button" className="secondary" onClick={options.onImport} disabled={!options.importEnabled}>
          Import
        </button>
        <button type="button" className="secondary" onClick={options.onExport}>
          Export CSV
        </button>
        {options.extraActions}
        {!options.readOnly && (
          <button type="button" className="primary" onClick={() => void options.onSave()} disabled={Boolean(busyLabel)}>
            {options.saveLabel}
          </button>
        )}
      </div>

      <div className="stack">
        <label className="field">
          <span>Name</span>
          <input className="input" value={draft.name} onChange={(event) => options.onNameChange(event.target.value)} disabled={Boolean(options.readOnly)} />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            className="input multiline-input"
            value={draft.description}
            onChange={(event) => options.onDescriptionChange(event.target.value)}
            disabled={Boolean(options.readOnly)}
          />
        </label>

        {editorMode === 'text' ? (
          <label className="field">
            <span>Questions</span>
            <textarea
              className="input multiline-input admin-question-textarea"
              value={draft.text}
              onChange={(event) => options.onTextChange(event.target.value)}
              disabled={Boolean(options.readOnly)}
            />
          </label>
        ) : (
          <div className="field">
            <span>Questions</span>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDynamicDragEnd(draftKey, event)}>
              <SortableContext items={draft.rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
                <div className="question-editor-dynamic">
                  {draft.rows.map((row, index) => (
                    <SortableQuestionRow
                      key={row.id}
                      row={row}
                      index={index}
                      disabled={Boolean(options.readOnly)}
                      onChange={(rowId, prompt) => handleRowChange(draftKey, rowId, prompt)}
                      onRemove={(rowId) => handleRowRemove(draftKey, rowId)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {!options.readOnly && (
              <div className="question-editor-footer">
                <button type="button" className="secondary" onClick={() => handleRowAdd(draftKey)}>
                  Add Question
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <main className={`page sheet admin-shell-page admin-theme-${adminTheme}`}>
      <section className="game-view admin-page">
        <div className="admin-toolbar">
          <AdminToggleGroup
            label="Style"
            value={adminTheme}
            onChange={(value) => setAdminTheme(value === 'retro' ? 'retro' : 'serious')}
            options={[
              { value: 'serious', label: 'Serious' },
              { value: 'retro', label: 'Retro' },
            ]}
          />
          <AdminToggleGroup
            label="Editor"
            value={editorMode}
            onChange={(value) => setEditorMode(value === 'text' ? 'text' : 'dynamic')}
            options={[
              { value: 'dynamic', label: 'Dynamic' },
              { value: 'text', label: 'Text' },
            ]}
          />
        </div>

        <header className="game-header admin-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>Question Bank Manager</h2>
            <p className="footnote">Static repo banks are read-only. Copy one into the database if you want to change it.</p>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void refreshAll()} disabled={Boolean(busyLabel)}>
              Refresh
            </button>
            <button className="ghost" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        <div className="admin-tabbar">
          <button type="button" className={`admin-tab ${activeTab === 'edit' ? 'active' : ''}`} onClick={() => handleTabSwitch('edit')}>
            Edit database
          </button>
          <button type="button" className={`admin-tab ${activeTab === 'create' ? 'active' : ''}`} onClick={() => handleTabSwitch('create')}>
            Create new database
          </button>
          <button type="button" className={`admin-tab ${activeTab === 'usage' ? 'active' : ''}`} onClick={() => handleTabSwitch('usage')}>
            Usage
          </button>
        </div>

        {usage?.warningMessage && <p className="warning-banner">{usage.warningMessage}</p>}
        {pageError && <p className="error">{pageError}</p>}
        {busyLabel && <p className="status">{busyLabel}</p>}

        {activeTab === 'edit' && (
          <div className="admin-tab-panel">
            <section className="card admin-panel">
              <label className="field">
                <span>Select bank</span>
                <select className="input" value={selectedBankId ?? ''} onChange={(event) => handleBankSelection(event.target.value)}>
                  <option value="" disabled>
                    Select a bank
                  </option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name} {bank.readOnly ? '(Static / Read only)' : '(Database editable)'}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {selectedDetail &&
              renderDraftEditor('edit', editDraft, {
                readOnly: editIsReadOnly,
                title: editIsReadOnly ? 'View bank' : 'Edit bank',
                count: editPrompts.length,
                importEnabled: !editIsReadOnly,
                saveLabel: 'Save changes',
                onSave: saveEditDraft,
                onNameChange: (value) => setEditDraft((current) => ({ ...current, name: value })),
                onDescriptionChange: (value) => setEditDraft((current) => ({ ...current, description: value })),
                onTextChange: handleEditTextChange,
                onImport: () => openImportDialog('edit'),
                onExport: () => handleExportDraft('edit'),
                extraActions: (
                  <button type="button" className="secondary" onClick={() => void handleCopy()} disabled={Boolean(busyLabel)}>
                    Make a copy
                  </button>
                ),
                footnote: editIsReadOnly
                  ? 'This bank comes from the repo and cannot be edited directly.'
                  : 'Changes stay local until you save them.',
              })}

            {selectedDetail && !selectedDetail.readOnly && selectedDetail.revisions.length > 0 && (
              <section className="card admin-panel admin-revisions">
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
          </div>
        )}

        {activeTab === 'create' && (
          <div className="admin-tab-panel">
            {renderDraftEditor('create', createDraft, {
              title: 'Create a new database bank',
              count: createPrompts.length,
              importEnabled: true,
              saveLabel: 'Create bank',
              onSave: async () => {
                const created = await saveCreateDraft();
                if (created) {
                  setActiveTab('edit');
                }
              },
              onNameChange: (value) => setCreateDraft((current) => ({ ...current, name: value })),
              onDescriptionChange: (value) => setCreateDraft((current) => ({ ...current, description: value })),
              onTextChange: handleCreateTextChange,
              onImport: () => openImportDialog('create'),
              onExport: () => handleExportDraft('create'),
              footnote: 'Build a bank locally, import into it if you want, then create it once it looks right.',
            })}
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="admin-tab-panel">
            <section className="card admin-panel">
              <h3>Usage overview</h3>
              {usage ? (
                <div className="admin-usage-grid">
                  <div className="admin-usage-card">
                    <span className="bank-meta">Estimated DO duration</span>
                    <strong>{usage.counters.estimatedDoDurationGbSecondsToday} / 13000 GB-s</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">D1 rows read</span>
                    <strong>{usage.counters.d1RowsReadToday} / 5000000</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">D1 rows written</span>
                    <strong>{usage.counters.d1RowsWrittenToday} / 100000</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">Game creates</span>
                    <strong>{usage.counters.gameCreatesToday}</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">Active lobbies</span>
                    <strong>{usage.counters.activeLobbies}</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">Active games</span>
                    <strong>{usage.counters.activeGames}</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">Connected players</span>
                    <strong>{usage.counters.connectedPlayersNow}</strong>
                  </div>
                  <div className="admin-usage-card">
                    <span className="bank-meta">Admin writes</span>
                    <strong>{usage.counters.adminWritesToday}</strong>
                  </div>
                </div>
              ) : (
                <p className="footnote">Usage data is loading.</p>
              )}
            </section>
          </div>
        )}
      </section>

      {importDialog.open && (
        <ImportDialog
          state={importDialog}
          onFileSelected={handleImportFile}
          onApply={applyImportToDraft}
          onClose={() =>
            setImportDialog((current) => ({
              ...current,
              open: false,
              prompts: [],
              note: null,
              error: null,
              parsing: false,
            }))
          }
        />
      )}

      {unsavedDialog && (
        <UnsavedChangesDialog
          title={unsavedDialog.title}
          message={unsavedDialog.message}
          loading={unsavedSaving}
          onSave={handleUnsavedSave}
          onCancel={() => {
            pendingActionRef.current = null;
            setUnsavedDialog(null);
          }}
          onDiscard={handleUnsavedDiscard}
        />
      )}

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
