/**
 * MatterDetailView — Matter detail view for DemandPay Starling.
 *
 * Displays matter header with status badge, fact row, and five tabs:
 * Issues Found, Documents, Draft, Timeline, Notes.
 *
 * Context-sensitive action bar at the bottom changes based on matter state.
 * All demo data matches the Smith v Acme Corp scenario.
 *
 * Ontario employment law vocabulary (ESA, Bardal, Waksdale, HRTO).
 * Canadian spelling throughout (analyse, licenced).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMatterDetail, useEmploymentData, useFirmTemplates, useApprovalsEnabled } from './hooks/useStarlingApi.js';
import { ExtractionReviewPanel } from './ExtractionReviewPanel.js';
import { DocumentHtml } from './DocumentHtml.js';
import { StyleProfilePanel, useStyleProfiles } from './StyleProfilePanel.js';
import { CaseFileDropPanel } from './CaseFileDropPanel.js';
import { DocAnalysisPanel } from './DocAnalysisPanel.js';
import { QuestionnairePanel } from './QuestionnairePanel.js';
import { PrecedentAlignPanel } from './PrecedentAlignPanel.js';
import { RevisionPanel } from './RevisionPanel.js';
import type { SourceCitation, DocumentExtraction } from './hooks/useStarlingApi.js';
import { useUserProfile } from '../my-page/hooks/useUserProfile.js';
import { useLabourData } from './hooks/useLabourApi.js';
import LabourMatterDetailView from './LabourMatterDetailView.js';
import { GateApprovalPanel, IntakeEditorPanel, GeneratedDocsPanel, NextStepsPanel, CloseMatterPanel, CorrespondencePanel, ComparablesPanel, NegotiationPanel, NetSettlementPanel, DebriefPanel } from './shared.js';
import type { IntakeFieldDef } from './shared.js';
import { parseFileToText, isDocxFile, TEXT_UPLOAD_ACCEPT } from './shared.js';
// stepMapping.js exports (SOURCE_TAGS, SEVERITY_CONFIG) available for future use with live API data

// Design tokens, shared shapes, and the pure presentational pieces now live in
// ./matter/ so this file can focus on the workspace behaviour.
import { navy, orange, cream, frame, green, amber, red, border, ink, muted, serif, sans } from './matter/tokens.js';
import type { Issue, DocItem, DraftType, TimelineEvent } from './matter/types.js';
import { triageFlag, TriagedFlags, StatusDot, SourceTag, MatterDetailTopBar, FactItem, DocRow, ActionButton, renderBoldText } from './matter/presentational.js';
import { ReviewLaneControls } from './matter/review-lane.js';
import { TimelineTab } from './matter/tabs/TimelineTab.js';
import { IntakeTab } from './matter/tabs/IntakeTab.js';
import { NotesTab } from './matter/tabs/NotesTab.js';
import { IssuesTab } from './matter/tabs/IssuesTab.js';
import { RebuttalOptions } from './matter/workspaces/RebuttalOptions.js';
import { DemandFiguresOptions } from './matter/workspaces/DemandFiguresOptions.js';
import { TimetablePackageOptions } from './matter/workspaces/TimetablePackageOptions.js';
import { TemplateStyleOptions } from './matter/workspaces/TemplateStyleOptions.js';
import { ReplyOptions } from './matter/workspaces/ReplyOptions.js';
import { SocPleadingOptions } from './matter/workspaces/SocPleadingOptions.js';
import { SocOutlinePanel } from './matter/workspaces/SocOutlinePanel.js';
import type { SocOutlineSectionUI } from './matter/workspaces/SocOutlinePanel.js';
import { DemandSourcesOptions } from './matter/workspaces/DemandSourcesOptions.js';
import { MediationSourcesOptions } from './matter/workspaces/MediationSourcesOptions.js';
import { SocPleadingLanguageOptions } from './matter/workspaces/SocPleadingLanguageOptions.js';
import { FactumArgumentOptions } from './matter/workspaces/FactumArgumentOptions.js';
import { FactumArgumentLanguageOptions } from './matter/workspaces/FactumArgumentLanguageOptions.js';
import { FactumOutlinePanel } from './matter/workspaces/FactumOutlinePanel.js';
import type { FactumOutlineSectionUI } from './matter/workspaces/FactumOutlinePanel.js';
import { MediationOutlinePanel } from './matter/workspaces/MediationOutlinePanel.js';
import type { MediationOutlineSectionUI } from './matter/workspaces/MediationOutlinePanel.js';
import { CourtFormOptions } from './matter/workspaces/CourtFormOptions.js';
import { ReadinessNotice } from './matter/workspaces/ReadinessNotice.js';
import { GenerationOptions } from './matter/workspaces/GenerationOptions.js';
import { ScheduleAOptions } from './matter/workspaces/ScheduleAOptions.js';

// ── Types ───────────────────────────────────────────────────────────────

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'intake' | 'client' | 'negotiation' | 'debrief' | 'notes';

import {
  DRAFT_SECTIONS,
  DEMO_DRAFT_TYPES,
  DRAFT_TO_DOCTYPE,
  COURT_FORM_FIELDS,
  DRAFT_TO_DOWNLOAD,
  DOCTYPE_TO_DRAFT,
  downloadSlugFor,
  PACKAGE_DOCS,
  DEMAND_SOURCE_KIND_LABELS,
  DRAFTS_NEEDING_AMOUNT,
} from './matter/constants.js';
import type {
  CourtFieldDef,
  DirectionInstructionUi,
  DirectionRecord,
  DirectionProposal,
} from './matter/constants.js';

// ── Component ───────────────────────────────────────────────────────────

export default function MatterDetailView() {
  // Lawyer/firm details from the Starling Profile — flow into generated documents
  const { profile } = useUserProfile();
  // A matter opened straight after creation lands on Documents, because the
  // next real step is adding the client's paperwork. The New Matter form no
  // longer takes uploads, so without this the lawyer is left on Issues with
  // nothing to act on and no hint where the documents go.
  const openedFresh = window.location.hash.includes('new=1');
  // A worklist action deep-links straight to its tab: ?goto=draft etc.
  const gotoParam = window.location.hash.match(/[?&]goto=([a-z]+)/)?.[1];
  const VALID_TABS: TabKey[] = ['issues', 'docs', 'draft', 'timeline', 'intake', 'client', 'negotiation', 'debrief', 'notes'];
  const gotoTab = gotoParam && (VALID_TABS as string[]).includes(gotoParam) ? gotoParam as TabKey : null;
  // Resume: reopening a matter lands where you left it, unless a worklist
  // deep link or a fresh file says otherwise.
  const resumeSid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1] ?? '';
  const resumed = (() => {
    if (gotoTab || openedFresh || !resumeSid) return null;
    try {
      const raw = localStorage.getItem(`starling.resume.${resumeSid}`);
      if (!raw) return null;
      const st = JSON.parse(raw) as { tab?: string; draft?: string | null };
      return (VALID_TABS as string[]).includes(st.tab ?? '') ? st as { tab: TabKey; draft?: string | null } : null;
    } catch { return null; }
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(gotoTab ?? resumed?.tab ?? (openedFresh ? 'docs' : 'issues'));
  const [showDocsHint, setShowDocsHint] = useState(openedFresh);
  const [editingFileNumber, setEditingFileNumber] = useState(false);
  const [waitingMsg, setWaitingMsg] = useState<string | null>(null);
  const [fileNumberDraft, setFileNumberDraft] = useState('');
  const [keyDate, setKeyDate] = useState({ date: '', label: '', category: 'legal', courtDeadline: true });
  const [keyDateSaving, setKeyDateSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedDraft, setSelectedDraft] = useState<string | null>(
    resumed?.tab === 'draft' && resumed.draft ? resumed.draft : null,
  );


  const [draftFilter, setDraftFilter] = useState('');
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  /**
   * With a draft on file, the workspace shows two plain tabs, Draft and
   * Options, instead of a full-screen takeover with an escape hatch named
   * "Change options". Both of the pilot's navigation bug reports were this
   * either/or hiding the thing they came for.
   */
  const [draftView, setDraftView] = useState<'draft' | 'options'>('draft');
  const [genCitations, setGenCitations] = useState<SourceCitation[]>([]);
  const [genReviewFlags, setGenReviewFlags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genNotice, setGenNotice] = useState<string | null>(null);
  const [genTone, setGenTone] = useState('professional');
  const [genDemandAmount, setGenDemandAmount] = useState('');
  // Demand letter figures. The table that itemises them is built in code,
  // so what is netted off has to be entered rather than inferred: a demand
  // that ignores the statutory pay already made invites the reply that the
  // letter is unserious.
  const [dlRecipient, setDlRecipient] = useState('');
  const [dlPaid, setDlPaid] = useState<Array<{ label: string; amount: string }>>([]);
  const [dlMitigation, setDlMitigation] = useState('');
  const [dlDeadlineDays, setDlDeadlineDays] = useState(14);
  // Which attached documents this letter reads, and what the next upload
  // is. The kind is the lawyer's to state: a file called "final.docx"
  // tells the model nothing, and a policy manual read as the employment
  // agreement quotes the wrong words with confidence.
  // The heads of damage the table itemises. Prefilled from the analysis
  // and then the lawyer's, because the analysis is a starting position and
  // the letter is theirs. Untouched, they are sent as they arrived, so
  // what is on screen is what the table will say.
  // Drafting direction: what the partner said to do on this file, and on
  // this document. Read by every generator, so it is entered once.
  const [direction, setDirection] = useState<{
    matter?: DirectionRecord;
    byDocument?: Record<string, DirectionRecord>;
  }>({});
  const [dirNotes, setDirNotes] = useState('');
  const [dirScope, setDirScope] = useState<'matter' | 'document'>('matter');
  const [dirProposed, setDirProposed] = useState<DirectionProposal | null>(null);
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [dirSaved, setDirSaved] = useState<string | null>(null);
  const [dlHeads, setDlHeads] = useState<Array<{ label: string; basis: string; amount: string }>>([]);
  const [dlHeadsTouched, setDlHeadsTouched] = useState(false);
  const [dlSourceIds, setDlSourceIds] = useState<Set<string>>(new Set());
  const [dlUploadKind, setDlUploadKind] = useState('employment_agreement');
  const dlSourceInputRef = useRef<HTMLInputElement | null>(null);



  const [genCourtLocation, setGenCourtLocation] = useState(profile.defaultCourtLocation || 'Toronto');
  const [genProcedure, setGenProcedure] = useState('simplified');
  const [amountPrefilled, setAmountPrefilled] = useState(false);
  const socPrefillDone = useRef(false);
  // Structured inputs for the deterministic court forms
  const [courtFields, setCourtFields] = useState<Record<string, string>>({});
  // Client intake portal (lawyer side)
  const [intakeLink, setIntakeLink] = useState<string | null>(null);
  const [intakeLinkCopied, setIntakeLinkCopied] = useState(false);
  const [pendingClient, setPendingClient] = useState<{ data?: Record<string, unknown>; submittedAt?: string; appliedAt?: string } | null>(null);
  const [portalMessage, setPortalMessage] = useState<string | null>(null);
  const refreshPendingClient = useCallback(() => {
    const sid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1]?.replace(/\s+/g, '');
    if (!sid) return;
    fetch(`/api/employment/${sid}/client-intake`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setPendingClient(d.pending ?? null); })
      .catch(() => { /* best-effort */ });
  }, []);
  useEffect(() => { refreshPendingClient(); }, [refreshPendingClient]);
  // Docs tab: the paste lane (files go through the drop zone)
  const [uploadKind, setUploadKind] = useState('employment_agreement');
  const [extracting, setExtracting] = useState(false);
  const [extractPasteText, setExtractPasteText] = useState('');
  const [extractPasteMsg, setExtractPasteMsg] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtraction, setLastExtraction] = useState<DocumentExtraction | null>(null);
  // Analysis empty state
  // Firm templates
  const firmTemplates = useFirmTemplates();
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [pendingTemplateFile, setPendingTemplateFile] = useState<File | null>(null);
  const [pendingTemplateLabel, setPendingTemplateLabel] = useState('');
  const templateInputRef = useRef<HTMLInputElement>(null);
  // Draft version history
  interface DraftHistoryEntry { docType: string; title: string; html: string; costUsd: number; generatedAt: string; meta?: Record<string, unknown> }
  const [draftHistory, setDraftHistory] = useState<DraftHistoryEntry[]>([]);
  const refreshDraftHistory = useCallback(() => {
    const sid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1]?.replace(/\s+/g, '');
    if (!sid) return;
    fetch(`/api/employment/${sid}/drafts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setDraftHistory(d.drafts ?? []); })
      .catch(() => { /* history is best-effort */ });
  }, []);

  /**
   * Open a document's workspace.
   *
   * Selecting a card used to change only which card was selected, leaving
   * whatever draft was last on screen in place. Since every workspace panel
   * is hidden while a draft is shown, clicking Statement of Claim after
   * reading the demand letter showed the demand letter and offered no way
   * to draft the claim at all.
   *
   * A document shows ITS OWN draft where one exists, and its workspace
   * where one does not.
   */
  const openDraftCard = useCallback((cardId: string) => {
    setSelectedDraft(cardId);
    setDraftView('draft');
    setGenError(null);
    setGenNotice(null);
    setGenCitations([]);
    setGenReviewFlags([]);
    setRevising(null);
    // The amount belongs to ONE document: the demand letter's figure must
    // never silently become the claim's, or the claim's the factum's.
    setGenDemandAmount('');
    setAmountPrefilled(false);
    socPrefillDone.current = false;
    const docType = DRAFT_TO_DOCTYPE[cardId];
    const existing = docType ? draftHistory.find(d => d.docType === docType) : undefined;
    setGeneratedHtml(existing?.html ?? null);
  }, [draftHistory]);
  useEffect(() => { refreshDraftHistory(); }, [refreshDraftHistory]);

  // Client update draft
  const [clientUpdateHtml, setClientUpdateHtml] = useState<string | null>(null);
  const [clientUpdateLoading, setClientUpdateLoading] = useState(false);
  const [clientUpdateError, setClientUpdateError] = useState<string | null>(null);
  const [clientUpdateCopied, setClientUpdateCopied] = useState(false);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  // Extract sessionId from hash
  const rawSid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1] ?? null;
  const sessionId = rawSid?.replace(/\s+/g, '') ?? null;

  // Wire hook data
  const { matter, loading, error, refresh: refreshMatter } = useMatterDetail(sessionId);
  const employment = useEmploymentData(sessionId);
  // Labour (grievance) matters render the labour view instead — detected
  // by the presence of grievance data on the matter
  const labour = useLabourData(sessionId);
  const isLabourMatter = Boolean(labour.data && Object.keys(labour.data.intake ?? {}).length > 0);

  // Sync lawyer notes from the server once loaded. Notes start empty: a new
  // file must never open pre-filled with another client's facts.
  useEffect(() => {
    if (employment.lawyerNotes !== null) {
      setNotes(employment.lawyerNotes);
    }
  }, [employment.lawyerNotes]);

  // Gate approve/dismiss — a gate is "approved" when its issue codes are in
  // the approved list. Toggling recomputes both lists and syncs to the server.
  // Gates with no issue codes (e.g. G16 "closing block") are structural
  // directives, not lawyer decisions — no approve/dismiss for those.

  // Draft a plain-language client status update (lawyer reviews + sends)
  const handleClientUpdate = useCallback(async () => {
    if (!sessionId || clientUpdateLoading) return;
    setClientUpdateLoading(true);
    setClientUpdateError(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/client-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setClientUpdateError(json.error ?? 'Draft generation failed.');
      } else {
        setClientUpdateHtml(json.html);
      }
    } catch {
      setClientUpdateError('Could not reach the server.');
    } finally {
      setClientUpdateLoading(false);
    }
  }, [sessionId, clientUpdateLoading]);

  // Docs tab: the single drop zone (CaseFileDropPanel) is the entry point
  // for files; the paste lane below it covers text with no file to drop.

  // Firm templates for the selected draft type. A firm may hold several
  // variants per type (constructive dismissal, medical leave, and so on);
  // the lawyer picks one and the download renders on it.
  /**
   * Why Generate cannot be pressed, in the lawyer's words. Null when it
   * can. A dead button that looks alive is a bug report, so the reason is
   * shown and the button is greyed from the same value.
   */
  // The claim workspace opens ready to generate: amount from the high end
  // of the damages estimate (rounded up to the nearest $5,000) and the
  // procedure from the analysis recommendation, both freely editable. The
  // prefill happens once, only for blank fields, only on the claim: the
  // demand letter's amount stays the lawyer's own judgment, untouched.
  useEffect(() => {
    if (socPrefillDone.current || selectedDraft !== 'soc') return;
    const a = employment.data?.analysis as { recommendedProcedure?: string; damagesEstimate?: { totalEstimateHigh?: number } } | null | undefined;
    if (!a) return;
    socPrefillDone.current = true;
    const high = a.damagesEstimate?.totalEstimateHigh;
    if (!genDemandAmount && typeof high === 'number' && high > 0) {
      setGenDemandAmount(String(Math.ceil(high / 5000) * 5000));
      setAmountPrefilled(true);
    }
    if (a.recommendedProcedure && ['small_claims', 'simplified', 'ordinary'].includes(a.recommendedProcedure)) {
      setGenProcedure(a.recommendedProcedure);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraft, employment.data?.analysis]);

  // The matter's forum: the lawyer's chosen procedure where set, otherwise
  // the analysis recommendation. The Small Claims Court has no Reply, so
  // the Reply workspace explains instead of generating.
  const matterProcedure = employment.data?.selectedProcedure
    ?? ((employment.data?.analysis as { recommendedProcedure?: string } | null)?.recommendedProcedure ?? null);
  const isSmallClaimsMatter = matterProcedure === 'small_claims';

  // The factum adapts to the matter's forum: a Small Claims matter gets a
  // written argument for trial, not a Rule 20 summary judgment factum.
  const draftDisplayTitle = (id: string | null | undefined): string =>
    (id === 'sjfactum' && isSmallClaimsMatter)
      ? 'Small Claims Factum'
      : (DEMO_DRAFT_TYPES.find(d => d.id === id)?.title ?? 'Document');
  const draftDisplayDescription = (dt: { id: string; description?: string }): string | undefined =>
    (dt.id === 'sjfactum' && isSmallClaimsMatter)
      ? 'The written closing argument for the Small Claims trial: Bardal, Waksdale, and the issue-specific authorities, from the approved issues only.'
      : dt.description;

  const blockedReason: string | null = (() => {
    if (!selectedDraft) return null;
    if (selectedDraft === 'reply' && isSmallClaimsMatter) {
      return 'This matter is in the Small Claims Court, and its rules provide no Reply to a Defence. See the note above for what happens instead.';
    }
    if (DRAFTS_NEEDING_AMOUNT.has(selectedDraft) && !genDemandAmount) {
      return selectedDraft === 'demand'
        ? 'Enter the Demand Amount above. It is the figure the letter demands, which is your judgment and not the total of the heads.'
        : 'Enter the Claim Amount above before generating.';
    }
    const missing = (COURT_FORM_FIELDS[selectedDraft] ?? [])
      .filter(f => f.required && !(courtFields[f.key] ?? '').trim())
      .map(f => f.label);
    if (missing.length > 0) {
      return `Fill in ${missing.join(', ')} before generating.`;
    }
    return null;
  })();

  const showOptions = !generatedHtml || draftView === 'options';
  const showDraft = Boolean(generatedHtml) && draftView === 'draft';
  // The draft is STALE when the intake changed after it was generated:
  // the file moved and the document did not.
  const draftIsStale = (() => {
    if (!selectedDraft || !generatedHtml) return false;
    const dt = DRAFT_TO_DOCTYPE[selectedDraft];
    const doc = employment.generatedDocuments.find(d => d.docType === dt);
    const revisedAt = (employment.data as { intakeRevisedAt?: string } | null | undefined)?.intakeRevisedAt;
    return Boolean(doc?.generatedAt && revisedAt && revisedAt > doc.generatedAt);
  })();

  const selectedTemplateDocType = selectedDraft ? DRAFT_TO_DOCTYPE[selectedDraft] : undefined;
  const styleProfiles = useStyleProfiles(selectedTemplateDocType);
  // Changing document type invalidates the picked style.
  useEffect(() => { setStyleProfileId(''); }, [selectedTemplateDocType]);
  const variantsForType = selectedTemplateDocType
    ? firmTemplates.templates.filter(t => t.documentType === selectedTemplateDocType)
    : [];
  const [chosenVariantId, setChosenVariantId] = useState<string | null>(null);
  const [buildingTemplate, setBuildingTemplate] = useState(false);
  const [buildingStyle, setBuildingStyle] = useState(false);
  const [styleProfileId, setStyleProfileId] = useState('');
  // Sources for the mediation brief: generated positions (toggles) plus
  // documents attached at generation time (an externally-drafted SOC, a
  // list of authorities), parsed to text before the request.
  // Stored sources come from the matter (attach once, reuse); selection
  // is which of them this generation uses.
  const [storedSources, setStoredSources] = useState<Array<{ id: string; name: string; words: number; kind?: string }>>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [includeGenDemand, setIncludeGenDemand] = useState(true);
  const [includeGenSoc, setIncludeGenSoc] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceParsing, setSourceParsing] = useState(false);
  // The lawyer's own improved version becomes the version of record.
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const adoptInputRef = useRef<HTMLInputElement | null>(null);
  const rebuttalInputRef = useRef<HTMLInputElement | null>(null);
  const socSourceInputRef = useRef<HTMLInputElement | null>(null);
  const defenceInputRef = useRef<HTMLInputElement | null>(null);
  const claimSourceInputRef = useRef<HTMLInputElement | null>(null);
  const [comparing, setComparing] = useState(false);
  const [comparisonMsg, setComparisonMsg] = useState<string | null>(null);
  const [replySelections, setReplySelections] = useState<Set<string>>(new Set());
  const [defencePasting, setDefencePasting] = useState(false);
  const [defenceText, setDefenceText] = useState('');
  const feedbackInputRef = useRef<HTMLInputElement | null>(null);
  const [feedbackPasting, setFeedbackPasting] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [rebuttalPasting, setRebuttalPasting] = useState(false);
  const [rebuttalText, setRebuttalText] = useState('');
  const [rebuttalSaving, setRebuttalSaving] = useState(false);
  const [rebuttalError, setRebuttalError] = useState<string | null>(null);

  const attachRebuttalText = useCallback(async (name: string, text: string, slot: 'rebuttal-source' | 'rebuttal-feedback' | 'soc-source' | 'defence-source' | 'claim-source' = 'rebuttal-source') => {
    if (!sessionId) return;
    setRebuttalSaving(true);
    setRebuttalError(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/${slot}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text: text.slice(0, 80_000) }),
      });
      const d = await res.json();
      if (!d.ok) { setRebuttalError(d.error ?? 'The letter could not be attached.'); return; }
      setRebuttalPasting(false);
      setRebuttalText('');
      void employment.refresh();
    } catch {
      setRebuttalError('The letter could not be attached.');
    } finally { setRebuttalSaving(false); }
  }, [sessionId, employment]);

  const extractFromPaste = useCallback(async () => {
    const content = extractPasteText.trim();
    if (!content || content.length < 40) return;
    setExtracting(true);
    setExtractPasteMsg(null);
    try {
      const kindLabel = uploadKind.replace(/_/g, ' ');
      const result = await employment.extractParsed(content.slice(0, 100_000), `Pasted ${kindLabel}`, uploadKind);
      if (!result.ok) { setExtractPasteMsg(result.error ?? 'The text could not be read. Try again.'); return; }
      const found = Object.keys(result.extraction?.extractedFields ?? {}).length;
      setExtractPasteMsg(`Read the pasted text as ${kindLabel}. ${found} fact${found === 1 ? '' : 's'} proposed below, each with the line it came from. Nothing reaches the file until you approve it.`);
      setExtractPasteText('');
    } catch {
      setExtractPasteMsg('The text could not be read. Try again.');
    } finally { setExtracting(false); }
  }, [extractPasteText, uploadKind, employment]);

  useEffect(() => {
    const items = employment.replyComparison?.items ?? [];
    setReplySelections(new Set(items.filter(i => i.kind === 'new_matter' && i.needsReply).map(i => i.id)));
  }, [employment.replyComparison]);

  const runReplyComparison = useCallback(async () => {
    if (!sessionId) return;
    setComparing(true);
    setComparisonMsg(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/reply-comparison`, { method: 'POST', credentials: 'include' });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; comparison?: { items: unknown[] }; error?: string };
      if (!res.ok || !d.comparison) { setComparisonMsg(d.error ?? 'The comparison could not be completed. Try again.'); return; }
      const items = d.comparison.items as Array<{ kind: string; needsReply: boolean }>;
      const newMatters = items.filter(i => i.kind === 'new_matter').length;
      setComparisonMsg(`Read both pleadings: ${items.length} points sorted, ${newMatters} new matter${newMatters === 1 ? '' : 's'} for the Reply, each quoting the Defence. Untick anything you choose not to answer.`);
      void employment.refresh();
    } catch {
      setComparisonMsg('The comparison could not be completed. Try again.');
    } finally { setComparing(false); }
  }, [sessionId, employment]);

  const setWaitingOn = useCallback(async (who: string) => {
    if (!sessionId) return;
    setWaitingMsg(null);
    try {
      const res = who
        ? await fetch(`/api/matters/${sessionId}/waiting`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ who }),
          })
        : await fetch(`/api/matters/${sessionId}/waiting`, { method: 'DELETE', credentials: 'include' });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) { setWaitingMsg(d.error ?? 'The waiting state could not be saved.'); return; }
      setWaitingMsg(d.message ?? null);
      void employment.refresh();
    } catch {
      setWaitingMsg('The waiting state could not be saved.');
    }
  }, [sessionId, employment]);

  // Persist where the lawyer is, so switching files costs nothing on the
  // way back. Also record the visit for the recent-files strip.
  useEffect(() => {
    if (!resumeSid) return;
    try {
      localStorage.setItem(`starling.resume.${resumeSid}`, JSON.stringify({ tab: activeTab, draft: selectedDraft }));
    } catch { /* private mode: resume is a convenience */ }
  }, [resumeSid, activeTab, selectedDraft]);

  useEffect(() => {
    if (!resumeSid) return;
    const label = matter?.client ? `${matter.client}${matter.employer ? ` v ${matter.employer}` : ''}` : null;
    if (!label) return;
    try {
      const raw = localStorage.getItem('starling.recentMatters');
      const list = raw ? (JSON.parse(raw) as Array<{ id: string; label: string; at: string }>) : [];
      const next = [{ id: resumeSid, label, at: new Date().toISOString() },
        ...list.filter(x => x.id !== resumeSid)].slice(0, 8);
      localStorage.setItem('starling.recentMatters', JSON.stringify(next));
    } catch { /* same */ }
  }, [resumeSid, matter?.client, matter?.employer]);

  // "Since you were here": one sentence when you return to a file after a
  // gap, built from what actually changed. Counts snapshot to local
  // storage; timestamps come from the documents themselves.
  const [digest, setDigest] = useState<string | null>(null);
  const digestDone = useRef(false);
  useEffect(() => {
    if (digestDone.current || !resumeSid || !employment.data) return;
    digestDone.current = true;
    try {
      const key = `starling.lastSeen.${resumeSid}`;
      const raw = localStorage.getItem(key);
      const now = new Date();
      const extractions = (employment.data.documentExtractions ?? []).length;
      const events = (employment.data.timeline ?? []).length;
      if (raw) {
        const prev = JSON.parse(raw) as { at: string; extractions: number; events: number };
        const sinceDate = new Date(prev.at);
        const hoursAway = (now.getTime() - sinceDate.getTime()) / 3_600_000;
        if (hoursAway > 18) {
          const bits: string[] = [];
          const drafted = employment.generatedDocuments.filter(d => d.generatedAt && d.generatedAt > prev.at);
          if (drafted.length > 0) {
            bits.push(`${drafted.slice(0, 2).map(d => d.title).join(' and ')}${drafted.length > 2 ? ` and ${drafted.length - 2} more` : ''} ${drafted.length === 1 ? 'was' : 'were'} drafted`);
          }
          const moved = employment.generatedDocuments.filter(d => d.statusDate && d.statusDate > prev.at && (!d.generatedAt || d.generatedAt <= prev.at));
          if (moved.length > 0) {
            bits.push(`${moved[0].title} was marked ${moved[0].status}${moved.length > 1 ? `, and ${moved.length - 1} more moved` : ''}`);
          }
          if (extractions > prev.extractions) {
            const n = extractions - prev.extractions;
            bits.push(`${n} document${n === 1 ? ' was' : 's were'} read into the file`);
          }
          if (events > prev.events) {
            const n = events - prev.events;
            bits.push(`${n} timeline event${n === 1 ? '' : 's'} added`);
          }
          if (bits.length > 0) {
            const lim = matter?.dates?.limitation;
            if (lim) bits.push(`the limitation date stands at ${lim}`);
            const label = sinceDate.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' });
            setDigest(`Since ${label}: ${bits.join(' \u00b7 ')}.`);
          }
        }
      }
      localStorage.setItem(key, JSON.stringify({ at: now.toISOString(), extractions, events }));
    } catch { /* the digest is a courtesy; never block the matter */ }
  }, [resumeSid, employment.data, employment.generatedDocuments, matter]);

  const attachRebuttalFile = useCallback(async (file: File, slot: 'rebuttal-source' | 'rebuttal-feedback' | 'soc-source' | 'defence-source' | 'claim-source' = 'rebuttal-source') => {
    setRebuttalSaving(true);
    setRebuttalError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch('/api/documents/parse', { method: 'POST', credentials: 'include', body: formData });
      if (!parseRes.ok) { setRebuttalError('Could not read the file. Supported: PDF, DOCX, Markdown, plain text.'); return; }
      const parsedDoc = await parseRes.json() as { fullText?: string };
      if (!parsedDoc.fullText?.trim()) { setRebuttalError('No text could be read from this file.'); return; }
      await attachRebuttalText(file.name, parsedDoc.fullText, slot);
    } catch {
      setRebuttalError('Could not read the file.');
    } finally { setRebuttalSaving(false); }
  }, [attachRebuttalText]);
  const [adoptPasting, setAdoptPasting] = useState(false);
  const [adoptText, setAdoptText] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const replaceDraftWithPaste = useCallback(async (text: string, docType: string) => {
    if (!sessionId) return;
    setReplacing(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/draft/replace`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, pastedText: text }),
      });
      const d = await res.json();
      if (!d.ok) { setGenError(d.error ?? 'That version could not be saved.'); return; }
      setGeneratedHtml(d.html);
      setDraftView('draft');
      setPasting(false);
      setPastedText('');
      setGenNotice(d.adopted
        ? 'That draft is now the version of record on this matter. To have Starling apply the client\u2019s corrections, use Apply feedback above the draft: paste their email, or upload the Word file they marked up.'
        : 'Your version is now the one on file. The previous draft is kept in this document\u2019s history.');
      refreshDraftHistory();
      void employment.refresh();
    } catch {
      setGenError('That version could not be saved.');
    } finally { setReplacing(false); }
  }, [sessionId, employment, refreshDraftHistory]);

  const replaceDraftWithUpload = useCallback(async (file: File, docType: string) => {
    if (!sessionId) return;
    setReplacing(true);
    setGenError(null);
    try {
      let payload: Record<string, unknown>;
      if (isDocxFile(file)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        payload = { docType, docxBase64: btoa(binary), filename: file.name };
      } else {
        const parsed = await parseFileToText(file);
        if (!parsed.ok) { setGenError(parsed.error); return; }
        payload = { docType, pastedText: parsed.text, filename: file.name };
      }
      const res = await fetch(`/api/employment/${sessionId}/draft/replace`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.ok) { setGenError(d.error ?? 'That version could not be read.'); return; }
      setGeneratedHtml(d.html);
      setDraftView('draft');
      setGenNotice(d.adopted
        ? 'That draft is now the version of record on this matter. To have Starling apply the client\u2019s corrections, use Apply feedback above the draft: paste their email, or upload the Word file they marked up.'
        : 'Your version is now the one on file. The previous draft is kept in this document\u2019s history.');
      refreshDraftHistory();
      void employment.refresh();
    } catch {
      setGenError('That version could not be read.');
    } finally { setReplacing(false); }
  }, [sessionId, employment, refreshDraftHistory]);

  // The lawyer's own timetable rows: their wording, their order. A fixed
  // step list cannot express a real schedule (mediation often precedes
  // discovery; firms word steps their own way).
  const [ttRows, setTtRows] = useState<Array<{ label: string; date: string }>>([
    { label: '', date: '' },
  ]);

  // The package: the three timetable documents and the supporting
  // affidavit are prepared together in practice, from one schedule.
  const [pkgProcedure, setPkgProcedure] = useState<'simplified' | 'ordinary'>('simplified');
  // Which of the package's documents the style teacher is aimed at.
  const [teachingDocType, setTeachingDocType] = useState<string | null>(null);
  const [pkgAffidavit, setPkgAffidavit] = useState(true);
  const [pkgDeponent, setPkgDeponent] = useState('');
  const [pkgCapacity, setPkgCapacity] = useState<'lawyer' | 'plaintiff' | 'law_clerk'>('lawyer');
  const [pkgBasis, setPkgBasis] = useState<'personal' | 'information_and_belief' | 'mixed'>('information_and_belief');
  const [pkgSource, setPkgSource] = useState('');
  const [pkgStyleIds, setPkgStyleIds] = useState<Record<string, string>>({});
  const [pkgProfiles, setPkgProfiles] = useState<Record<string, Array<{ id: string; documentType: string; label: string; sourceCount: number; createdAt: string }>>>({});

  const refreshPkgProfiles = useCallback(() => {
    Promise.all(PACKAGE_DOCS.map(async doc => {
      const res = await fetch(`/api/employment/style-profiles?documentType=${encodeURIComponent(doc.type)}`, { credentials: 'include' });
      if (!res.ok) return [doc.type, []] as const;
      const d = await res.json();
      return [doc.type, d.ok ? (d.profiles ?? []) : []] as const;
    })).then(entries => setPkgProfiles(Object.fromEntries(entries)))
      .catch(() => { /* the list is best-effort */ });
  }, []);

  useEffect(() => {
    if (selectedDraft === 'timetable') refreshPkgProfiles();
  }, [selectedDraft, refreshPkgProfiles]);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pkgResult, setPkgResult] = useState<string | null>(null);

  const generatePackage = useCallback(async () => {
    if (!sessionId) return;
    setPkgBusy(true); setGenError(null); setPkgResult(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/timetable-package`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lawyerName: profile.displayName || 'Lawyer Name',
                        lawyerBlock: profile.lawyerBlock || undefined,
                        ...(selectedDraft === 'reply' && replySelections.size > 0 ? { replyItemIds: [...replySelections] } : {}),
          firmName: profile.firmName || 'Firm Name',
          firmAddress: [profile.firmAddress, profile.firmPhone && `Tel: ${profile.firmPhone}`, profile.firmEmail && `Email: ${profile.firmEmail}`].filter(Boolean).join(' · ') || undefined,
          courtLocation: genCourtLocation,
          procedureType: pkgProcedure,
          timetableRows: ttRows.filter(r => r.label.trim() && r.date.trim()),
          styleProfileIds: pkgStyleIds,
          includeAffidavit: pkgAffidavit,
          ...(pkgAffidavit ? {
            affidavit: {
              deponentName: pkgDeponent || profile.displayName || '',
              deponentCity: genCourtLocation || undefined,
              capacity: pkgCapacity,
              knowledgeBasis: pkgBasis,
              ...(pkgBasis === 'information_and_belief' && pkgSource ? { informationSource: pkgSource } : {}),
              sworn: 'sworn',
            },
          } : {}),
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setGenError([d.error, ...(d.issues ?? [])].filter(Boolean).join(' '));
        return;
      }
      const names = (d.generated ?? []).map((g: { title: string }) => g.title).join(', ');
      setPkgResult(`${(d.generated ?? []).length} documents drafted: ${names}. ${d.docketedDates} dates on your docket. Cost $${(d.costUsd ?? 0).toFixed(2)}.`
        + ((d.failed ?? []).length ? ` ${(d.failed as Array<{ docType: string }>).length} could not be generated; try them individually.` : ''));
      setActiveTab('docs');
      void employment.refresh();
    } catch {
      setGenError('The package could not be generated.');
    } finally { setPkgBusy(false); }
  }, [sessionId, profile, genCourtLocation, ttRows, pkgProcedure, pkgStyleIds, pkgAffidavit, pkgDeponent, pkgCapacity, pkgBasis, pkgSource, employment]);

  // The pleading nodes: what the claim will plead and why. The lawyer's
  // overrides persist on the matter, so a regeneration keeps them.
  const [socNodes, setSocNodes] = useState<Array<{
    blockId: string; sectionHeader: string; tier: 1 | 2; lawyerReview: boolean;
    status: 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';
    forceable?: boolean;
    reason: string; unanswered: string[];
  }>>([]);
  const refreshSocNodes = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/soc-nodes`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setSocNodes(d.nodes ?? []); })
      .catch(() => { /* the picker is advisory until generation */ });
  }, [sessionId]);
  useEffect(() => {
    if (selectedDraft === 'soc') refreshSocNodes();
  }, [selectedDraft, refreshSocNodes, employment.data]);
  // The node library: the firm's pleading language, taught from its own
  // claims or edited by hand, through the validation gate either way.
  const [socLib, setSocLib] = useState<Array<{
    blockId: string; sectionHeader: string; content: string;
    provenance: 'default' | 'edited' | 'learned'; version: number;
  }>>([]);
  const [socProposals, setSocProposals] = useState<Array<{
    blockId: string; sectionHeader: string; sources: string[];
    current: string; proposed: string | null;
    additions: Array<{ summary: string; text: string }>;
    notes: string[]; skipped?: string;
    validation: { ok: boolean; errors: string[]; warnings: string[]; renderAllOn: string; renderAllOff: string } | null;
  }> | null>(null);
  const [socTeachBusy, setSocTeachBusy] = useState(false);
  const [socTeachMsg, setSocTeachMsg] = useState<string | null>(null);
  const socTeachInputRef = useRef<HTMLInputElement | null>(null);
  const refreshSocLib = useCallback(() => {
    fetch('/api/employment/soc-node-library', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setSocLib(d.nodes ?? []); })
      .catch(() => { /* advisory */ });
  }, []);
  useEffect(() => { if (selectedDraft === 'soc') refreshSocLib(); }, [selectedDraft, refreshSocLib]);

  const teachSocNodes = useCallback(async (files: File[]) => {
    setSocTeachBusy(true); setSocTeachMsg(null); setSocProposals(null);
    try {
      const precedents = [];
      for (const f of files) {
        if (isDocxFile(f)) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          precedents.push({ name: f.name, docxBase64: btoa(binary) });
        } else {
          const parsed = await parseFileToText(f);
          if (!parsed.ok) { setSocTeachMsg(parsed.error); return; }
          precedents.push({ name: f.name, text: parsed.text });
        }
      }
      const res = await fetch('/api/employment/soc-node-library/teach', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precedents }),
      });
      const d = await res.json();
      if (!d.ok) { setSocTeachMsg(d.error ?? 'The claims could not be analysed.'); return; }
      setSocProposals(d.proposals ?? []);
      const proposed = (d.proposals ?? []).filter((p: { proposed: string | null }) => p.proposed).length;
      setSocTeachMsg(`Read ${files.length} claims ($${(d.costUsd ?? 0).toFixed(2)}). ${proposed} passage${proposed === 1 ? '' : 's'} of your language proposed. Nothing changes until you approve it.`);
    } catch {
      setSocTeachMsg('The claims could not be analysed.');
    } finally { setSocTeachBusy(false); }
  }, []);

  const socImportInputRef = useRef<HTMLInputElement | null>(null);
  const importSocNodes = useCallback(async (file: File) => {
    setSocTeachBusy(true); setSocTeachMsg(null); setSocProposals(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await fetch('/api/employment/soc-node-library/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xlsxBase64: btoa(binary) }),
      });
      const d = await res.json();
      if (!d.ok) { setSocTeachMsg(d.error ?? 'The spreadsheet could not be read.'); return; }
      // The import feeds the same proposal surface as teaching: one place
      // to read, one Approve button, one gate.
      setSocProposals((d.proposals ?? []).map((p: { blockId: string; sectionHeader: string; current: string; proposed: string | null; validation: unknown; triggerDiffers?: string; skipped?: string }) => ({
        ...p,
        sources: [file.name],
        additions: [],
        notes: p.triggerDiffers ? [p.triggerDiffers] : [],
      })));
      const changed = (d.proposals ?? []).filter((p: { proposed: string | null }) => p.proposed).length;
      setSocTeachMsg(`Read ${file.name}: ${changed} passage${changed === 1 ? '' : 's'} differ from the library, ${d.unchanged} unchanged${(d.unknownBlocks ?? []).length ? `, unknown block ids ignored: ${d.unknownBlocks.join(', ')}` : ''}. Nothing changes until you approve it.`);
    } catch {
      setSocTeachMsg('The spreadsheet could not be read.');
    } finally { setSocTeachBusy(false); }
  }, []);

  const approveSocProposal = useCallback(async (blockId: string, content: string, provenance: 'edited' | 'learned') => {
    const res = await fetch(`/api/employment/soc-node-library/${encodeURIComponent(blockId)}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, provenance }),
    });
    const d = await res.json();
    if (!d.ok) { setSocTeachMsg(d.error ?? 'That language could not be saved.'); return false; }
    setSocProposals(prev => prev ? prev.filter(p => p.blockId !== blockId) : prev);
    refreshSocLib();
    return true;
  }, [refreshSocLib]);

    const setSocOverride = useCallback(async (blockId: string, override: 'on' | 'off' | null) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/employment/${sessionId}/soc-nodes`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId, override }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setGenError((d as { error?: string }).error ?? 'The change was not saved. Try again.');
        return;
      }
    } catch {
      setGenError('The change was not saved. Check the connection and try again.');
      return;
    }
    refreshSocNodes();
  }, [sessionId, refreshSocNodes]);

  // ── SOC outline: read, edit, approve the claim section by section ────────
  const [socOutline, setSocOutline] = useState<SocOutlineSectionUI[]>([]);
  const refreshSocOutline = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/soc-outline`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setSocOutline(d.sections ?? []); })
      .catch(() => { /* the outline is advisory until a section is drafted */ });
  }, [sessionId]);
  useEffect(() => { if (selectedDraft === 'soc') refreshSocOutline(); }, [selectedDraft, refreshSocOutline, employment.data]);

  const [socSectionBusyId, setSocSectionBusyId] = useState<string | null>(null);
  const draftSocFacts = useCallback(async (sectionId: string) => {
    if (!sessionId) return;
    setSocSectionBusyId(sectionId);
    try {
      const res = await fetch(`/api/employment/${sessionId}/soc-section/draft`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'This section could not be drafted.'); return; }
    } catch { setGenError('This section could not be drafted. Check the connection and try again.'); return; }
    finally { setSocSectionBusyId(null); }
    refreshSocOutline();
  }, [sessionId, refreshSocOutline]);

  const putSocSection = useCallback(async (body: { sectionId: string; action: 'approve' | 'unapprove' | 'save' | 'clear'; html?: string }) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/employment/${sessionId}/soc-section`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'The change was not saved.'); return; }
    } catch { setGenError('The change was not saved. Check the connection and try again.'); return; }
    refreshSocOutline();
  }, [sessionId, refreshSocOutline]);

  const approveSocSection = useCallback((sectionId: string, approved: boolean) =>
    putSocSection({ sectionId, action: approved ? 'approve' : 'unapprove' }), [putSocSection]);
  const saveSocSection = useCallback((sectionId: string, html: string) =>
    putSocSection({ sectionId, action: 'save', html }), [putSocSection]);
  const clearSocSection = useCallback((sectionId: string) =>
    putSocSection({ sectionId, action: 'clear' }), [putSocSection]);

  // ── Factum argument library (the firm's Part III argument sections) ──────
  const [factumSections, setFactumSections] = useState<Array<{
    blockId: string; sectionHeader: string; issueLabel: string; authorities: string;
    status: 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';
    reason: string; forceable: boolean; lawyerReview: boolean; custom: boolean;
  }>>([]);
  const refreshFactumSections = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/factum-nodes`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setFactumSections(d.nodes ?? []); })
      .catch(() => { /* the picker is advisory until generation */ });
  }, [sessionId]);
  useEffect(() => {
    if (selectedDraft === 'sjfactum') refreshFactumSections();
  }, [selectedDraft, refreshFactumSections, employment.data]);

  const [factumLib, setFactumLib] = useState<Array<{
    blockId: string; sectionHeader: string; content: string;
    provenance: 'default' | 'edited' | 'learned'; version: number;
  }>>([]);
  const [factumProposals, setFactumProposals] = useState<Array<{
    blockId: string; sectionHeader: string; issueLabel: string; sources: string[];
    current: string; proposed: string | null; notes: string[]; skipped?: string;
  }> | null>(null);
  const [factumTeachBusy, setFactumTeachBusy] = useState(false);
  const [factumTeachMsg, setFactumTeachMsg] = useState<string | null>(null);
  const factumTeachInputRef = useRef<HTMLInputElement | null>(null);
  const refreshFactumLib = useCallback(() => {
    fetch('/api/employment/factum-node-library', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setFactumLib(d.nodes ?? []); })
      .catch(() => { /* advisory */ });
  }, []);
  useEffect(() => { if (selectedDraft === 'sjfactum') refreshFactumLib(); }, [selectedDraft, refreshFactumLib]);

  const teachFactumSections = useCallback(async (files: File[]) => {
    setFactumTeachBusy(true); setFactumTeachMsg(null); setFactumProposals(null);
    try {
      const precedents = [];
      for (const f of files) {
        if (isDocxFile(f)) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          precedents.push({ name: f.name, docxBase64: btoa(binary) });
        } else {
          const parsed = await parseFileToText(f);
          if (!parsed.ok) { setFactumTeachMsg(parsed.error); return; }
          precedents.push({ name: f.name, text: parsed.text });
        }
      }
      const res = await fetch('/api/employment/factum-node-library/teach', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precedents }),
      });
      const d = await res.json();
      if (!d.ok) { setFactumTeachMsg(d.error ?? 'The factums could not be analysed.'); return; }
      setFactumProposals(d.proposals ?? []);
      const proposed = (d.proposals ?? []).filter((p: { proposed: string | null }) => p.proposed).length;
      setFactumTeachMsg(`Read ${files.length} factum${files.length === 1 ? '' : 's'} ($${(d.costUsd ?? 0).toFixed(2)}). ${proposed} section${proposed === 1 ? '' : 's'} of your argument proposed. Nothing changes until you approve it.`);
    } catch {
      setFactumTeachMsg('The factums could not be analysed.');
    } finally { setFactumTeachBusy(false); }
  }, []);

  const approveFactumProposal = useCallback(async (blockId: string, content: string) => {
    const res = await fetch(`/api/employment/factum-node-library/${encodeURIComponent(blockId)}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, provenance: 'learned' }),
    });
    const d = await res.json();
    if (!d.ok) { setFactumTeachMsg(d.error ?? 'That argument could not be saved.'); return; }
    setFactumProposals(prev => prev ? prev.filter(p => p.blockId !== blockId) : prev);
    refreshFactumLib();
  }, [refreshFactumLib]);

  const setFactumOverride = useCallback(async (blockId: string, override: 'on' | 'off' | null) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/employment/${sessionId}/factum-nodes`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId, override }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setGenError((d as { error?: string }).error ?? 'The change was not saved. Try again.');
        return;
      }
    } catch {
      setGenError('The change was not saved. Check the connection and try again.');
      return;
    }
    refreshFactumSections();
  }, [sessionId, refreshFactumSections]);

  const addCustomSection = useCallback(async (sectionHeader: string, guidance: string, authorities: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/employment/factum-node-library/custom', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionHeader, guidance, authorities }),
      });
      const d = await res.json();
      if (!d.ok) { setGenError(d.error ?? 'The section could not be added.'); return; }
      // Force the new section on for this factum, then refresh the picker.
      await fetch(`/api/employment/${sessionId}/factum-nodes`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: d.blockId, override: 'on' }),
      });
    } catch {
      setGenError('The section could not be added. Check the connection and try again.');
      return;
    }
    refreshFactumSections();
  }, [sessionId, refreshFactumSections]);

  const removeCustomSection = useCallback(async (blockId: string) => {
    try {
      await fetch(`/api/employment/factum-node-library/custom/${encodeURIComponent(blockId)}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (sessionId) {
        // Clear any matter override so the removed section leaves cleanly.
        await fetch(`/api/employment/${sessionId}/factum-nodes`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockId, override: null }),
        });
      }
    } catch { /* advisory; the picker refresh will show the truth */ }
    refreshFactumSections();
  }, [sessionId, refreshFactumSections]);

  // ── Factum outline: draft the factum section by section ──────────────────
  const [factumOutline, setFactumOutline] = useState<FactumOutlineSectionUI[]>([]);
  const refreshFactumOutline = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/factum-outline`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setFactumOutline(d.sections ?? []); })
      .catch(() => { /* the outline is advisory until a section is drafted */ });
  }, [sessionId]);
  useEffect(() => {
    if (selectedDraft === 'sjfactum') refreshFactumOutline();
  }, [selectedDraft, refreshFactumOutline, employment.data]);

  const [factumDraftBusyId, setFactumDraftBusyId] = useState<string | null>(null);
  const [factumDraftingAll, setFactumDraftingAll] = useState(false);

  const draftFactumSection = useCallback(async (sectionId: string) => {
    if (!sessionId) return;
    setFactumDraftBusyId(sectionId);
    try {
      const amount = genDemandAmount ? parseInt(genDemandAmount) : undefined;
      const res = await fetch(`/api/employment/${sessionId}/factum-section/draft`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId,
          claimAmount: amount && Number.isFinite(amount) ? amount : undefined,
          lawyerName: profile.displayName || undefined,
          firmName: profile.firmName || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'This section could not be drafted.'); return; }
    } catch {
      setGenError('This section could not be drafted. Check the connection and try again.');
      return;
    } finally { setFactumDraftBusyId(null); }
    refreshFactumOutline();
  }, [sessionId, genDemandAmount, profile, refreshFactumOutline]);

  const draftAllFactumSections = useCallback(async () => {
    if (!sessionId) return;
    setFactumDraftingAll(true);
    try {
      // Draft only the sections not yet drafted, in outline order, so a
      // redraft of one does not cost a fresh draft of the whole factum.
      const toDraft = factumOutline.filter(s => !s.hasDraft).map(s => s.id);
      const amount = genDemandAmount ? parseInt(genDemandAmount) : undefined;
      for (const sectionId of toDraft) {
        const res = await fetch(`/api/employment/${sessionId}/factum-section/draft`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId,
            claimAmount: amount && Number.isFinite(amount) ? amount : undefined,
            lawyerName: profile.displayName || undefined,
            firmName: profile.firmName || undefined,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!d.ok) { setGenError((d as { error?: string }).error ?? 'A section could not be drafted.'); break; }
        refreshFactumOutline();
      }
    } finally { setFactumDraftingAll(false); }
    refreshFactumOutline();
  }, [sessionId, factumOutline, genDemandAmount, profile, refreshFactumOutline]);

  const putFactumSection = useCallback(async (body: { sectionId: string; action: 'approve' | 'unapprove' | 'save' | 'clear'; html?: string }) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/employment/${sessionId}/factum-section`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'The change was not saved.'); return; }
    } catch {
      setGenError('The change was not saved. Check the connection and try again.');
      return;
    }
    refreshFactumOutline();
  }, [sessionId, refreshFactumOutline]);

  const approveFactumSection = useCallback((sectionId: string, approved: boolean) =>
    putFactumSection({ sectionId, action: approved ? 'approve' : 'unapprove' }), [putFactumSection]);
  const saveFactumSection = useCallback((sectionId: string, html: string) =>
    putFactumSection({ sectionId, action: 'save', html }), [putFactumSection]);
  const clearFactumSection = useCallback((sectionId: string) =>
    putFactumSection({ sectionId, action: 'clear' }), [putFactumSection]);

  // ── Mediation brief outline: draft the brief section by section ──────────
  const [mediationOutline, setMediationOutline] = useState<MediationOutlineSectionUI[]>([]);
  const refreshMediationOutline = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/mediation-outline`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setMediationOutline(d.sections ?? []); })
      .catch(() => { /* advisory until a section is drafted */ });
  }, [sessionId]);
  useEffect(() => { if (selectedDraft === 'mediation') refreshMediationOutline(); }, [selectedDraft, refreshMediationOutline, employment.data]);

  const [mediationDraftBusyId, setMediationDraftBusyId] = useState<string | null>(null);
  const [mediationDraftingAll, setMediationDraftingAll] = useState(false);
  const draftMediationSection = useCallback(async (sectionId: string) => {
    if (!sessionId) return;
    setMediationDraftBusyId(sectionId);
    try {
      const amount = genDemandAmount ? parseInt(genDemandAmount) : undefined;
      const res = await fetch(`/api/employment/${sessionId}/mediation-section/draft`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId, claimAmount: amount && Number.isFinite(amount) ? amount : undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'This section could not be drafted.'); return; }
    } catch { setGenError('This section could not be drafted. Check the connection and try again.'); return; }
    finally { setMediationDraftBusyId(null); }
    refreshMediationOutline();
  }, [sessionId, genDemandAmount, refreshMediationOutline]);

  const draftAllMediationSections = useCallback(async () => {
    if (!sessionId) return;
    setMediationDraftingAll(true);
    try {
      const toDraft = mediationOutline.filter(s => !s.hasDraft).map(s => s.id);
      const amount = genDemandAmount ? parseInt(genDemandAmount) : undefined;
      for (const sectionId of toDraft) {
        const res = await fetch(`/api/employment/${sessionId}/mediation-section/draft`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionId, claimAmount: amount && Number.isFinite(amount) ? amount : undefined }),
        });
        const d = await res.json().catch(() => ({}));
        if (!d.ok) { setGenError((d as { error?: string }).error ?? 'A section could not be drafted.'); break; }
        refreshMediationOutline();
      }
    } finally { setMediationDraftingAll(false); }
    refreshMediationOutline();
  }, [sessionId, mediationOutline, genDemandAmount, refreshMediationOutline]);

  const putMediationSection = useCallback(async (body: { sectionId: string; action: 'approve' | 'unapprove' | 'save' | 'clear'; html?: string }) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/employment/${sessionId}/mediation-section`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { setGenError((d as { error?: string }).error ?? 'The change was not saved.'); return; }
    } catch { setGenError('The change was not saved. Check the connection and try again.'); return; }
    refreshMediationOutline();
  }, [sessionId, refreshMediationOutline]);
  const approveMediationSection = useCallback((sectionId: string, approved: boolean) =>
    putMediationSection({ sectionId, action: approved ? 'approve' : 'unapprove' }), [putMediationSection]);
  const saveMediationSection = useCallback((sectionId: string, html: string) =>
    putMediationSection({ sectionId, action: 'save', html }), [putMediationSection]);
  const clearMediationSection = useCallback((sectionId: string) =>
    putMediationSection({ sectionId, action: 'clear' }), [putMediationSection]);

  const [readiness, setReadiness] = useState<Array<{ level: 'ok' | 'warn' | 'info'; label: string; hint?: string; goTo?: string }>>([]);
  // The last generation's logistics prefill the fields; the lawyer edits
  // rather than retypes.
  useEffect(() => {
    if (selectedDraft !== 'mediation' || !employment.mediationLogistics) return;
    setCourtFields(prev => ({
      ...prev,
      ...(employment.mediationLogistics!.date && !prev.mediation_date ? { mediation_date: employment.mediationLogistics!.date } : {}),
      ...(employment.mediationLogistics!.mediator && !prev.mediator_name ? { mediator_name: employment.mediationLogistics!.mediator } : {}),
    }));
  }, [selectedDraft, employment.mediationLogistics]);

  useEffect(() => {
    // Each document has its own preflight: what a mediation brief needs is
    // not what a demand letter needs.
    const endpoint = selectedDraft === 'mediation' ? 'brief-readiness'
      : selectedDraft === 'demand' ? 'demand-readiness'
      : null;
    if (!endpoint || !sessionId) { setReadiness([]); return; }
    fetch(`/api/employment/${sessionId}/${endpoint}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.ok) return;
        setReadiness(d.items ?? []);
        // Prefill only while the lawyer has not edited: a refresh must not
        // discard heads they have written.
        if (!dlHeadsTouched) {
          setDlHeads(((d.defaultHeads ?? []) as Array<{ label: string; basis?: string; amount?: number | null }>)
            .map(h => ({ label: h.label, basis: h.basis ?? '', amount: h.amount != null ? String(h.amount) : '' })));
        }
      })
      .catch(() => { /* the checklist is advisory */ });
  }, [selectedDraft, sessionId, employment.data, employment.briefSources, dlHeadsTouched]);
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/employment/${sessionId}/direction`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setDirection(d.direction ?? {}); })
      .catch(() => { /* direction is advisory until it is saved */ });
  }, [sessionId]);

  /** Read the pasted notes and propose instructions. Nothing binds yet. */
  const readDirectionNotes = useCallback(async () => {
    if (!sessionId || !dirNotes.trim()) return;
    setDirBusy(true); setDirError(null); setDirSaved(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/direction/extract`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: dirNotes,
          ...(dirScope === 'document' && selectedDraft
            ? { documentType: DRAFT_TO_DOCTYPE[selectedDraft], documentLabel: DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title }
            : {}),
        }),
      });
      const d = await res.json();
      if (!d.ok) { setDirError(d.error ?? 'The notes could not be read.'); return; }
      setDirProposed(d.proposed as DirectionProposal);
    } catch {
      setDirError('The notes could not be read.');
    } finally {
      setDirBusy(false);
    }
  }, [sessionId, dirNotes, dirScope, selectedDraft]);

  /** Save the approved instructions. From here they bind every draft. */
  const saveDirection = useCallback(async (
    instructions: DirectionInstructionUi[],
    scope: 'matter' | 'document',
    extras?: { withheld?: string[]; proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }>; notes?: string },
  ) => {
    if (!sessionId) return;
    setDirBusy(true); setDirError(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/direction`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(scope === 'document' && selectedDraft ? { documentType: DRAFT_TO_DOCTYPE[selectedDraft] } : {}),
          instructions: instructions.map(i => ({
            text: i.text, kind: i.kind,
            mustInclude: i.mustInclude, mustNotInclude: i.mustNotInclude,
          })),
          withheld: extras?.withheld,
          proposedHeads: extras?.proposedHeads,
          notes: extras?.notes,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setDirError(d.error ?? 'The direction could not be saved.'); return; }
      setDirection(d.direction ?? {});
      setDirProposed(null);
      setDirNotes('');
      setDirSaved(scope === 'matter' ? 'Direction saved for this file. Every draft will follow it.' : 'Direction saved for this document.');
    } catch {
      setDirError('The direction could not be saved.');
    } finally {
      setDirBusy(false);
    }
  }, [sessionId, selectedDraft]);

  /**
   * The direction panel. Paste notes, read them into instructions, approve.
   * Rendered on the Notes tab for the file, and inside a draft workspace
   * for that document alone.
   */
  const renderDirection = (scope: 'matter' | 'document') => {
    const documentType = selectedDraft ? DRAFT_TO_DOCTYPE[selectedDraft] : undefined;
    const current = scope === 'matter'
      ? direction.matter
      : (documentType ? direction.byDocument?.[documentType] : undefined);
    const documentTitle = DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'this document';
    const active = dirScope === scope;

    return (
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>
          {scope === 'matter' ? 'Direction for this file' : `Direction for ${documentTitle}`}
        </div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
          {scope === 'matter'
            ? 'What the partner said to do on this file. Every draft follows it. Paste your call notes and Starling pulls out the instructions for you to approve, keeping anything the client said in confidence out of the drafting.'
            : `Instructions for ${documentTitle} alone. Where these conflict with the direction for the file, these govern.`}
        </div>

        {(current?.instructions.length ?? 0) > 0 && (
          <div style={{ marginBottom: 12 }}>
            {current!.instructions.map((instruction, i) => (
              <div key={instruction.id ?? i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', fontSize: 13 }}>
                <span aria-hidden="true" style={{ color: navy, fontWeight: 700, minWidth: 14 }}>·</span>
                <span style={{ flex: 1, color: ink }}>{instruction.text}</span>
                <button
                  onClick={() => void saveDirection(
                    current!.instructions.filter((_, j) => j !== i), scope,
                    { withheld: current!.withheld, proposedHeads: current!.proposedHeads, notes: current!.notes },
                  )}
                  aria-label={`Remove instruction ${i + 1}`}
                  style={{ fontSize: 12, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '0 4px' }}
                >
                  remove
                </button>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: muted, marginTop: 6 }}>
              Binding on every draft{current!.updatedByName ? `, saved by ${current!.updatedByName}` : ''}. A draft that departs from these is flagged when it is generated.
            </div>
            {(current!.withheld?.length ?? 0) > 0 && (
              <div style={{ fontSize: 11.5, color: muted, marginTop: 6, fontStyle: 'italic' }}>
                Kept out of every draft: {current!.withheld!.join('; ')}.
              </div>
            )}
          </div>
        )}

        {dirProposed && active ? (
          <div style={{ border: `1px solid ${border}`, padding: '12px 14px', background: '#fbfaf8' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: ink, marginBottom: 6 }}>
              Read from your notes. Approve what should bind the drafting.
            </div>
            {dirProposed.instructions.map((instruction, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', fontSize: 13 }}>
                <span aria-hidden="true" style={{ color: navy, minWidth: 14 }}>·</span>
                <span style={{ flex: 1, color: ink }}>{instruction.text}</span>
                <button
                  onClick={() => setDirProposed(p => p ? { ...p, instructions: p.instructions.filter((_, j) => j !== i) } : p)}
                  aria-label={`Drop proposed instruction ${i + 1}`}
                  style={{ fontSize: 12, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '0 4px' }}
                >
                  drop
                </button>
              </div>
            ))}
            {(dirProposed.withheld?.length ?? 0) > 0 && (
              <div style={{ fontSize: 12, color: muted, marginTop: 8, lineHeight: 1.5 }}>
                <strong style={{ color: ink }}>Kept out of the drafting:</strong> {dirProposed.withheld!.join('; ')}. This stays on the file and never reaches a document.
              </div>
            )}
            {(dirProposed.proposedHeads?.length ?? 0) > 0 && (
              <div style={{ fontSize: 12, color: muted, marginTop: 8, lineHeight: 1.5 }}>
                <strong style={{ color: ink }}>Heads of damage this implies:</strong>{' '}
                {dirProposed.proposedHeads!.map(h => `${h.label}${h.amount ? ` (${h.amount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })})` : ''}`).join(', ')}. The damages table will itemise these unless you edit the heads yourself.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => void saveDirection(
                  // Direction ACCUMULATES. The partner says something new in
                  // August that sits alongside what was said in June; a save
                  // that replaced the file's standing direction with the last
                  // note pasted would quietly drop it.
                  [
                    ...(current?.instructions ?? []),
                    ...dirProposed.instructions.filter(
                      p => !(current?.instructions ?? []).some(e => e.text.trim() === p.text.trim()),
                    ),
                  ],
                  scope,
                  {
                    withheld: [...(current?.withheld ?? []), ...(dirProposed.withheld ?? [])],
                    proposedHeads: dirProposed.proposedHeads ?? current?.proposedHeads,
                    notes: dirNotes,
                  },
                )}
                disabled={dirBusy || dirProposed.instructions.length === 0}
                style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 15px', borderRadius: 2, fontFamily: sans, background: orange, color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                {dirBusy ? 'Saving…' : 'Approve'}
              </button>
              <button
                onClick={() => setDirProposed(null)}
                style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 15px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
              >
                Discard
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              value={active ? dirNotes : ''}
              onChange={e => { setDirScope(scope); setDirNotes(e.target.value); setDirSaved(null); }}
              placeholder={scope === 'matter'
                ? 'Paste your notes from the call or from the partner. For example: "DE says we are only chasing the four weeks of unpaid notice, do not plead common law, keep it short."'
                : `Instructions for ${documentTitle} alone. Pasting the client's feedback as it arrived works: Starling reads the instructions out of it, and you approve each one.`}
              rows={4}
              aria-label={scope === 'matter' ? 'Notes directing the drafting on this file' : `Notes directing ${documentTitle}`}
              style={{ width: '100%', fontFamily: sans, fontSize: 13.5, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
              <button
                onClick={() => { setDirScope(scope); void readDirectionNotes(); }}
                disabled={dirBusy || !active || !dirNotes.trim()}
                style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 15px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: dirBusy || !active || !dirNotes.trim() ? 'default' : 'pointer', opacity: dirBusy || !active || !dirNotes.trim() ? 0.55 : 1 }}
              >
                {dirBusy && active ? 'Reading…' : 'Read the notes'}
              </button>
              <span style={{ fontSize: 11.5, color: muted }}>
                {dirBusy && active
                  ? 'Starling reads everything you pasted before proposing. Long notes take a minute or two.'
                  : 'Nothing binds until you approve it.'}
              </span>
            </div>
          </>
        )}
        {dirError && active && <div role="alert" style={{ fontSize: 12.5, color: red, marginTop: 8 }}>{dirError}</div>}
        {dirSaved && active && <div style={{ fontSize: 12.5, color: green, marginTop: 8 }}>{dirSaved}</div>}
      </div>
    );
  };


  const briefSourceInputRef = useRef<HTMLInputElement | null>(null);

  // Load stored sources whenever the matter data refreshes. Only sources
  // this session has never seen arrive pre-selected: a lawyer who unticks
  // a source must not have it re-ticked by the next refresh, which is how
  // an excluded document kept finding its way back into the brief.
  const seenSourceIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const list = (employment.briefSources ?? []) as Array<{ id: string; name: string; words: number; kind?: string }>;
    setStoredSources(list);
    const fresh = list.filter(sd => !seenSourceIdsRef.current.has(sd.id));
    setSelectedSourceIds(prev => {
      const next = new Set([...prev].filter(id => list.some(sd => sd.id === id)));
      for (const sd of fresh) next.add(sd.id);
      return next;
    });
    setDlSourceIds(prev => {
      const next = new Set([...prev].filter(id => list.some(sd => sd.id === id)));
      for (const sd of fresh) next.add(sd.id);
      return next;
    });
    for (const sd of list) seenSourceIdsRef.current.add(sd.id);
  }, [employment.briefSources]);

  const attachBriefSource = useCallback(async (file: File, kind?: string) => {
    if (!sessionId) return;
    setSourceParsing(true);
    setSourceError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/documents/parse', { method: 'POST', credentials: 'include', body: formData });
      if (!res.ok) { setSourceError(`"${file.name}" could not be parsed. Supported: PDF, DOCX, Markdown, plain text.`); return; }
      const parsedDoc = await res.json() as { fullText?: string };
      const text = (parsedDoc.fullText ?? '').trim();
      if (!text) { setSourceError(`No text could be read from "${file.name}".`); return; }
      const save = await fetch(`/api/employment/${sessionId}/brief-sources`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, text, ...(kind ? { kind } : {}) }),
      });
      const d = await save.json();
      if (!d.ok) { setSourceError(d.error ?? 'The source could not be saved.'); return; }
      const list = (d.sources ?? []) as Array<{ id: string; name: string; words: number; kind?: string }>;
      setStoredSources(list);
      setSelectedSourceIds(prev => {
        const next = new Set(prev);
        const added = list.find(sd => sd.name === file.name);
        if (added) next.add(added.id);
        return next;
      });
    } catch {
      setSourceError(`"${file.name}" could not be read.`);
    } finally {
      setSourceParsing(false);
    }
  }, [sessionId]);

  const removeBriefSource = useCallback(async (id: string) => {
    if (!sessionId) return;
    const res = await fetch(`/api/employment/${sessionId}/brief-sources/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      setStoredSources(prev => prev.filter(sd => sd.id !== id));
      setSelectedSourceIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [sessionId]);
  const approvalsEnabled = useApprovalsEnabled();
  const [revising, setRevising] = useState<null | { source: 'client' | 'partner' | 'lawyer'; initial?: string }>(null);

  // Reset the choice when the document type changes, and keep a stale id
  // (deleted or renamed variant) from lingering.
  useEffect(() => { setChosenVariantId(null); }, [selectedTemplateDocType]);

  const activeVariant = variantsForType.find(t => t.variantId === chosenVariantId)
    ?? variantsForType.find(t => t.isDefault)
    ?? variantsForType[0];
  const currentTemplate = activeVariant;

  const handleTemplateUpload = useCallback(async (file: File, label?: string) => {
    if (!selectedTemplateDocType) return;
    setTemplateStatus('Uploading...');
    const result = await firmTemplates.upload(file, selectedTemplateDocType, label ? { label } : undefined);
    // "0 placeholders detected" read as success and was not. Where the
    // template carries no markers, say what will happen to it instead.
    setTemplateStatus(result.ok
      ? (result.notice
          ?? `Template saved. ${result.placeholders?.length ?? 0} placeholder${(result.placeholders?.length ?? 0) === 1 ? '' : 's'} detected.`)
      : result.error ?? 'Upload failed.');
  }, [firmTemplates, selectedTemplateDocType]);

  // ── Deep Analysis — launch a multi-agent session pre-filled from this
  // matter. Seeds the same sessionStorage keys the engagement flow reads
  // (briefing memo, config, team), then enters at Strategy.
  const DEEP_ANALYSES: Record<string, {
    label: string; workflowId: string; intensity: string; budgetUsd: number;
    matterType: string; team: string[]; question: string;
  }> = {
    second_opinion: {
      label: 'Second Opinion', workflowId: 'counsel', intensity: 'standard', budgetUsd: 10,
      matterType: 'case_assessment',
      team: ['employment-counsel'],
      question: 'Provide a second opinion on this matter: the merits, the entitlements analysis, and the strategy. Identify anything the analysis to date has missed or overstated.',
    },
    moot: {
      label: "Moot the Employer's Response", workflowId: 'adversarial', intensity: 'thorough', budgetUsd: 25,
      matterType: 'case_assessment',
      team: ['employment-counsel', 'litigation-partner', 'red-team', 'synthesis-editor'],
      question: "Anticipate the employer's strongest response. Attack our position exactly as employer's counsel would (termination clause enforceability, mitigation, cause allegations, quantum), then assess how our claims hold up and how to shore up the weak points before we send anything.",
    },
    assessment: {
      label: 'Full Case Assessment', workflowId: 'review', intensity: 'thorough', budgetUsd: 25,
      matterType: 'case_assessment',
      team: ['employment-counsel', 'contract-reviewer', 'legal-researcher', 'evaluator'],
      question: 'Full case assessment: merits of each claim, realistic damages range, procedural strategy (forum, timing, limitation pressure), litigation risks, and recommended next steps.',
    },
    settlement: {
      label: 'Settlement Valuation', workflowId: 'roundtable', intensity: 'standard', budgetUsd: 20,
      matterType: 'settlement',
      team: ['employment-counsel', 'litigation-partner', 'arbitration-specialist', 'synthesis-editor'],
      question: 'Value this case for settlement: realistic outcome range, the ESA floor, adjustments for litigation cost and risk, tax-effective structuring options, and a negotiation strategy.',
    },
  };

  const launchDeepAnalysis = useCallback((key: string) => {
    const spec = DEEP_ANALYSES[key];
    if (!spec || !sessionId) return;
    const intake = (employment.data?.intake ?? {}) as Record<string, unknown>;
    const analysis = employment.data?.analysis as Record<string, unknown> | null;
    const clientName = [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ') || matter?.client || 'Client';
    const employerName = (intake.employer_legal_name as string) || matter?.employer || 'Employer';
    const title = `${spec.label}: ${clientName} v ${employerName}`;

    // Build the briefing memo from what Starling already knows
    const lines: string[] = [
      `# Deep Analysis: ${spec.label}`,
      `Matter: ${clientName} v ${employerName}`,
      '',
      '## Question for the team',
      spec.question,
      '',
      '## Intake facts',
      `- Client: ${clientName}${intake.job_title ? `, ${intake.job_title}` : ''}`,
      `- Employer: ${employerName}`,
      intake.annual_salary ? `- Annual salary: $${Number(intake.annual_salary).toLocaleString('en-CA')}` : '',
      intake.hire_date ? `- Employment: ${intake.hire_date} to ${intake.termination_date ?? 'present'}` : '',
      intake.termination_reasons ? `- Stated reason for termination: ${intake.termination_reasons}` : '',
      intake.employer_alleged_just_cause ? '- Employer alleges just cause' : '',
      intake.is_constructive_dismissal ? '- Constructive dismissal claimed' : '',
    ];
    const gates = employment.data?.gates?.filter(g => g.triggered) ?? [];
    if (gates.length > 0) {
      lines.push('', '## Issues identified (16-gate analysis)');
      for (const g of gates) {
        const approved = g.issueCodes.some(c => employment.data!.approvedIssues.includes(c));
        lines.push(`- [${approved ? 'APPROVED' : 'pending'}] ${g.reason}`);
      }
    }
    if (analysis) {
      const dmg = analysis.damagesEstimate as Record<string, unknown> | undefined;
      const lim = analysis.limitationDeadline as Record<string, unknown> | undefined;
      lines.push('', '## Analysis to date');
      if (dmg) {
        lines.push(`- ESA notice: ${dmg.esaNoticeWeeks} weeks ($${Number(dmg.esaNoticePay ?? 0).toLocaleString('en-CA')}); ESA severance: $${Number(dmg.esaSeverancePay ?? 0).toLocaleString('en-CA')}`);
        lines.push(`- Common law range: ${dmg.commonLawLowMonths}–${dmg.commonLawHighMonths} months ($${Number(dmg.commonLawLowAmount ?? 0).toLocaleString('en-CA')}–$${Number(dmg.commonLawHighAmount ?? 0).toLocaleString('en-CA')})`);
      }
      if (lim?.date) lines.push(`- Limitation deadline: ${lim.date} (${lim.daysRemaining} days remaining${lim.urgent ? '; URGENT' : ''})`);
      if (analysis.recommendedProcedure) lines.push(`- Recommended procedure: ${analysis.recommendedProcedure}`);
    }
    const timeline = employment.data?.timeline ?? [];
    if (timeline.length > 0) {
      lines.push('', '## Timeline');
      for (const ev of timeline.slice(0, 12)) lines.push(`- ${ev.date}: ${ev.label}`);
    }

    sessionStorage.setItem('shem-matter-id', sessionId);
    sessionStorage.setItem('shem-matter-data', JSON.stringify({
      matterId: sessionId,
      matterNumber: matter?.number ?? sessionId,
      clientName,
      matterTitle: title,
      matterType: spec.matterType,
      jurisdiction: 'Ontario',
      response: {
        conflictCheck: { conflictFound: false },
        kyc: { clientVerified: true, riskLevel: 'low', flags: [] },
        engagementLetter: {
          scope: spec.question,
          feeStructure: 'fixed',
          estimatedBudget: { min: spec.budgetUsd, max: spec.budgetUsd, currency: 'USD' },
          accepted: true,
        },
      },
    }));
    sessionStorage.setItem('shem-briefing-memo', lines.filter(l => l !== '').join('\n'));
    sessionStorage.setItem('shem-briefing-config', JSON.stringify({
      workflowId: spec.workflowId,
      intensity: spec.intensity,
      budgetUsd: spec.budgetUsd,
      yoloMode: false,
      verification: spec.workflowId !== 'counsel',
      provider: 'anthropic',
    }));
    sessionStorage.setItem('shem-briefing-team', JSON.stringify(spec.team));

    // Record the launch on the matter timeline (fire-and-forget) so the
    // matter file shows when analyses were commissioned
    fetch(`/api/employment/${sessionId}/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        label: `Deep Analysis launched: ${spec.label}`,
        description: 'Results appear in My Cases when the session completes.',
        category: 'legal',
      }),
    }).catch(() => { /* non-fatal */ });

    window.location.hash = '#/strategy';
  }, [employment.data, matter, sessionId]);

  // Compute tab badge counts from hook data
  const issueCount = matter?.issues.length ?? 0;
  const docCount = matter?.documents.length ?? 0;
  const dynamicTabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'issues', label: 'Issues Found', badge: issueCount || undefined },
    { key: 'docs', label: 'Documents', badge: docCount || undefined },
    { key: 'draft', label: 'Draft' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'intake', label: 'Intake', badge: pendingClient?.data && !pendingClient.appliedAt ? 1 : undefined },
    { key: 'client', label: 'Client' },
    { key: 'negotiation', label: 'Negotiation' },
    { key: 'debrief', label: 'Debrief' },
    { key: 'notes', label: 'Notes' },
  ];

  // Labour matters get the grievance view (same shell, labour tabs)
  if (isLabourMatter && sessionId) {
    return <LabourMatterDetailView sessionId={sessionId} matterNumber={matter?.number} />;
  }

  // Loading state — wait for the labour probe too, so grievance matters
  // don't flash the employment view before switching
  if (loading || labour.loading) {
    return (
      <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        <MatterDetailTopBar />
        <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
          <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 16, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
            &larr; My Cases
          </a>
          <div style={{ padding: '60px 0', textAlign: 'center', color: muted, fontSize: 15 }}>Loading matter...</div>
        </main>
      </div>
    );
  }

  // Not found state
  if (!matter && !loading) {
    return (
      <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        <MatterDetailTopBar />
        <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
          <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 16, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
            &larr; My Cases
          </a>
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 16, color: ink, fontWeight: 600, marginBottom: 8 }}>Matter not found</div>
            <div style={{ fontSize: 13.5, color: muted, marginBottom: 14 }}>{error || 'The requested matter could not be loaded.'}</div>
            <a href="#/" style={{ fontSize: 13.5, fontWeight: 600, color: orange, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
              &larr; Back to dashboard
            </a>
          </div>
        </main>
      </div>
    );
  }

  // Status display helpers
  const statusLabel = matter!.status === 'urgent' ? 'Urgent' : matter!.status === 'stale' ? 'Needs attention' : matter!.status === 'complete' ? 'Complete' : 'Active';
  const statusColour = matter!.status === 'urgent' ? red : matter!.status === 'stale' ? amber : matter!.status === 'complete' ? green : navy;
  const statusBg = matter!.status === 'urgent' ? '#fce8e6' : matter!.status === 'stale' ? '#fdf0dd' : matter!.status === 'complete' ? '#e7f6ec' : '#eef1f6';

  /**
   * Run a FULL generation from the current file. Shared by the
   * Options Generate button and the regenerate action on the draft,
   * so a redraft after an intake change is one click, not a hunt.
   */
  const runGeneration = async () => {
    setGenerating(true);
    setGenError(null);
    // No invented figures: an amount reaches the server only when the
    // lawyer typed one (drafts that need one are blocked without it), and
    // Small Claims is a claim-only procedure the litigation schema refuses.
    const amount = genDemandAmount ? parseInt(genDemandAmount) : undefined;
    const fieldDefs = COURT_FORM_FIELDS[selectedDraft ?? ''];
    const formFields = fieldDefs
      ? Object.fromEntries(fieldDefs
          .map(f => [f.key, (courtFields[f.key] ?? '').trim()])
          .filter(([, v]) => v !== ''))
      : undefined;
    const result = await employment.generateDocument(
      DRAFT_TO_DOCTYPE[selectedDraft ?? ''] ?? 'demand_letter',
      {
        tone: genTone,
        demandAmount: amount,
        claimAmount: amount,
        procedureType: selectedDraft === 'soc' ? genProcedure : (genProcedure === 'small_claims' ? undefined : genProcedure),
        formFields,
        lawyerName: profile.displayName || 'Lawyer Name',
        lawyerBlock: profile.lawyerBlock || undefined,
        firmName: profile.firmName || 'Firm Name',
        // Composed contact block — the generators accept a single
        // firmAddress string and the model fills the signature
        // block from it instead of leaving [Address] fill-ins
        firmAddress: [
          profile.firmAddress,
          profile.firmPhone && `Tel: ${profile.firmPhone}`,
          profile.firmEmail && `Email: ${profile.firmEmail}`,
          profile.lsoNumber && `LSO# ${profile.lsoNumber}`,
        ].filter(Boolean).join(' · ') || undefined,
        courtLocation: genCourtLocation,
        responseDeadlineDays: dlDeadlineDays,
        ...(styleProfileId ? { styleProfileId } : {}),

        ...(selectedDraft === 'demand' ? {
          sourceIds: [...dlSourceIds],
          // The heads exactly as shown. The server treats an omitted array
          // as "use the analysis defaults", so when the lawyer has cleared
          // every row we send the flag instead of an empty array that would
          // silently restore the defaults.
          ...(dlHeads.some(h => h.label.trim() !== '')
            ? {
                damageHeads: dlHeads
                  .filter(h => h.label.trim() !== '')
                  .map(h => ({
                    label: h.label.trim(),
                    basis: h.basis.trim() || undefined,
                    amount: h.amount !== '' ? Number(h.amount) : null,
                  })),
              }
            : { damageHeads: [{ label: 'No heads itemised', amount: null, basis: 'the lawyer cleared the damages table' }] }),
          recipientName: dlRecipient.trim() || undefined,
          amountsPaid: dlPaid
            .map(r => ({ label: r.label.trim(), amount: Number(r.amount) }))
            .filter(r => r.label !== '' && r.amount > 0),
          mitigationEarnings: dlMitigation ? Number(dlMitigation) : undefined,
        } : {}),

        ...(selectedDraft === 'mediation' ? {
          briefSourceIds: [...selectedSourceIds],
          includeGeneratedDemand: includeGenDemand,
          includeGeneratedSoc: includeGenSoc,
        } : {}),
      },
    );
    setGenerating(false);
    if (result.ok && result.html) {
      setGeneratedHtml(result.html);
      setDraftView('draft');
      setGenCitations(result.citations ?? []);
      setGenReviewFlags(result.reviewFlags ?? []);
      // Tell the lawyer their dates reached the docket, and
      // pass on any Rule 48.14 caution.
      const notes: string[] = [];
      if (selectedDraft === 'soc' && result.nodeReport) {
        const pleaded = result.nodeReport.filter(r => r.status === 'firing' || r.status === 'forced_on').length;
        notes.push(`Claim generated${result.procedureType ? ` under the ${result.procedureType.replace(/_/g, ' ')} procedure` : ''}: ${pleaded} section${pleaded === 1 ? '' : 's'} pleaded. The pleading picker under Options shows each decision.`);
      }
      if (selectedDraft === 'demand') {
        const bits: string[] = [];
        if (result.demandAmount) bits.push(`Demand letter generated for $${Number(result.demandAmount).toLocaleString('en-CA')}`);
        else bits.push('Demand letter generated');
        if (result.responseDueDate) bits.push(`response due ${result.responseDueDate}, now on your docket`);
        if (result.recordedOnLedger) bits.push('and recorded on the negotiation ledger');
        notes.push(bits.join(', ') + '.');
      }
      if (typeof result.costUsd === 'number' && result.costUsd > 0) {
        notes.push(`Draft cost $${result.costUsd.toFixed(2)}.`);
      }
      if (result.droppedSources?.length) {
        notes.push(`NOT read (the brief holds six sources at most): ${result.droppedSources.join('; ')}. Untick something and regenerate to include them.`);
      }
      if (result.positionsUsed?.length) {
        notes.push(`Drafted from the positions already served: ${result.positionsUsed.join(' and ')}.`);
      }
      if (result.docketedDates) {
        notes.push(`${result.docketedDates} timetable date${result.docketedDates === 1 ? '' : 's'} added to your docket.`);
      }
      if (result.cautions?.length) notes.push(...result.cautions);
      setGenNotice(notes.length > 0 ? notes.join(' ') : null);
      void employment.refresh();
      refreshDraftHistory();
    } else {
      setGenNotice(null);
      setGenError(result.error ?? 'Generation failed. Check that at least one legal issue is approved.');
    }
  };

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top Bar ──────────────────────────────────────────────── */}
      <header
        style={{
          background: navy,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          height: 64,
        }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a
            href="#/"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
            aria-label="DemandPay Starling home"
          >
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span
            style={{
              marginLeft: 14,
              paddingLeft: 16,
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              fontFamily: serif,
              fontSize: 15,
              color: '#cfd6e0',
            }}
          >
            <b style={{ color: '#fff' }}>Starling</b> &middot; Employment Law
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a
            href="#/"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            My Cases
          </a>
        </nav>
      </header>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main
        id="main-content"
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '20px 28px 60px',
        }}
      >
        {/* Back link */}
        <a
          href="#/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            color: muted,
            fontSize: 13.5,
            marginBottom: 16,
            textDecoration: 'none',
          }}
          onClick={(e) => { e.preventDefault(); handleNav('#/'); }}
        >
          &larr; My Cases
        </a>

        {/* Recent files: the last few matters, one click apart. Each link
            resumes exactly where you left that file. */}
        {(() => {
          let recents: Array<{ id: string; label: string }> = [];
          try {
            const raw = localStorage.getItem('starling.recentMatters');
            recents = raw ? (JSON.parse(raw) as Array<{ id: string; label: string }>) : [];
          } catch { /* convenience only */ }
          const others = recents.filter(r => r.id !== resumeSid).slice(0, 5);
          if (others.length === 0) return null;
          return (
            <span style={{ marginLeft: 18, fontSize: 12.5, color: muted }}>
              Recent:{' '}
              {others.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ' · '}
                  <a
                    href={`#/matter-detail/${r.id}`}
                    onClick={(e) => { e.preventDefault(); handleNav(`#/matter-detail/${r.id}`); }}
                    style={{ color: navy, fontWeight: 600, textDecoration: 'none' }}
                  >
                    {r.label}
                  </a>
                </span>
              ))}
            </span>
          );
        })()}

        {/* ── Matter Header ─────────────────────────────────────── */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '22px 26px' }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <h1 style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: navy, margin: 0 }}>
                {matter!.name}{' '}
                {editingFileNumber ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <input
                      autoFocus
                      value={fileNumberDraft}
                      onChange={(e) => setFileNumberDraft(e.target.value)}
                      placeholder="Your file number"
                      onKeyDown={(e) => { if (e.key === 'Enter') { void employment.saveFileNumber(fileNumberDraft.trim()).then(() => setEditingFileNumber(false)); } if (e.key === 'Escape') setEditingFileNumber(false); }}
                      style={{ fontSize: 12.5, fontFamily: sans, padding: '3px 7px', border: `1px solid ${border}`, borderRadius: 2, width: 150 }}
                    />
                    <button onClick={() => { void employment.saveFileNumber(fileNumberDraft.trim()).then(() => setEditingFileNumber(false)); }}
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: navy, color: '#fff', padding: '4px 9px', borderRadius: 2, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingFileNumber(false)}
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: 'none', color: muted, cursor: 'pointer' }}>Cancel</button>
                  </span>
                ) : (
                  <span style={{ fontSize: 12.5, color: muted, marginLeft: 4, fontFamily: sans, fontWeight: 400 }}>
                    {employment.firmFileNumber ? `File ${employment.firmFileNumber}` : `Matter ${matter!.number}`}
                    <button
                      onClick={() => { setFileNumberDraft(employment.firmFileNumber ?? ''); setEditingFileNumber(true); }}
                      title="Set your firm's file number"
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: 'none', color: orange, cursor: 'pointer', marginLeft: 6, padding: 0 }}
                    >
                      {employment.firmFileNumber ? 'edit' : 'add file number'}
                    </button>
                  </span>
                )}
              </h1>
              {!employment.attribution.openedByMe && employment.attribution.openedBy && (
                <div style={{ fontSize: 12, color: muted, fontFamily: sans, marginTop: 3 }}>
                  Opened by {employment.attribution.openedBy}
                  {employment.attribution.lastModifiedByName && employment.attribution.lastModifiedByName !== employment.attribution.openedBy
                    ? ` · last updated by ${employment.attribution.lastModifiedByName}` : ''}
                </div>
              )}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13,
                fontWeight: 600,
                color: statusColour,
                background: statusBg,
                border: `1px solid ${border}`,
                padding: '6px 12px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <StatusDot colour={statusColour} />
              {statusLabel}
            </span>
          </div>

          {/* Facts row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0,
              marginTop: 18,
              borderTop: `1px solid ${border}`,
              paddingTop: 16,
            }}
          >
            {employment.stage && <FactItem label="Stage" value={employment.stage.label} valueColour={navy} />}
            <FactItem label="Client" value={matter!.client} />
            <FactItem label="Employer" value={matter!.employer} />
            {matter!.dates.termination && <FactItem label="Terminated" value={matter!.dates.termination} />}
            {matter!.dates.start && <FactItem label="Start date" value={matter!.dates.start} />}
            {matter!.dates.limitation && <FactItem label="Limitation" value={matter!.dates.limitation} isLast />}
            {!matter!.dates.limitation && !matter!.dates.start && <FactItem label="" value="" isLast />}
          </div>

          {digest && (
            <div role="status" style={{ display: 'flex', alignItems: 'baseline', gap: 12, background: '#f4f6fa', border: `1px solid ${border}`, padding: '10px 14px', marginTop: 12, fontSize: 13, color: ink }}>
              <span>{digest}</span>
              <button
                onClick={() => setDigest(null)}
                aria-label="Dismiss the summary of what changed"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: 0 }}
              >
                Got it
              </button>
            </div>
          )}

          {/* Waiting state: park the file on someone else's desk, and get
              it back automatically when the wait outruns the nudge window. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Waiting on</span>
            <select
              value={employment.waiting?.who ?? ''}
              onChange={e => { void setWaitingOn(e.target.value); }}
              aria-label="Who this file is waiting on"
              style={{ fontFamily: sans, fontSize: 13, padding: '6px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
            >
              <option value="">Nobody: this file needs the firm</option>
              <option value="client">The client</option>
              <option value="opposing_counsel">Opposing counsel</option>
              <option value="tribunal">The court or tribunal</option>
              <option value="partner">Partner review</option>
            </select>
            {employment.waiting && (
              <span style={{ fontSize: 12.5, color: employment.waiting.nudged ? '#b8860b' : muted }}>
                {employment.waiting.nudged
                  ? `Waiting ${employment.waiting.days} days: past the ${employment.waiting.nudgeAfterDays}-day window, so it is back on your needs-me list to follow up.`
                  : `Since ${employment.waiting.since.slice(0, 10)} (${employment.waiting.days} ${employment.waiting.days === 1 ? 'day' : 'days'}). Off your needs-me list; back automatically after ${employment.waiting.nudgeAfterDays} days.`}
              </span>
            )}
            {waitingMsg && <span role="status" style={{ fontSize: 12.5, color: ink }}>{waitingMsg}</span>}
          </div>

          <NextStepsPanel steps={employment.nextSteps} onGoTo={(tab) => setActiveTab(tab as TabKey)} />

          {/* ── Tabs ─────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              marginTop: 18,
              borderBottom: `1px solid ${border}`,
            }}
            role="tablist"
          >
            {dynamicTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  fontFamily: sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: activeTab === tab.key ? navy : muted,
                  background: 'transparent',
                  border: 'none',
                  padding: '13px 20px',
                  cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab.key ? orange : 'transparent'}`,
                  marginBottom: -1,
                }}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`panel-${tab.key}`}
              >
                {tab.label}
                {tab.badge != null && (
                  <span
                    style={{
                      fontSize: 11,
                      background: activeTab === tab.key ? orange : cream,
                      border: `1px solid ${activeTab === tab.key ? orange : border}`,
                      color: activeTab === tab.key ? '#fff' : muted,
                      borderRadius: 2,
                      padding: '0 6px',
                      marginLeft: 6,
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab Panels ────────────────────────────────────────── */}

          {/* Issues Found */}
          {activeTab === 'issues' && (
            <IssuesTab employment={employment} issues={matter!.issues} sessionId={sessionId} />
          )}

          {/* Documents */}
          {activeTab === 'docs' && (
            <div id="panel-docs" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* One-time pointer for a just-created file: says what to do
                  next and what will happen, then dismisses for good. */}
              {showDocsHint && (
                <div
                  role="status"
                  style={{
                    background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2,
                    padding: '14px 18px', marginBottom: 16,
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: ink, marginBottom: 4 }}>
                      Start here: add {String(employment.data?.intake?.client_first_name ?? 'the client')}&rsquo;s documents
                    </div>
                    <div style={{ fontSize: 13, color: ink, lineHeight: 1.6 }}>
                      Upload the termination letter, employment agreement, ROE, pay records and severance offer.
                      Starling reads each one and proposes the facts it finds, quoting the line it took them from.
                      You review each proposal and choose what to apply, so nothing reaches the file until you say so.
                      Then run the analysis from the Issues tab.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDocsHint(false)}
                    style={{
                      background: 'none', border: 'none', color: muted, cursor: 'pointer',
                      fontSize: 12.5, fontFamily: sans, padding: '2px 4px', flexShrink: 0,
                    }}
                    aria-label="Dismiss this tip"
                  >
                    Got it
                  </button>
                </div>
              )}

              {/* Generated documents and their lifecycle */}
              <GeneratedDocsPanel
                docs={employment.generatedDocuments}
                onSetStatus={employment.setDocumentStatus}
                onOpen={(dt) => {
                  const entry = draftHistory.find(d => d.docType === dt);
                  if (!entry) return false;
                  const card = DOCTYPE_TO_DRAFT[dt];
                  // Go through openDraftCard so the shared amount and its
                  // prefill note reset: opening the demand letter from
                  // Documents must not carry the claim's figure into the
                  // Demand Amount field.
                  if (card) openDraftCard(card);
                  setGeneratedHtml(entry.html);
                  setActiveTab('draft');
                  window.scrollTo(0, 0);
                  return true;
                }}
                downloadHref={(dt) => {
                  const slug = downloadSlugFor(dt);
                  if (!slug || !sessionId) return null;
                  // The variant picked on the Draft tab travels with the
                  // download; other types render on their default template.
                  const variant = dt === selectedTemplateDocType && activeVariant
                    ? `?templateVariantId=${encodeURIComponent(activeVariant.variantId)}` : '';
                  return `/api/employment/${sessionId}/download/${slug}${variant}`;
                }}
                renderExtra={approvalsEnabled && sessionId
                  ? (dt) => (
                      <ReviewLaneControls
                        matterId={sessionId}
                        docType={dt}
                        onApplyFeedback={(text) => {
                          const entry = draftHistory.find(d => d.docType === dt);
                          if (entry) {
                            const card = DOCTYPE_TO_DRAFT[dt];
                            if (card) setSelectedDraft(card);
                            setGeneratedHtml(entry.html);
                            setActiveTab('draft');
                          }
                          setRevising({ source: 'partner', initial: text });
                        }}
                      />
                    )
                  : undefined}
              />

              {/* Uploaded */}
              {matter!.documents.filter(d => d.group === 'uploaded').length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: 14,
                      margin: '4px 0 12px',
                      color: muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: serif,
                    }}
                  >
                    Uploaded documents
                  </h3>
                  {matter!.documents.filter(d => d.group === 'uploaded').map(doc => (
                    <DocRow key={doc.id} doc={{ ...doc, actions: [] }} />
                  ))}
                </>
              )}

              {/* Generated */}
              {matter!.documents.filter(d => d.group === 'generated').length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: 14,
                      margin: '22px 0 12px',
                      color: muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: serif,
                    }}
                  >
                    Generated by Starling
                  </h3>
                  {matter!.documents.filter(d => d.group === 'generated').map(doc => (
                    <DocRow key={doc.id} doc={{ ...doc, actions: [] }} />
                  ))}
                </>
              )}

              {/* What Starling has actually read on this matter. The legacy
                  list above only knows briefing-era uploads, so this is the
                  record that stops the tab claiming "no documents" after
                  three reads. */}
              {(employment.data?.documentExtractions ?? []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: '22px 0 12px', color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: serif }}>
                    Read on this matter
                  </h3>
                  {(employment.data?.documentExtractions ?? []).map((ext, i) => (
                    <div key={ext.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f0ede8', fontSize: 13, color: ink }}>
                      <b>{ext.filename}</b>
                      <span style={{ color: muted }}>{String(ext.documentType).replace(/_/g, ' ')}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: ext.appliedAt ? '#1a7a3a' : '#b8860b' }}>
                        {ext.appliedAt ? 'Facts applied to the intake' : 'Awaiting your review below'}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {matter!.documents.length === 0 && (employment.data?.documentExtractions ?? []).length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>
                  No documents read yet. Upload below, or drop the case file folder; every read proposes facts for your review.
                </div>
              )}

              {/* One entry point. Every document dropped here is read and
                  its facts proposed for review; the deep read (summary,
                  checks, questions, comparison) is an option on the same
                  surface, not a second lane. */}
              <CaseFileDropPanel
                classifyDocument={employment.classifyDocument}
                extractParsed={employment.extractParsed}
                getCaseReview={employment.getCaseReview}
                applyChronology={employment.applyChronology}
                generateCaseSynthesis={employment.generateCaseSynthesis}
                applyExtraction={employment.applyExtraction}
                analyzeDocument={employment.analyzeDocument}
                onDone={employment.refresh}
              />

              {/* Paste lane: call notes and copied text have no file to drop */}
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginTop: 16 }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Paste text
                </div>
                <div style={{ fontSize: 12.5, color: muted, marginBottom: 8 }}>
                  Call notes or copied text with no file to drop are read the same way; every fact still comes back for your review.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={uploadKind}
                    onChange={e => setUploadKind(e.target.value)}
                    aria-label="Document type"
                    style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                  >
                    <option value="employment_agreement">Employment agreement</option>
                    <option value="termination_letter">Termination letter</option>
                    <option value="demand_letter">Demand letter (ours)</option>
                    <option value="roe">Record of Employment</option>
                    <option value="t4">T4</option>
                    <option value="pay_stub">Pay stub</option>
                    <option value="correspondence">Correspondence</option>
                    <option value="performance_review">Performance review</option>
                    <option value="policy_document">Policy document</option>
                    <option value="other">Other</option>
                  </select>
                  <span style={{ fontSize: 12.5, color: muted }}>&ldquo;Correspondence&rdquo; fits call notes.</span>
                </div>
                <div style={{ marginTop: 10 }}>
                    <textarea
                      value={extractPasteText}
                      onChange={e => setExtractPasteText(e.target.value)}
                      rows={6}
                      placeholder="Paste the text here."
                      aria-label="Paste text to read facts from"
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                    />
                    <button
                      onClick={() => { void extractFromPaste(); }}
                      disabled={extracting || extractPasteText.trim().length < 40}
                      style={{ marginTop: 8, background: extracting || extractPasteText.trim().length < 40 ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, border: 'none', cursor: extracting || extractPasteText.trim().length < 40 ? 'not-allowed' : 'pointer', fontFamily: sans }}
                    >
                      {extracting ? 'Reading\u2026' : 'Read the pasted text'}
                    </button>
                    {extractPasteText.trim().length < 40 && !extracting && (
                      <span style={{ fontSize: 12.5, color: muted, marginLeft: 10 }}>Paste at least a few sentences first.</span>
                    )}
                  </div>
                {extractPasteMsg && (
                  <div role="status" style={{ marginTop: 10, fontSize: 13, color: ink, background: '#faf8f5', border: `1px solid ${border}`, padding: '10px 12px' }}>
                    {extractPasteMsg}
                  </div>
                )}
                {extractError && (
                  <div style={{ marginTop: 12, padding: '10px 14px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13 }}>
                    {extractError}
                  </div>
                )}
                {(lastExtraction || (employment.data?.documentExtractions ?? []).some(e => !e.appliedAt && e.documentType !== 'collective_agreement')) && (
                  <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginTop: 16, borderTop: `2px solid ${border}`, paddingTop: 14 }}>
                    Proposed facts awaiting your review
                  </div>
                )}
                {lastExtraction && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
                      Extracted from {lastExtraction.filename}
                    </div>
                    {lastExtraction.keyFindings.length > 0 && (
                      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: ink, lineHeight: 1.7 }}>
                        {lastExtraction.keyFindings.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    )}
                    {lastExtraction.documentType === 'collective_agreement' ? (
                      <div style={{ fontSize: 12.5, color: muted }}>
                        Collective agreement fields apply to the grievance clocks automatically; review them on the Intake tab.
                      </div>
                    ) : (
                      <ExtractionReviewPanel
                        extraction={lastExtraction}
                        intake={(employment.data?.intake ?? {}) as Record<string, unknown>}
                        onApply={employment.applyExtraction}
                        onDone={employment.refresh}
                      />
                    )}
                  </div>
                )}
                {/* Stored extractions from earlier sessions that were never applied */}
                {!lastExtraction && (employment.data?.documentExtractions ?? [])
                  .map((ext, i) => ({ ext, key: ext.id ?? `idx-${i}` }))
                  .filter(({ ext }) => !ext.appliedAt && ext.documentType !== 'collective_agreement'
                    && Object.values(ext.extractedFields).some(f => f && f.value !== null && f.value !== ''))
                  .slice(-6)
                  .map(({ ext, key }) => (
                    <div key={key} style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
                        Extracted earlier from {ext.filename} — not yet applied
                      </div>
                      <ExtractionReviewPanel
                        extraction={{ ...ext, id: key }}
                        intake={(employment.data?.intake ?? {}) as Record<string, unknown>}
                        onApply={employment.applyExtraction}
                        onDone={employment.refresh}
                      />
                    </div>
                  ))}

              </div>

              {/* Saved deep reads: summaries, checks and answers, list only */}
              {sessionId && <DocAnalysisPanel matterId={sessionId} showComposer={false} />}
            </div>
          )}

          {/* Draft */}
          {activeTab === 'draft' && (
            <div id="panel-draft" role="tabpanel" style={{ paddingTop: 22 }}>
              {!selectedDraft && (
                <p style={{ fontSize: 13.5, color: muted, marginBottom: 16 }}>
                  Pick a document. It opens in its own workspace: templates and styles for that document,
                  the drafting options, the draft itself, and the revision tools, all in one place.
                </p>
              )}
              {/* Stage first: the two or three documents this file's stage
                  calls for, plus anything already in flight. Every other
                  card stays exactly where it always was, below. */}
              {!selectedDraft && !draftFilter.trim() && (() => {
                const stage = employment.stage?.stage;
                const STAGE_CARDS: Record<string, string[]> = {
                  intake: ['severance', 'demand'],
                  assessment: ['severance', 'demand'],
                  demand: ['demand', 'rebuttal', 'counter'],
                  negotiation: ['counter', 'rebuttal', 'mediation'],
                  proceedings: ['soc', 'mediation', 'confbrief'],
                  resolution: ['minutes'],
                };
                const inFlight = employment.generatedDocuments
                  .map(d => DOCTYPE_TO_DRAFT[d.docType]).filter(Boolean) as string[];
                const forNow = [...new Set([...inFlight, ...(stage ? STAGE_CARDS[stage] ?? [] : [])])].slice(0, 4);
                const cards = forNow.map(id => DEMO_DRAFT_TYPES.find(d => d.id === id)).filter(Boolean) as typeof DEMO_DRAFT_TYPES;
                if (cards.length === 0) return null;
                return (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: orange, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 }}>
                      For this file now{employment.stage ? ` · ${employment.stage.label}` : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                      {cards.map(dt => (
                        <div
                          key={`now-${dt.id}`}
                          onClick={() => openDraftCard(dt.id)}
                          style={{ background: '#fff', border: `1px solid ${orange}`, padding: 18, cursor: 'pointer', boxShadow: `0 2px 0 ${orange}` }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDraftCard(dt.id); } }}
                        >
                          <div style={{ fontFamily: serif, fontSize: 15.5, fontWeight: 600, color: navy, marginBottom: 4 }}>{draftDisplayTitle(dt.id)}</div>
                          <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.5 }}>
                            {inFlight.includes(dt.id) ? 'A draft is already on file: open it, revise it, or regenerate.' : draftDisplayDescription(dt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {selectedDraft && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setSelectedDraft(null); setBuildingTemplate(false); setBuildingStyle(false); }}
                    style={{ fontSize: 13, fontWeight: 600, color: navy, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: sans }}
                  >
                    ← All documents
                  </button>
                  <h2 style={{ fontFamily: serif, fontSize: 22, margin: 0, color: navy }}>
                    {draftDisplayTitle(selectedDraft)}
                  </h2>
                  {generatedHtml && (
                    <div role="tablist" aria-label="Draft or options" style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                      {(['draft', 'options'] as const).map(v => (
                        <button
                          key={v}
                          role="tab"
                          aria-selected={draftView === v}
                          onClick={() => setDraftView(v)}
                          style={{
                            fontSize: 12.5, fontWeight: 600, padding: '7px 16px', fontFamily: sans,
                            background: draftView === v ? navy : '#fff',
                            color: draftView === v ? '#fff' : navy,
                            border: `1px solid ${navy}`, cursor: 'pointer',
                            borderRadius: v === 'draft' ? '2px 0 0 2px' : '0 2px 2px 0',
                          }}
                        >
                          {v === 'draft' ? 'Draft' : 'Options'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* HRTO Form 1 data file — populates the official SmartForm */}
              {selectedDraft === 'schedulea' && (
                <ScheduleAOptions sessionId={sessionId} />
              )}

              {!selectedDraft && (<>
              <input
                type="search"
                value={draftFilter}
                onChange={e => setDraftFilter(e.target.value)}
                placeholder="Filter documents… (e.g. mediation, timetable, offer)"
                aria-label="Filter the document catalogue"
                style={{ width: '100%', maxWidth: 420, fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, marginBottom: 16, boxSizing: 'border-box' as const }}
              />
              {DRAFT_SECTIONS.map(section => {
                // Drafted state and the recommendation come from the matter,
                // not a constant: a day-one file and a file whose SOC went
                // out last month need different advice.
                const draftedCards = new Set(employment.generatedDocuments.map(d => DOCTYPE_TO_DRAFT[d.docType]).filter(Boolean));
                const nextActions = (employment.nextSteps ?? []).map(n => n.action.toLowerCase()).join(' | ');
                const recommendedCard =
                  nextActions.includes('demand letter') ? 'demand'
                  : nextActions.includes('statement of claim') ? 'soc'
                  : nextActions.includes('mediation brief') ? 'mediation'
                  : nextActions.includes('severance offer') ? 'severance'
                  : nextActions.includes('counter-offer') ? 'counter'
                  : null;
                const sectionCards = DEMO_DRAFT_TYPES.filter(dt => dt.section === section)
                  .filter(dt => !draftFilter.trim()
                    || `${dt.title} ${dt.description ?? ''}`.toLowerCase().includes(draftFilter.trim().toLowerCase()))
                  .map(dt => ({ ...dt, recommended: dt.id === recommendedCard, alreadyDrafted: draftedCards.has(dt.id) }));
                if (sectionCards.length === 0) return null;
                return (
                <div key={section} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 }}>
                    {section}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    {sectionCards.map(dt => (
                      <div
                        key={dt.id}
                        onClick={() => openDraftCard(dt.id)}
                        style={{
                          background: '#fff',
                          border: `1px solid ${selectedDraft === dt.id || dt.recommended ? orange : border}`,
                          padding: 18,
                          cursor: 'pointer',
                          boxShadow: selectedDraft === dt.id || dt.recommended ? `0 2px 0 ${orange}` : 'none',
                        }}
                        role="radio"
                        aria-checked={selectedDraft === dt.id}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDraftCard(dt.id); } }}
                      >
                        {dt.recommended && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: '#fff',
                              background: orange,
                              padding: '2px 7px',
                              borderRadius: 2,
                              letterSpacing: '0.04em',
                            }}
                          >
                            RECOMMENDED NEXT
                          </span>
                        )}
                        <h4 style={{ fontFamily: serif, fontSize: 15.5, fontWeight: 600, color: navy, margin: dt.recommended ? '10px 0 5px' : '0 0 5px' }}>
                          {draftDisplayTitle(dt.id)}
                        </h4>
                        <p style={{ fontSize: 12.5, color: dt.alreadyDrafted ? green : muted, margin: 0 }}>
                          {dt.alreadyDrafted && (
                            <>
                              <StatusDot colour={green} size={6} />{' '}
                              <b style={{ color: green }}>Drafted · </b>
                            </>
                          )}
                          {draftDisplayDescription(dt)}
                        </p>
                        <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>{dt.cost}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );})}
              </>)}

              {selectedDraft === 'timetable' && showOptions && (
                <TimetablePackageOptions
                  ttRows={ttRows} setTtRows={setTtRows}
                  pkgProcedure={pkgProcedure} setPkgProcedure={setPkgProcedure}
                  pkgProfiles={pkgProfiles} pkgStyleIds={pkgStyleIds} setPkgStyleIds={setPkgStyleIds}
                  teachingDocType={teachingDocType} setTeachingDocType={setTeachingDocType}
                  refreshPkgProfiles={refreshPkgProfiles}
                  pkgAffidavit={pkgAffidavit} setPkgAffidavit={setPkgAffidavit}
                  pkgDeponent={pkgDeponent} setPkgDeponent={setPkgDeponent}
                  pkgCapacity={pkgCapacity} setPkgCapacity={setPkgCapacity}
                  pkgBasis={pkgBasis} setPkgBasis={setPkgBasis} pkgSource={pkgSource} setPkgSource={setPkgSource}
                  pkgBusy={pkgBusy} pkgResult={pkgResult} generatePackage={generatePackage}
                  profileDisplayName={profile.displayName ?? ''}
                />
              )}

              {/* Court-form inputs: the deterministic forms are data, and
                  these fields are that data */}
              {selectedDraft && COURT_FORM_FIELDS[selectedDraft] && showOptions && (
                <CourtFormOptions selectedDraft={selectedDraft} courtFields={courtFields} setCourtFields={setCourtFields} />
              )}
              {/* Pronouns live on the client file, but they change every line
                  of the letter, so the choice belongs where the letter is
                  written too. Parked on the Intake tab alone, the pilot went
                  looking for it here and did not find it. */}
              {selectedDraft && selectedDraft !== 'timetable' && showOptions && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                  <span style={{ fontSize: 12.5, color: muted, fontWeight: 600 }}>How this document refers to the client</span>
                  <select
                    value={String((employment.data?.intake as Record<string, unknown> | undefined)?.client_pronouns ?? '')}
                    onChange={async e => {
                      const intake = { ...(employment.data?.intake ?? {}), client_pronouns: e.target.value || undefined };
                      await employment.saveIntake(intake as Record<string, unknown>);
                      void employment.refresh();
                    }}
                    aria-label="How this document refers to the client"
                    style={{ fontFamily: sans, fontSize: 13.5, padding: '8px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                  >
                    <option value="">Not set (uses the client's name)</option>
                    <option value="she">she / her</option>
                    <option value="he">he / him</option>
                    <option value="they">they / them</option>
                    <option value="name">Name only, no pronouns</option>
                  </select>
                  <span style={{ fontSize: 11.5, color: muted }}>Saved to the client file, and used by every document on this matter.</span>
                </div>
              )}

              {(selectedDraft === 'mediation' || selectedDraft === 'demand') && showOptions && readiness.length > 0 && (
                <ReadinessNotice readiness={readiness} setActiveTab={setActiveTab} />
              )}

              {selectedDraft === 'soc' && showOptions && (
                <SocPleadingOptions
                  employment={employment}
                  sessionId={sessionId}
                  socSourceInputRef={socSourceInputRef}
                  rebuttalSaving={rebuttalSaving}
                  attachRebuttalFile={attachRebuttalFile}
                  socNodes={socNodes}
                  setSocOverride={setSocOverride}
                />
              )}

              {selectedDraft === 'soc' && showOptions && socOutline.length > 0 && (
                <SocOutlinePanel
                  sections={socOutline}
                  draftFacts={draftSocFacts}
                  approveSection={approveSocSection}
                  saveSection={saveSocSection}
                  clearSection={clearSocSection}
                  busyId={socSectionBusyId}
                />
              )}

              {selectedDraft === 'sjfactum' && showOptions && (
                <FactumArgumentOptions
                  sections={factumSections}
                  setFactumOverride={setFactumOverride}
                  addCustomSection={addCustomSection}
                  removeCustomSection={removeCustomSection}
                />
              )}

              {selectedDraft === 'sjfactum' && showOptions && (
                <FactumOutlinePanel
                  sections={factumOutline}
                  draftSection={draftFactumSection}
                  draftAll={draftAllFactumSections}
                  approveSection={approveFactumSection}
                  saveSection={saveFactumSection}
                  clearSection={clearFactumSection}
                  busyId={factumDraftBusyId}
                  draftingAll={factumDraftingAll}
                />
              )}

              {selectedDraft === 'reply' && showOptions && (
                <ReplyOptions
                  employment={employment}
                  sessionId={sessionId}
                  isSmallClaimsMatter={isSmallClaimsMatter}
                  defenceInputRef={defenceInputRef}
                  claimSourceInputRef={claimSourceInputRef}
                  rebuttalSaving={rebuttalSaving}
                  attachRebuttalFile={attachRebuttalFile}
                  attachRebuttalText={attachRebuttalText}
                  defencePasting={defencePasting} setDefencePasting={setDefencePasting}
                  defenceText={defenceText} setDefenceText={setDefenceText}
                  runReplyComparison={runReplyComparison}
                  comparing={comparing} comparisonMsg={comparisonMsg}
                  replySelections={replySelections} setReplySelections={setReplySelections}
                />
              )}

              {selectedDraft === 'rebuttal' && showOptions && (
                <RebuttalOptions
                  sessionId={sessionId}
                  rebuttalSource={employment.rebuttalSource}
                  rebuttalFeedback={employment.rebuttalFeedback}
                  refreshEmployment={() => { void employment.refresh(); }}
                  rebuttalInputRef={rebuttalInputRef}
                  feedbackInputRef={feedbackInputRef}
                  rebuttalSaving={rebuttalSaving}
                  rebuttalPasting={rebuttalPasting}
                  setRebuttalPasting={setRebuttalPasting}
                  rebuttalText={rebuttalText}
                  setRebuttalText={setRebuttalText}
                  rebuttalError={rebuttalError}
                  feedbackPasting={feedbackPasting}
                  setFeedbackPasting={setFeedbackPasting}
                  feedbackText={feedbackText}
                  setFeedbackText={setFeedbackText}
                  attachRebuttalFile={attachRebuttalFile}
                  attachRebuttalText={attachRebuttalText}
                />
              )}
              {selectedDraft && selectedDraft !== 'timetable' && showOptions && renderDirection('document')}

              {/* Generation options */}
              {selectedDraft && !COURT_FORM_FIELDS[selectedDraft] && showOptions && (
                <GenerationOptions
                  selectedDraft={selectedDraft}
                  genTone={genTone} setGenTone={setGenTone}
                  genDemandAmount={genDemandAmount} setGenDemandAmount={setGenDemandAmount}
                  dlDeadlineDays={dlDeadlineDays} setDlDeadlineDays={setDlDeadlineDays}
                  genProcedure={genProcedure} setGenProcedure={setGenProcedure}
                  genCourtLocation={genCourtLocation} setGenCourtLocation={setGenCourtLocation}
                  amountPrefilled={amountPrefilled} setAmountPrefilled={setAmountPrefilled}
                />
              )}


              {selectedDraft === 'demand' && showOptions && (
                <DemandSourcesOptions
                  storedSources={storedSources}
                  dlSourceIds={dlSourceIds} setDlSourceIds={setDlSourceIds}
                  dlUploadKind={dlUploadKind} setDlUploadKind={setDlUploadKind}
                  dlSourceInputRef={dlSourceInputRef}
                  attachBriefSource={attachBriefSource}
                  sourceParsing={sourceParsing} sourceError={sourceError}
                  sessionId={sessionId}
                  refreshEmployment={() => { void employment.refresh(); }}
                />
              )}

              {selectedDraft === 'demand' && showOptions && (
                <DemandFiguresOptions
                  dlRecipient={dlRecipient} setDlRecipient={setDlRecipient}
                  dlHeads={dlHeads} setDlHeads={setDlHeads}
                  dlHeadsTouched={dlHeadsTouched} setDlHeadsTouched={setDlHeadsTouched}
                  dlPaid={dlPaid} setDlPaid={setDlPaid}
                  dlMitigation={dlMitigation} setDlMitigation={setDlMitigation}
                  genDemandAmount={genDemandAmount} setGenDemandAmount={setGenDemandAmount}
                  refreshEmployment={() => { void employment.refresh(); }}
                />
              )}

              {selectedDraft === 'mediation' && showOptions && (
                <MediationSourcesOptions
                  generatedDocuments={employment.generatedDocuments}
                  includeGenDemand={includeGenDemand} setIncludeGenDemand={setIncludeGenDemand}
                  includeGenSoc={includeGenSoc} setIncludeGenSoc={setIncludeGenSoc}
                  storedSources={storedSources}
                  selectedSourceIds={selectedSourceIds} setSelectedSourceIds={setSelectedSourceIds}
                  removeBriefSource={removeBriefSource}
                  briefSourceInputRef={briefSourceInputRef}
                  attachBriefSource={attachBriefSource}
                  sourceParsing={sourceParsing} sourceError={sourceError}
                />
              )}

              {selectedDraft === 'mediation' && showOptions && mediationOutline.length > 0 && (
                <MediationOutlinePanel
                  sections={mediationOutline}
                  draftSection={draftMediationSection}
                  draftAll={draftAllMediationSections}
                  approveSection={approveMediationSection}
                  saveSection={saveMediationSection}
                  clearSection={clearMediationSection}
                  busyId={mediationDraftBusyId}
                  draftingAll={mediationDraftingAll}
                />
              )}

              {selectedDraft && selectedDraft !== 'timetable' && showOptions && (
                <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 8px' }}>
                  Your firm's way of doing this document
                </div>
              )}
              {selectedDraft === 'soc' && showOptions && (
                <SocPleadingLanguageOptions
                  socTeachInputRef={socTeachInputRef}
                  socImportInputRef={socImportInputRef}
                  teachSocNodes={teachSocNodes}
                  importSocNodes={importSocNodes}
                  socTeachBusy={socTeachBusy}
                  socTeachMsg={socTeachMsg}
                  socLib={socLib}
                  socProposals={socProposals}
                  setSocProposals={setSocProposals}
                  approveSocProposal={approveSocProposal}
                />
              )}
              {selectedDraft === 'sjfactum' && showOptions && (
                <FactumArgumentLanguageOptions
                  factumTeachInputRef={factumTeachInputRef}
                  teachFactumSections={teachFactumSections}
                  factumTeachBusy={factumTeachBusy}
                  factumTeachMsg={factumTeachMsg}
                  factumLib={factumLib}
                  factumProposals={factumProposals}
                  setFactumProposals={setFactumProposals}
                  approveFactumProposal={approveFactumProposal}
                />
              )}

              {/* Firm template for the selected document type. The package
                  card teaches each of its documents separately below. */}
              <TemplateStyleOptions
                selectedDraft={selectedDraft}
                selectedTemplateDocType={selectedTemplateDocType}
                showOptions={showOptions}
                firmTemplates={firmTemplates}
                styleProfiles={styleProfiles}
                variantsForType={variantsForType}
                activeVariant={activeVariant}
                currentTemplate={currentTemplate}
                chosenVariantIdSet={setChosenVariantId}
                templateStatus={templateStatus}
                setTemplateStatus={setTemplateStatus}
                templateInputRef={templateInputRef}
                pendingTemplateFile={pendingTemplateFile}
                setPendingTemplateFile={setPendingTemplateFile}
                pendingTemplateLabel={pendingTemplateLabel}
                setPendingTemplateLabel={setPendingTemplateLabel}
                handleTemplateUpload={handleTemplateUpload}
                buildingTemplate={buildingTemplate}
                setBuildingTemplate={setBuildingTemplate}
                buildingStyle={buildingStyle}
                setBuildingStyle={setBuildingStyle}
                styleProfileId={styleProfileId}
                setStyleProfileId={setStyleProfileId}
              />

              {selectedDraft && selectedDraft !== 'timetable' && showOptions && (
                <div>
                <button
                  onClick={() => void runGeneration()}
                  disabled={generating || blockedReason !== null}
                  style={{
                    // A disabled button has to LOOK disabled. This one stayed
                    // orange with a pointer cursor whenever the amount was
                    // missing, so it read as working and did nothing: the
                    // pilot clicked it and reported a dead button.
                    background: generating || blockedReason ? '#b0b0b0' : orange,
                    color: '#fff',
                    fontSize: 13.5,
                    fontWeight: 600,
                    padding: '11px 18px',
                    borderRadius: 2,
                    border: 'none',
                    cursor: generating || blockedReason ? 'not-allowed' : 'pointer',
                    marginTop: 8,
                    fontFamily: sans,
                  }}
                >
                  {generating ? 'Generating...' : 'Generate Draft'}
                </button>
                {blockedReason && !generating && (
                  <div style={{ fontSize: 12.5, color: amber, marginTop: 7, fontWeight: 600 }}>
                    {blockedReason}
                  </div>
                )}
                </div>
              )}

              {/* A draft prepared outside Starling can be adopted instead of
                  generated; from there the feedback loop treats it as the
                  version of record. */}
              {showOptions && !generatedHtml && selectedDraft && selectedDraft !== 'timetable' && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
                  <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                    Already drafted outside Starling?
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
                    Upload the Word file or paste the text and that draft becomes the version on file for this document.
                    Starling can then apply the client&rsquo;s feedback to it: every proposed change comes back to you for approval before anything is touched.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      ref={adoptInputRef}
                      type="file"
                      accept={TEXT_UPLOAD_ACCEPT}
                      style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        const dt = selectedDraft ? DRAFT_TO_DOCTYPE[selectedDraft] : undefined;
                        if (f && dt) void replaceDraftWithUpload(f, dt);
                        e.target.value = '';
                      }}
                      aria-label="Upload the draft prepared outside Starling"
                    />
                    <button
                      onClick={() => adoptInputRef.current?.click()}
                      disabled={replacing}
                      style={{ background: '#fff', color: navy, border: `1px solid ${navy}`, fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, cursor: replacing ? 'not-allowed' : 'pointer', fontFamily: sans }}
                    >
                      {replacing ? 'Reading…' : 'Upload the Word file'}
                    </button>
                    <button
                      onClick={() => setAdoptPasting(v => !v)}
                      style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                    >
                      Paste the text
                    </button>
                  </div>
                  {adoptPasting && (
                    <div style={{ marginTop: 10 }}>
                      <textarea
                        value={adoptText}
                        onChange={e => setAdoptText(e.target.value)}
                        rows={6}
                        placeholder="Paste the full draft here."
                        aria-label="Paste the draft prepared outside Starling"
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                      />
                      <button
                        onClick={() => {
                          const dt = selectedDraft ? DRAFT_TO_DOCTYPE[selectedDraft] : undefined;
                          if (dt && adoptText.trim()) { void replaceDraftWithPaste(adoptText, dt); setAdoptText(''); setAdoptPasting(false); }
                        }}
                        disabled={replacing || !adoptText.trim()}
                        style={{ marginTop: 8, background: replacing || !adoptText.trim() ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: replacing || !adoptText.trim() ? 'not-allowed' : 'pointer', fontFamily: sans }}
                      >
                        {replacing ? 'Saving…' : 'Save as the version on file'}
                      </button>
                      {!adoptText.trim() && !replacing && (
                        <span style={{ fontSize: 12.5, color: muted, marginLeft: 10 }}>Paste the draft first.</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {genNotice && (
                <div role="status" style={{ background: '#e7f6ec', border: `1px solid ${green}`, borderRadius: 2, padding: '10px 14px', fontSize: 12.5, color: ink, marginBottom: 12 }}>
                  {genNotice}
                </div>
              )}
              {genError && (
                <div style={{ marginTop: 12, padding: '12px 16px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13.5 }}>
                  {genError}
                </div>
              )}

              {/* Document Preview */}
              {showDraft && generatedHtml && draftIsStale && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#fdf0dd', border: `1px solid ${amber}`, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: ink }}>
                  <span>The file changed after this draft was generated: the intake now says more than the document does.</span>
                  <button
                    onClick={() => void runGeneration()}
                    disabled={generating || blockedReason !== null}
                    style={{ background: generating || blockedReason ? '#b0b0b0' : navy, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, border: 'none', cursor: generating || blockedReason ? 'not-allowed' : 'pointer', fontFamily: sans }}
                  >
                    {generating ? 'Regenerating\u2026' : 'Regenerate from the updated file'}
                  </button>
                  {blockedReason && !generating && <span style={{ fontSize: 12.5, color: amber }}>{blockedReason}</span>}
                  <span style={{ fontSize: 12, color: muted }}>The current draft is kept in this document{'\u2019'}s history.</span>
                </div>
              )}
              {showDraft && generatedHtml && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ fontFamily: serif, fontSize: 17, fontWeight: 600, color: navy, margin: 0 }}>
                      Generated Draft
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setDraftView('options')}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Options
                      </button>
                      <button
                        onClick={() => setRevising({ source: 'client' })}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Apply feedback
                      </button>
                      <button
                        onClick={() => setRevising({ source: 'lawyer' })}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Redraft a section
                      </button>
                      <button
                        onClick={() => replaceInputRef.current?.click()}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        {replacing ? 'Reading…' : 'Upload my edited version'}
                      </button>
                      <button
                        onClick={() => { setPasting(v => !v); setPastedText(''); }}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        {pasting ? 'Cancel paste' : 'Paste my version'}
                      </button>
                      <a
                        href={`/api/employment/${sessionId}/download/${DRAFT_TO_DOWNLOAD[selectedDraft ?? ''] ?? 'demand-letter'}${activeVariant ? `?templateVariantId=${encodeURIComponent(activeVariant.variantId)}` : ''}`}
                        download
                        style={{
                          background: navy, color: '#fff',
                          fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2,
                          textDecoration: 'none', display: 'inline-block', fontFamily: sans,
                        }}
                      >
                        Download DOCX
                      </a>
                    </div>
                  </div>
                  {/* Lifecycle status, right where the draft is generated (also
                      manageable on the Documents tab). Sent/Filed start the
                      downstream ticklers (e.g. SOC sent -> Defence due). */}
                  {(() => {
                    const dt = DRAFT_TO_DOCTYPE[selectedDraft ?? ''] ?? '';
                    const cur = employment.generatedDocuments.find(d => d.docType === dt);
                    const today = new Date().toISOString().slice(0, 10);
                    const revisedAt = employment.data?.intakeRevisedAt;
                    const stale = Boolean(revisedAt && cur?.generatedAt && cur.generatedAt < revisedAt);
                    return (
                      <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: muted }}>Status:</span>
                        {(['reviewed', 'sent', 'filed'] as const).map(next => (
                          <button
                            key={next}
                            onClick={() => void employment.setDocumentStatus(dt, next, (next === 'sent' || next === 'filed') ? today : undefined)}
                            disabled={cur?.status === next}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans,
                              background: cur?.status === next ? navy : '#fff',
                              color: cur?.status === next ? '#fff' : navy,
                              border: `1px solid ${cur?.status === next ? navy : border}`,
                              cursor: cur?.status === next ? 'default' : 'pointer',
                              textTransform: 'capitalize' as const,
                            }}
                          >
                            {cur?.status === next ? `✓ ${next}` : `Mark ${next}`}
                          </button>
                        ))}
                        {cur?.status && cur.status !== 'draft' && (
                          <span style={{ fontSize: 11.5, color: green, fontWeight: 600 }}>
                            {cur.status}{cur.statusDate ? ` · ${cur.statusDate}` : ''}
                          </span>
                        )}
                      </div>
                      {approvalsEnabled && dt && cur && sessionId && <ReviewLaneControls matterId={sessionId} docType={dt} onApplyFeedback={(text) => setRevising({ source: 'partner', initial: text })} />}
                      {pasting && dt && (
                        <div style={{ marginTop: 12, background: '#fff', border: `1px solid ${border}`, padding: '14px 16px' }}>
                          <div style={{ fontSize: 13, color: ink, marginBottom: 6 }}>
                            Paste your revised document. It becomes the version on file; the current draft is kept in history.
                          </div>
                          <textarea
                            value={pastedText}
                            onChange={e => setPastedText(e.target.value)}
                            placeholder="Paste the full text of your version here"
                            style={{ width: '100%', minHeight: 200, fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box', resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                            <button
                              disabled={replacing || pastedText.trim().length < 200}
                              onClick={() => { void replaceDraftWithPaste(pastedText, dt); }}
                              style={{
                                fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans,
                                background: pastedText.trim().length >= 200 ? navy : '#c8ccd4', color: '#fff', border: 'none',
                                cursor: pastedText.trim().length >= 200 ? 'pointer' : 'default',
                              }}
                            >
                              {replacing ? 'Saving…' : 'Use this as the version on file'}
                            </button>
                            <span style={{ fontSize: 12, color: muted }}>
                              {pastedText.trim().split(/\s+/).filter(Boolean).length.toLocaleString('en-CA')} words
                            </span>
                          </div>
                        </div>
                      )}
                      <input
                        ref={replaceInputRef}
                        type="file"
                        accept={TEXT_UPLOAD_ACCEPT}
                        style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f && dt) void replaceDraftWithUpload(f, dt); e.target.value = ''; }}
                        aria-label="Upload your edited version of this document"
                      />
                      {revising && dt && sessionId && (
                        <RevisionPanel
                          matterId={sessionId}
                          docType={dt}
                          docTitle={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
                          initialFeedback={revising.initial}
                          source={revising.source}
                          styleProfileId={styleProfileId || undefined}
                          briefSources={employment.briefSources}
                          sections={(generatedHtml?.match(/<h2[^>]*>([^<]{1,120})<\/h2>/gi) ?? [])
                            .filter(h => !/Profile of the Plaintiff|Damages Calculation|Comparable Cases|Negotiation History/i.test(h))
                            .map(h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
                            .filter(Boolean)}
                          onApplied={(revisedHtml) => {
                            // The apply route returns the revised document;
                            // the preview must show it, not the pre-revision
                            // draft the lawyer just corrected. The old
                            // draft's review flags and citations go with it:
                            // they describe paragraphs that no longer exist.
                            if (revisedHtml) setGeneratedHtml(revisedHtml);
                            setGenReviewFlags([]);
                            setGenCitations([]);
                            refreshDraftHistory();
                            void employment.refresh();
                          }}
                          onClose={() => setRevising(null)}
                        />
                      )}
                      </>
                    );
                  })()}
                  <DocumentHtml
                    className="starling-doc"
                    style={{
                      background: '#fff', border: `1px solid ${border}`, padding: '28px 32px',
                      fontFamily: serif, fontSize: 14, lineHeight: 1.7, color: ink,
                      maxHeight: 600, overflowY: 'auto',
                    }}
                    html={generatedHtml}
                  />

                  {/* Lawyer review flags — sections the model wants checked */}
                  <TriagedFlags flags={genReviewFlags} />

                  {/* Source citations — what each section relies on */}
                  {genCitations.length > 0 && (
                    <details style={{ marginTop: 12, background: '#fff', border: `1px solid ${border}`, borderRadius: 2 }}>
                      <summary style={{ cursor: 'pointer', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: navy, fontFamily: sans }}>
                        Source citations ({genCitations.length})
                      </summary>
                      <div style={{ padding: '0 16px 12px' }}>
                        {genCitations.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: i > 0 ? `1px solid ${border}` : 'none' }}>
                            <StatusDot colour={c.trustLevel === 'high' ? green : c.trustLevel === 'medium' ? amber : muted} size={7} />
                            <div>
                              <div style={{ fontSize: 13, color: ink }}>{c.citation}</div>
                              <div style={{ fontSize: 11.5, color: muted }}>{c.sourceType} · {c.trustLevel} trust</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Previous drafts — regeneration never destroys a version */}
              {draftHistory.length > 0 && (
                <details style={{ marginTop: 16, background: '#fff', border: `1px solid ${border}`, borderRadius: 2 }}>
                  <summary style={{ cursor: 'pointer', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: navy, fontFamily: sans }}>
                    Previous drafts ({draftHistory.length})
                  </summary>
                  <div style={{ padding: '0 16px 12px' }}>
                    {draftHistory.filter(d => !selectedDraft || d.docType === DRAFT_TO_DOCTYPE[selectedDraft]).map((d, i) => (
                      <div key={`${d.generatedAt}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? `1px solid ${border}` : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>{d.title}</span>
                          <span style={{ fontSize: 12, color: muted, marginLeft: 8 }}>
                            {new Date(d.generatedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            {d.meta?.tone ? ` · ${String(d.meta.tone)}` : ''}
                            {d.meta?.demandAmount ? ` · $${Number(d.meta.demandAmount).toLocaleString('en-CA')}` : ''}
                            {d.meta?.claimAmount ? ` · $${Number(d.meta.claimAmount).toLocaleString('en-CA')}` : ''}
                          </span>
                          {employment.data?.intakeRevisedAt && d.generatedAt < employment.data.intakeRevisedAt && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: amber, background: '#fdf0dd', padding: '1px 6px', borderRadius: 2, marginLeft: 8 }}>
                              FACTS CHANGED SINCE
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setGeneratedHtml(d.html);
                            setGenCitations([]);
                            setGenReviewFlags([]);
                            window.scrollTo(0, 0);
                          }}
                          style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Timeline */}
          {activeTab === 'timeline' && (
            <TimelineTab
              timeline={matter!.timeline}
              keyDate={keyDate} setKeyDate={setKeyDate}
              keyDateSaving={keyDateSaving} setKeyDateSaving={setKeyDateSaving}
              sessionId={sessionId}
              refreshMatter={refreshMatter}
              refreshEmployment={() => void employment.refresh()}
            />
          )}

          {/* Intake editor */}
          {activeTab === 'intake' && (
            <IntakeTab
              intake={(employment.data?.intake ?? {}) as Record<string, unknown>}
              saveIntake={employment.saveIntake}
              refreshEmployment={() => employment.refresh()}
              sessionId={sessionId}
              intakeLink={intakeLink} setIntakeLink={setIntakeLink}
              intakeLinkCopied={intakeLinkCopied} setIntakeLinkCopied={setIntakeLinkCopied}
              portalMessage={portalMessage} setPortalMessage={setPortalMessage}
              pendingClient={pendingClient} refreshPendingClient={refreshPendingClient}
            />
          )}

          {/* Notes */}
          {activeTab === 'client' && (
            <div id="panel-client" role="tabpanel" style={{ paddingTop: 22 }}>
              <CorrespondencePanel
                matterId={sessionId!}
                clientEmail={String((employment.data?.intake as Record<string, unknown> | undefined)?.client_email ?? '') || undefined}
              />
            </div>
          )}

          {activeTab === 'negotiation' && (
            <div id="panel-negotiation" role="tabpanel" style={{ paddingTop: 22 }}>
              <NegotiationPanel matterId={sessionId!} />
              <NetSettlementPanel matterId={sessionId!} />
            </div>
          )}

          {activeTab === 'debrief' && (
            <div id="panel-debrief" role="tabpanel" style={{ paddingTop: 22 }}>
              <DebriefPanel matterId={sessionId!} clientEmail={String((employment.data?.intake as Record<string, unknown> | undefined)?.client_email ?? '') || undefined} />
            </div>
          )}

          {activeTab === 'notes' && (
            <NotesTab
              directionEditor={renderDirection('matter')}
              notes={notes} setNotes={setNotes}
              notesStatus={notesStatus} setNotesStatus={setNotesStatus}
              saveNotes={employment.saveNotes}
            />
          )}
        </div>

        {/* ── Context-sensitive Action Bar ────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: `1px solid ${border}`,
            padding: '18px 24px',
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: serif,
              fontSize: 13,
              color: muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginRight: 6,
            }}
          >
            Actions
          </span>
          <button
            onClick={() => { setActiveTab('draft'); window.scrollTo(0, 0); }}
            style={{
              background: orange,
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '11px 18px',
              borderRadius: 2,
              border: 'none',
              cursor: 'pointer',
              fontFamily: sans,
            }}
          >
            Draft a Document
          </button>
          <ActionButton label="Upload Documents" onClick={() => { setActiveTab('docs'); window.scrollTo(0, 0); }} />

          <span
            style={{
              fontFamily: serif,
              fontSize: 13,
              color: muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 6px 0 14px',
            }}
          >
            Deep Analysis
          </span>
          <ActionButton label="Second Opinion" onClick={() => launchDeepAnalysis('second_opinion')} />
          <ActionButton label="Moot Employer's Response" onClick={() => launchDeepAnalysis('moot')} />
          <ActionButton label="Full Case Assessment" onClick={() => launchDeepAnalysis('assessment')} />
          <ActionButton label="Settlement Valuation" onClick={() => launchDeepAnalysis('settlement')} />
          <ActionButton
            label={clientUpdateLoading ? 'Drafting update...' : 'Draft Client Update'}
            onClick={handleClientUpdate}
          />
          {sessionId && (
            <CloseMatterPanel
              matterId={sessionId}
              resolved={employment.stage?.stage === 'resolution'}
              onChanged={() => employment.refresh()}
            />
          )}
        </div>

        {/* Client update draft — plain-language status email for lawyer review */}
        {(clientUpdateHtml || clientUpdateError) && (
          <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '18px 24px', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: navy, margin: 0 }}>
                Client Update: Draft
              </h3>
              {clientUpdateHtml && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      const tmp = document.createElement('div');
                      tmp.innerHTML = clientUpdateHtml;
                      navigator.clipboard.writeText(tmp.innerText);
                      setClientUpdateCopied(true);
                      setTimeout(() => setClientUpdateCopied(false), 2000);
                    }}
                    style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                  >
                    {clientUpdateCopied ? 'Copied ✓' : 'Copy text'}
                  </button>
                  <button
                    onClick={() => { setClientUpdateHtml(null); }}
                    style={{ background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, padding: '7px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
            {clientUpdateError && (
              <div style={{ color: '#dc2626', fontSize: 13.5 }}>{clientUpdateError}</div>
            )}
            {clientUpdateHtml && (
              <>
                <div style={{ fontSize: 12, color: amber, marginBottom: 10 }}>
                  Review and edit before sending; Starling never contacts your clients.
                </div>
                <DocumentHtml
                  style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.7, color: ink, maxHeight: 380, overflowY: 'auto', borderTop: `1px solid ${border}`, paddingTop: 12 }}
                  html={clientUpdateHtml}
                />
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
          Deep Analysis convenes a multi-agent team pre-briefed with this matter's facts, issues,
          and entitlements. You confirm the approach and roster before anything runs.
        </div>
      </main>
    </div>
  );
}

