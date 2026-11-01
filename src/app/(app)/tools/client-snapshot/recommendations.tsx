'use client';

import { useState } from 'react';
import { MessageSquarePlus, Plus, Sparkles, Trash2 } from 'lucide-react';
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
  onCustom,
  onAdvisorNotes,
}: {
  tips: Suggestion[];
  notes: Record<string, string>;
  custom: CustomRecommendation[];
  advisorNotes: string;
  /** "" removes the note. */
  onNote: (id: string, text: string) => void;
  onCustom: (next: CustomRecommendation[]) => void;
  onAdvisorNotes: (text: string) => void;
}) {
  // Note fields the agent opened but hasn't typed in yet (not saved anywhere).
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const current = new Set(tips.map((t) => t.id));
  const earlier = Object.entries(notes).filter(([id, text]) => !current.has(id) && text.trim());
  const hasAnything = tips.length > 0 || custom.length > 0;

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold-dark" aria-hidden="true" />
          Recommendations
        </CardTitle>
        <CardDescription>A guide for the conversation, not financial advice. Add your own notes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnything && (
          <p className="text-sm text-fg-3 print:hidden">
            Recommendations appear as you fill in the snapshot. Add your own below.
          </p>
        )}

        {hasAnything && (
          <ol className="list-decimal space-y-3 pl-5 text-sm text-fg-2">
            {tips.map((t) => {
              const note = notes[t.id] ?? '';
              const showNote = note !== '' || open.has(t.id);
              return (
                <li key={t.id} className="space-y-1.5">
                  <p>{t.text}</p>
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

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="print:hidden"
          onClick={() => onCustom([...custom, { id: newId('r'), text: '' }])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add recommendation
        </Button>

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
