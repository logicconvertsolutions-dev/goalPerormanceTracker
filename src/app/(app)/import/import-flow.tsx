'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ParseResult } from '@/lib/import/parse-workbook';
import type { CommitResult } from '@/lib/import/commit-import';
import { commitImportAction, parseWorkbookAction } from './actions';

type Stage =
  | { name: 'upload' }
  | { name: 'preview'; parseResult: ParseResult }
  | { name: 'done'; commitResult: CommitResult };

export function ImportFlow() {
  const [stage, setStage] = useState<Stage>({ name: 'upload' });
  const [pending, startTransition] = useTransition();

  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const outcome = await parseWorkbookAction(formData);
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setStage({ name: 'preview', parseResult: outcome.result });
    });
  }

  function handleCommit(parseResult: ParseResult) {
    startTransition(async () => {
      const outcome = await commitImportAction(parseResult);
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setStage({ name: 'done', commitResult: outcome.result });
    });
  }

  if (stage.name === 'upload') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload workbook</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <input
              type="file"
              name="file"
              accept=".xlsx"
              required
              className="text-sm text-fg-2 file:mr-3 file:rounded-sm file:border file:border-line-2 file:bg-panel-2 file:px-3 file:py-2 file:text-sm file:text-fg"
            />
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Reading…' : 'Preview import'}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (stage.name === 'preview') {
    const { parseResult } = stage;
    const importable = parseResult.rows.filter((r) => r.errors.length === 0);
    const withErrors = parseResult.rows.filter((r) => r.errors.length > 0);
    const bySheet = groupBySheet(parseResult.rows);

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="ok">{importable.length} ready to import</Badge>
              {withErrors.length > 0 && <Badge variant="bad">{withErrors.length} with errors</Badge>}
              <Badge variant="neutral">{parseResult.skippedBlankRows} blank rows skipped</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm text-fg-2">
              {Object.entries(bySheet).map(([sheet, rows]) => (
                <div key={sheet}>
                  {sheet}: {rows.filter((r) => r.errors.length === 0).length} / {rows.length}
                </div>
              ))}
            </div>

            {withErrors.length > 0 && (
              <div className="rounded-sm border border-bad bg-bad-dim p-3 text-xs text-bad space-y-1 max-h-48 overflow-y-auto">
                {withErrors.map((r, i) => (
                  <p key={i}>
                    {r.sheet} row {r.rowNumber}: {r.errors.join(' ')}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStage({ name: 'upload' })} disabled={pending}>
            Choose a different file
          </Button>
          <Button
            variant="primary"
            onClick={() => handleCommit(parseResult)}
            disabled={pending || importable.length === 0}
          >
            {pending ? 'Importing…' : `Commit ${importable.length} rows`}
          </Button>
        </div>
      </div>
    );
  }

  const { commitResult } = stage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-2">
          Imported {commitResult.imported} rows
          {commitResult.skippedDuplicate > 0 && `, skipped ${commitResult.skippedDuplicate} already-imported rows`}
          {commitResult.errors.length > 0 && `, ${commitResult.errors.length} rows failed`}.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="primary">
            <Link href="/today">Go to Today</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/contacts">View contacts</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function groupBySheet(rows: ParseResult['rows']) {
  const map: Record<string, ParseResult['rows']> = {};
  for (const row of rows) {
    (map[row.sheet] ??= []).push(row);
  }
  return map;
}
