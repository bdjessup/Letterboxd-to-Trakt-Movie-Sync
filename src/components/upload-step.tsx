import { type DragEvent, useId, useState } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { UploadIcon } from "./icons";
import { Card, cx, ExternalLink, Spinner } from "./ui";

export function UploadStep({ engine }: { engine: SyncEngine }) {
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
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
    <Card aria-labelledby="upload-title">
      <h2 id="upload-title" className="text-xl font-semibold tracking-tight">
        Upload your Letterboxd export
      </h2>
      <ol className="mt-3 list-inside list-decimal space-y-1.5 text-ink-2 marker:text-ink-3">
        <li>
          On Letterboxd, open{" "}
          <ExternalLink href="https://letterboxd.com/settings/data/">Settings → Data</ExternalLink>{" "}
          and choose <strong className="font-medium text-ink">Export your data</strong>.
        </li>
        <li>Drop the ZIP file here. No need to unzip it.</li>
      </ol>

      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cx(
          "mt-6 flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
          dragging
            ? "border-brand bg-brand-soft"
            : "border-line-strong bg-surface-2/60 hover:border-brand/60 hover:bg-brand-soft/50",
          busy && "pointer-events-none opacity-70",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-surface text-brand-ink shadow-card ring-1 ring-line">
          {busy ? <Spinner className="size-5" /> : <UploadIcon className="size-5" />}
        </span>
        {busy ? (
          <span className="font-medium">Reading your export…</span>
        ) : (
          <>
            <span className="font-medium">
              {dragging ? "Drop to upload" : "Drop your export here"}
            </span>
            <span className="text-sm text-ink-3">
              or <span className="font-medium text-brand-ink underline">choose a file</span> (.zip
              or .csv)
            </span>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <p className="mt-4 text-sm text-ink-3">
        Your export is read in this browser. It isn't uploaded to any server.
      </p>
    </Card>
  );
}
