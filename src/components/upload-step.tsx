import { type DragEvent, useId, useState } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { LockIcon, UploadIcon } from "./icons";
import { Card, ExternalLink, Spinner } from "./ui";

export function UploadStep({ engine }: { engine: SyncEngine }) {
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const busy = engine.busyReading;

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file && !busy) void engine.actions.loadFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
  };

  return (
    <Card aria-labelledby="upload-title" aria-busy={busy}>
      <h2 id="upload-title" className="text-xl font-semibold tracking-tight">
        Bring your Letterboxd films
      </h2>
      <p className="mt-2 text-sm text-ink-3">
        One export is all you need. Here's where to find it.
      </p>
      <div className="upload-layout">
        <ol className="export-instructions">
          <li>
            <span>
              Open{" "}
              <ExternalLink href="https://letterboxd.com/settings/data/">
                your Letterboxd data settings
              </ExternalLink>{" "}
              and sign in if asked.
            </span>
          </li>
          <li>
            <span>
              Choose <strong className="font-medium text-ink">Export your data</strong> and download
              your ZIP file.
            </span>
          </li>
          <li>
            <span>Drop that file here. Keep it zipped, we'll take care of the rest.</span>
          </li>
        </ol>

        <label
          htmlFor={inputId}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
              setDragging(false);
            }
          }}
          onDrop={onDrop}
          data-dragging={dragging}
          data-busy={busy}
          className="upload-zone"
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-surface text-brand-ink shadow-card ring-1 ring-line">
            {busy ? <Spinner className="size-5" /> : <UploadIcon className="size-5" />}
          </span>
          {busy ? (
            <span className="font-medium">Reading your export...</span>
          ) : (
            <>
              <span className="font-medium">
                {dragging ? "Drop to read your export" : "Drop your export here"}
              </span>
              <span className="text-sm text-ink-3">
                or{" "}
                <span className="font-medium text-brand-ink underline underline-offset-4">
                  browse files
                </span>
              </span>
              <span className="text-xs text-ink-3">ZIP or CSV · Up to 50 MB</span>
            </>
          )}
          <input
            id={inputId}
            type="file"
            accept=".zip,.csv,application/zip,text/csv"
            aria-describedby={hintId}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              take(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <p role="status" className="sr-only">
        {busy ? "Reading your Letterboxd export. Please wait." : "Ready to choose an export."}
      </p>
      <p
        id={hintId}
        className="mt-6 flex items-start gap-2 border-t border-line pt-4 text-sm text-ink-3"
      >
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        Your files stay in this browser. You'll review the matches before anything is added to
        Trakt.
      </p>
    </Card>
  );
}
