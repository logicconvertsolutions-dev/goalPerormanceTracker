'use client';

import { useState } from 'react';
import { Check, EyeOff, MessageSquarePlus, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Suggestion } from '@/lib/snapshot/calculate';
import {
  ADVISOR_NOTES_MAX,
  newId,
  NOTE_MAX,
  type CustomRecommendation,
  type RecommendationEdit,
} from '@/lib/snapshot/form';

/** What an earlier note was about, from its recommendation id (calculate.ts `suggestions`). */
function topicOf(id: string): string {
  const [kind, a, b] = id.split(':');
  switch (kind) {
    case 'shortfall':
      return 'Monthly shortfall';
    case 'debt':
      return 'High-interest debt';
    case 'emergency':
      return 'Emergency fund';
    case 'insurance':
      return `Life insurance (${a === 'spouse' ? 'spouse' : 'client'})`;
    case 'room':
      return `${b ?? 'Registered'} room (${a === 'spouse' ? 'spouse' : 'client'})`;
    case 'fhsa':
      return `FHSA (${a === 'spouse' ? 'spouse' : 'client'})`;
    case 'resp':
      return 'RESP';
    case 'registered-choice':
      return 'RRSP vs TFSA';
    default:
      return 'Earlier recommendation';
  }
}

/**
 * Text that edits on screen and prints as plain paragraphs — a textarea
 * prints at its fixed height and cuts long notes off.
 */
function NoteText({
  id,
  label,
  value,
  max,
  rows = 2,
  placeholder,
  asNote = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  rows?: number;
  placeholder?: string;
  /** Printed as an annotation (rule + "Note:") rather than as plain text. */
  asNote?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <Textarea
        id={id}
        aria-label={label}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        className="min-h-0 text-sm print:hidden"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value.trim() && (
        <p
          className={
            asNote
              ? 'hidden whitespace-pre-wrap border-l-2 border-line-3 pl-2 text-sm italic text-fg print:block'
              : 'hidden whitespace-pre-wrap text-sm text-fg print:block'
          }
        >
          {asNote && <span className="not-italic font-medium">Note: </span>}
          {value}
        </p>
      )}
    </>
  );
}

