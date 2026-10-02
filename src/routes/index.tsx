import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DoneStep } from "@/components/done-step";
import { Faq } from "@/components/faq";
import { Landing } from "@/components/landing";
import { OptionsStep } from "@/components/options-step";
import { ProgressStep } from "@/components/progress-step";
import { ReviewStep } from "@/components/review-step";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Stepper } from "@/components/stepper";
import { Alert, Card, LinkButton, Spinner } from "@/components/ui";
import { UploadStep } from "@/components/upload-step";
import { type SyncEngine, useSyncEngine } from "@/hooks/use-sync-engine";
import type { Viewer } from "@/lib/types";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Trakt access wasn't granted. Connect again whenever you're ready.",
  state: "That sign-in link expired or was opened in a different browser. Please try again.",
  exchange: "Trakt sign-in didn't complete. Please try again in a moment.",
  config: "This site is missing its Trakt credentials, so sign-in is unavailable.",
};

const root = getRouteApi("__root__");

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { auth_error?: string } =>
    typeof search.auth_error === "string" ? { auth_error: search.auth_error } : {},
  component: Home,
});

function Home() {
  const { viewer, configured } = root.useLoaderData();
  const { auth_error } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useSyncEngine(viewer);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth_error) return;
    setAuthError(AUTH_ERRORS[auth_error] ?? AUTH_ERRORS.exchange ?? null);
    void navigate({ to: "/", search: {}, replace: true });
  }, [auth_error, navigate]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader viewer={viewer} onSignOut={engine.actions.cancel} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 sm:px-6 sm:pt-10">
        {authError && (
          <div className="mb-6">
            <Alert title="Couldn't connect to Trakt" onDismiss={() => setAuthError(null)}>
              {authError}
            </Alert>
          </div>
        )}
        {viewer ? (
          <Workflow engine={engine} viewer={viewer} />
        ) : (
          <Landing configured={configured} />
        )}
        <Faq />
      </main>
      <SiteFooter engine={engine} />
    </div>
  );
}

function Workflow({ engine, viewer }: { engine: SyncEngine; viewer: Viewer }) {
  const { stage, error, hydrated } = engine;

  if (!hydrated) {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-ink-3">
        <Spinner /> Loading…
      </Card>
    );
  }

  return (
    <>
      <Stepper stage={stage} />
      {error && (
        <div className="mb-4">
          <Alert
            title={error.code === "unauthorized" ? "Your Trakt session ended" : "That didn't work"}
            onDismiss={engine.actions.dismissError}
            action={
              error.code === "unauthorized" ? (
                <LinkButton href="/api/auth/login" size="sm">
                  Reconnect Trakt
                </LinkButton>
              ) : undefined
            }
          >
            {error.message}
            {error.code === "unauthorized" && " Your progress is saved in this browser."}
          </Alert>
        </div>
      )}
      {stage === "upload" && <UploadStep engine={engine} />}
      {stage === "options" && <OptionsStep engine={engine} />}
      {(stage === "analyzing" || stage === "syncing") && <ProgressStep engine={engine} />}
      {stage === "review" && <ReviewStep engine={engine} />}
      {stage === "done" && <DoneStep engine={engine} viewer={viewer} />}
    </>
  );
}
