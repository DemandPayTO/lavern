// The firm-template and firm-style options for a draft: the active template
// card with its variant picker, the "build from precedents" and "teach your
// style" panels, and the style-profile selector. Extracted verbatim from
// MatterDetailView.tsx's draft tab; state stays in the parent (Option A).

import { navy, green, border, ink, muted, sans } from '../tokens.js';
import { DEMO_DRAFT_TYPES } from '../constants.js';
import { PrecedentAlignPanel } from '../../PrecedentAlignPanel.js';
import { StyleProfilePanel, useStyleProfiles } from '../../StyleProfilePanel.js';
import { useFirmTemplates } from '../../hooks/useStarlingApi.js';

type FirmTemplates = ReturnType<typeof useFirmTemplates>;
type StyleProfiles = ReturnType<typeof useStyleProfiles>;
type Variant = FirmTemplates['templates'][number];

export function TemplateStyleOptions({
  selectedDraft, selectedTemplateDocType, showOptions,
  firmTemplates, styleProfiles, variantsForType, activeVariant, currentTemplate,
  chosenVariantIdSet, templateStatus, setTemplateStatus,
  templateInputRef, pendingTemplateFile, setPendingTemplateFile,
  pendingTemplateLabel, setPendingTemplateLabel, handleTemplateUpload,
  buildingTemplate, setBuildingTemplate, buildingStyle, setBuildingStyle,
  styleProfileId, setStyleProfileId,
}: {
  selectedDraft: string | null;
  selectedTemplateDocType: string | undefined;
  showOptions: boolean;
  firmTemplates: FirmTemplates;
  styleProfiles: StyleProfiles;
  variantsForType: Variant[];
  activeVariant: Variant | undefined;
  currentTemplate: Variant | undefined;
  chosenVariantIdSet: (id: string | null) => void;
  templateStatus: string | null;
  setTemplateStatus: React.Dispatch<React.SetStateAction<string | null>>;
  templateInputRef: React.RefObject<HTMLInputElement | null>;
  pendingTemplateFile: File | null;
  setPendingTemplateFile: React.Dispatch<React.SetStateAction<File | null>>;
  pendingTemplateLabel: string;
  setPendingTemplateLabel: React.Dispatch<React.SetStateAction<string>>;
  handleTemplateUpload: (file: File, label?: string) => void;
  buildingTemplate: boolean;
  setBuildingTemplate: React.Dispatch<React.SetStateAction<boolean>>;
  buildingStyle: boolean;
  setBuildingStyle: React.Dispatch<React.SetStateAction<boolean>>;
  styleProfileId: string;
  setStyleProfileId: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <>
      {selectedTemplateDocType && selectedDraft !== 'timetable' && (
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>
              Firm template
              {currentTemplate && (
                <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: green, background: '#e7f6ec', padding: '2px 7px', borderRadius: 2 }}>
                  ACTIVE · {currentTemplate.variantLabel}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: muted }}>
              {currentTemplate
                ? 'Downloads use your firm’s letterhead and formatting.'
                : 'Upload your firm’s DOCX template with {{PLACEHOLDER}} markers. You can keep several for one document type, for example one for constructive dismissal and one for termination during medical leave.'}
            </div>

            {/* Variant picker — hidden when the firm has only one,
                so the common case gains no extra step. */}
            {variantsForType.length > 1 && (
              <div style={{ marginTop: 10 }} role="radiogroup" aria-label="Firm template to draft on">
                <div style={{ fontSize: 11.5, fontWeight: 700, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>
                  Draft on
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {variantsForType.map(v => {
                    const active = activeVariant?.variantId === v.variantId;
                    return (
                      <button
                        key={v.variantId}
                        role="radio"
                        aria-checked={active}
                        onClick={() => chosenVariantIdSet(v.variantId)}
                        style={{
                          fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans,
                          background: active ? navy : '#fff',
                          color: active ? '#fff' : navy,
                          border: `1px solid ${active ? navy : border}`,
                          cursor: 'pointer',
                        }}
                      >
                        {v.variantLabel}
                        {v.isDefault && !active && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: muted }}>default</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {templateStatus && (
              <div style={{ fontSize: 12.5, color: navy, marginTop: 4 }}>{templateStatus}</div>
            )}
          </div>
          <input
            ref={templateInputRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                // A second template for the same type needs a label so
                // the lawyer can tell them apart in the picker. Ask
                // inline: window.prompt is blocked in some browsers
                // and cancelling it silently dropped the chosen file.
                if (variantsForType.length > 0) {
                  setPendingTemplateFile(file);
                  setPendingTemplateLabel('');
                } else {
                  void handleTemplateUpload(file, undefined);
                }
              }
              if (templateInputRef.current) templateInputRef.current.value = '';
            }}
          />
          {pendingTemplateFile && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: ink }}>Name this template:</span>
              <input
                autoFocus
                value={pendingTemplateLabel}
                onChange={e => setPendingTemplateLabel(e.target.value)}
                placeholder="e.g. Constructive dismissal"
                onKeyDown={e => {
                  if (e.key === 'Enter' && pendingTemplateLabel.trim()) {
                    void handleTemplateUpload(pendingTemplateFile, pendingTemplateLabel.trim());
                    setPendingTemplateFile(null);
                  }
                  if (e.key === 'Escape') setPendingTemplateFile(null);
                }}
                style={{ fontSize: 12.5, fontFamily: sans, padding: '6px 9px', border: `1px solid ${border}`, borderRadius: 2, width: 220 }}
              />
              <button
                disabled={!pendingTemplateLabel.trim()}
                onClick={() => {
                  void handleTemplateUpload(pendingTemplateFile, pendingTemplateLabel.trim());
                  setPendingTemplateFile(null);
                }}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: pendingTemplateLabel.trim() ? navy : '#c8ccd4', color: '#fff', border: 'none', cursor: pendingTemplateLabel.trim() ? 'pointer' : 'default' }}
              >
                Save template
              </button>
              <button
                onClick={() => setPendingTemplateFile(null)}
                style={{ fontSize: 12, color: muted, background: 'none', border: `1px solid ${border}`, borderRadius: 2, padding: '6px 12px', cursor: 'pointer', fontFamily: sans }}
              >
                Cancel
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => templateInputRef.current?.click()}
              style={{
                background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
              }}
            >
              {currentTemplate ? 'Add another' : 'Upload template'}
            </button>
            <button
              onClick={() => setBuildingTemplate(v => !v)}
              style={{
                background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
              }}
            >
              {buildingTemplate ? 'Close builder' : 'Build from precedents'}
            </button>
            <button
              onClick={() => setBuildingStyle(v => !v)}
              style={{
                background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
              }}
            >
              {buildingStyle ? 'Close style teacher' : 'Teach your style'}
            </button>
            {currentTemplate && activeVariant && !activeVariant.isDefault && (
              <button
                onClick={async () => {
                  const result = await firmTemplates.setDefault(selectedTemplateDocType, activeVariant.variantId);
                  setTemplateStatus(result.ok
                    ? `“${activeVariant.variantLabel}” is now the default for this document type.`
                    : result.error ?? 'Failed to set the default.');
                }}
                style={{
                  background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                  padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                }}
              >
                Make default
              </button>
            )}
            {currentTemplate && activeVariant && (
              <button
                onClick={async () => {
                  const result = await firmTemplates.remove(selectedTemplateDocType, activeVariant.variantId);
                  chosenVariantIdSet(null);
                  setTemplateStatus(result.ok
                    ? `“${activeVariant.variantLabel}” removed.`
                    : result.error ?? 'Failed to remove.');
                }}
                style={{
                  background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                  padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
      {buildingTemplate && selectedTemplateDocType && (
        <PrecedentAlignPanel
          documentType={selectedTemplateDocType}
          documentLabel={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
          onSaved={() => { setBuildingTemplate(false); firmTemplates.refresh(); setTemplateStatus('Template built from your precedents and saved.'); }}
          onCancel={() => setBuildingTemplate(false)}
        />
      )}
      {buildingStyle && selectedTemplateDocType && (
        <StyleProfilePanel
          documentType={selectedTemplateDocType}
          documentLabel={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
          profiles={styleProfiles.profiles}
          onChanged={() => styleProfiles.refresh()}
          onClose={() => setBuildingStyle(false)}
        />
      )}
      {selectedDraft && selectedDraft !== 'timetable' && showOptions && styleProfiles.profiles.length > 0 && (
        <div style={{ margin: '0 0 12px' }}>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Draft in your firm's style</div>
          <div style={{ fontSize: 11.5, color: muted, marginBottom: 6, lineHeight: 1.5 }}>
            A firm style taught from letters reproduces your boilerplate: your opening block, your headings and your standard passages, with this file's facts in them. Standard drafting writes the document fresh.
          </div>
          <select
            value={styleProfileId}
            onChange={e => setStyleProfileId(e.target.value)}
            aria-label="Firm style for this draft"
            style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, minWidth: 280 }}
          >
            <option value="">Standard Starling drafting (draft it fresh)</option>
            {styleProfiles.profiles.map(sp => (
              <option key={sp.id} value={sp.id}>{sp.label} (from {sp.sourceCount} precedents)</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