export function Recommendations({
  tips,
  notes,
  custom,
  advisorNotes,
  onNote,
  edits,
  onEdit,
  onCustom,
  onAdvisorNotes,
}: {
  tips: Suggestion[];
  notes: Record<string, string>;
  custom: CustomRecommendation[];
  advisorNotes: string;
  /** "" removes the note. */
  onNote: (id: string, text: string) => void;
  /** The agent's rewording / hiding of automatic items, by id. */
  edits: Record<string, RecommendationEdit>;
  /** null removes the edit (back to the suggestion). */
  onEdit: (id: string, edit: RecommendationEdit | null) => void;
  onCustom: (next: CustomRecommendation[]) => void;
  onAdvisorNotes: (text: string) => void;
}) {
  // Note fields the agent opened but hasn't typed in yet (not saved anywhere).
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const current = new Set(tips.map((t) => t.id));
  const earlier = Object.entries(notes).filter(([id, text]) => !current.has(id) && text.trim());
  const visible = tips.filter((t) => !edits[t.id]?.hidden);
  const hidden = tips.filter((t) => edits[t.id]?.hidden);
  const hasAnything = visible.length > 0 || custom.length > 0;

  /** Leaving edit mode: an emptied rewording goes back to the suggestion. */
  const finishEditing = (id: string) => {
    const e = edits[id];
    if (e && e.text !== undefined && !e.text.trim()) {
      onEdit(id, e.hidden ? { hidden: true } : null);
    }
    setEditing(null);
  };

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold-dark" aria-hidden="true" />
          Recommendations
        </CardTitle>
        <CardDescription>A guide for the conversation, not financial advice. Edit, remove or add your own.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnything && (
          <p className="text-sm text-fg-3 print:hidden">
            Recommendations appear as you fill in the snapshot. Add your own below.
          </p>
        )}

        {hasAnything && (
          <ol className="list-decimal space-y-3 pl-5 text-sm text-fg-2">
            {visible.map((t) => {
              const note = notes[t.id] ?? '';
              const showNote = note !== '' || open.has(t.id);
              const edit = edits[t.id];
              const edited = edit?.text !== undefined;
              const isEditing = editing === t.id;
              return (
                <li key={t.id} className="space-y-1.5">
                  {isEditing ? (
                    <div className="space-y-1.5 print:hidden">
                      <Textarea
                        aria-label="Edit recommendation"
                        autoFocus
                        rows={3}
                        maxLength={NOTE_MAX}
                        className="min-h-0 text-sm"
                        value={edit?.text ?? t.text}
                        onChange={(e) => onEdit(t.id, { ...edit, text: e.target.value, base: edit?.base ?? t.text })}
                      />
                      <Button type="button" size="sm" variant="soft" onClick={() => finishEditing(t.id)}>
                        <Check className="h-4 w-4" aria-hidden="true" /> Done
                      </Button>
                    </div>
                  ) : null}
                  <div className={isEditing ? 'hidden print:block' : 'flex items-start gap-1'}>
                    <p className="min-w-0 flex-1 whitespace-pre-wrap">{edited ? edit!.text : t.text}</p>
                    <span className="flex shrink-0 print:hidden">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Edit recommendation"
                        className="h-8 min-h-0 w-8"
                        onClick={() => setEditing(t.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove recommendation"
                        className="h-8 min-h-0 w-8"
                        onClick={() => {
                          onEdit(t.id, { ...edit, hidden: true });
                          if (editing === t.id) setEditing(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                  {edited && !isEditing && (
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-fg-3 print:hidden">
                      <span className="rounded-full bg-sunken px-1.5 py-0.5 font-medium text-fg-2">Edited</span>
                      {edit!.base !== undefined && edit!.base !== t.text && (
                        <span className="text-warn">The suggested wording has changed with the numbers.</span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium text-acc underline-offset-4 hover:underline"
                        onClick={() => onEdit(t.id, null)}
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" /> Restore suggested
                      </button>
                    </p>
                  )}
                  {showNote ? (
                    <NoteText
                      id={`rec-note-${t.id}`}
                      label="Note on this recommendation"
                      placeholder="Your note, e.g. the client's decision or timing"
                      asNote
                      value={note}
                      max={NOTE_MAX}
                      onChange={(v) => onNote(t.id, v)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-acc underline-offset-4 hover:underline print:hidden"
                      onClick={() => setOpen((s) => new Set(s).add(t.id))}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add note
                    </button>
                  )}
                </li>
              );
            })}
            {custom.map((c, i) => (
              <li key={c.id} className={c.text.trim() ? undefined : 'print:hidden'}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <NoteText
                      id={`rec-custom-${c.id}`}
                      label={`Your recommendation ${i + 1}`}
                      placeholder="Your recommendation"
                      value={c.text}
                      max={NOTE_MAX}
                      onChange={(v) => onCustom(custom.map((x) => (x.id === c.id ? { ...x, text: v } : x)))}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove your recommendation ${i + 1}`}
                    className="h-9 min-h-0 w-9 shrink-0 print:hidden"
                    onClick={() => onCustom(custom.filter((x) => x.id !== c.id))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onCustom([...custom, { id: newId('r'), text: '' }])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add recommendation
          </Button>
          {hidden.length > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-fg-2 underline-offset-4 hover:underline"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((v) => !v)}
            >
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              {hidden.length} removed · {showHidden ? 'Hide' : 'Show'}
            </button>
          )}
        </div>

        {showHidden && hidden.length > 0 && (
          <ul className="space-y-2 rounded-sm bg-sunken px-3 py-2 print:hidden">
            {hidden.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm text-fg-3">
                <p className="min-w-0 flex-1 line-through decoration-fg-4">{edits[t.id]?.text ?? t.text}</p>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-acc underline-offset-4 hover:underline"
                  onClick={() => {
                    const text = edits[t.id]?.text;
                    // Keep a rewording when un-removing; otherwise drop the edit entirely.
                    onEdit(t.id, text !== undefined ? { text, base: edits[t.id]?.base } : null);
                  }}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" /> Restore
                </button>
              </li>
            ))}
          </ul>
        )}

        {earlier.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">Earlier notes</p>
            <p className="text-xs text-fg-3 print:hidden">
              Notes on recommendations that no longer apply with the current numbers.
            </p>
            <ul className="space-y-2">
              {earlier.map(([id, text]) => (
                <li key={id} className="flex items-start gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-fg-3">{topicOf(id)}</p>
                    <p className="whitespace-pre-wrap text-fg-2">{text}</p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove earlier note on ${topicOf(id)}`}
                    className="h-9 min-h-0 w-9 shrink-0 print:hidden"
                    onClick={() => onNote(id, '')}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={advisorNotes.trim() ? 'space-y-1.5' : 'space-y-1.5 print:hidden'}>
          <Label htmlFor="rec-advisor-notes" className="text-xs">
            Advisor notes
          </Label>
          <NoteText
            id="rec-advisor-notes"
            label="Advisor notes"
            placeholder="Anything else from the meeting: follow-ups, client priorities, documents needed…"
            value={advisorNotes}
            max={ADVISOR_NOTES_MAX}
            rows={4}
            onChange={onAdvisorNotes}
          />
        </div>
      </CardContent>
    </Card>
  );
}
