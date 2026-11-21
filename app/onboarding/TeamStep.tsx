"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { IconDone } from "@/app/components/icons";
import { AddPersonArt, LinkArt, SheetArt } from "@/app/components/onboarding/art";
import { Actions, ErrorText, FieldCaption, FillInput, Panel, Pill, SoftButton, Stagger, Sub, Tile, Title } from "@/app/components/onboarding/kit";

type Method = "zoho" | "csv" | "manual";

interface ZohoStatus {
  configured: boolean;
  connection: "oauth" | "env" | null;
  workers: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T & { error?: string }> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  return (await res.json().catch(() => ({ error: "Unexpected answer from the server." }))) as T & { error?: string };
}

/**
 * "Bring your people in": Zoho People, a CSV, or one at a time. All three use the same endpoints as the Workers page,
 * which already enforce that only the owner can add people and that money fields are validated on the server.
 */
export function TeamStep({ defaultWage, zohoFlag, zohoReason, busy: finishing, onNext }: {
  defaultWage: number;
  zohoFlag: string | null;
  zohoReason: string | null;
  /** The parent is finishing onboarding. */
  busy: boolean;
  onNext: () => void;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<Method | null>(zohoFlag ? "zoho" : null);
  const [added, setAdded] = useState(0);
  const [zoho, setZoho] = useState<ZohoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(zohoFlag === "error" ? `Zoho said: ${zohoReason ?? "something went wrong"}.` : null);
  const [note, setNote] = useState<string | null>(zohoFlag === "connected" ? "Zoho is connected. Import your employees below." : null);

  useEffect(() => {
    let off = false;
    void call<{ zoho: ZohoStatus }>("/api/zoho/status").then((d) => {
      if (!off && d.zoho) setZoho(d.zoho);
    });
    return () => {
      off = true;
    };
  }, []);

  const add = (n: number) => setAdded((a) => a + n);
  const pick = (m: Method) => () => setOpen(open === m ? null : m);

  async function importZoho() {
    setBusy(true);
    setError(null);
    setNote(null);
    const d = await call<{ sync?: { employees: { total: number; created: number } } }>("/api/zoho/sync", { method: "POST" });
    setBusy(false);
    if (d.error || !d.sync) return setError(d.error ?? "The import didn't finish.");
    add(d.sync.employees.created);
    setNote(`Imported ${d.sync.employees.total} employees (${d.sync.employees.created} new). Each starts at ₹${defaultWage} a day; you can edit them later.`);
  }

  return (
    <>
      <Title accent="people">Bring your people in.</Title>
      <Sub>Pick whichever is quickest, or skip it and add them from the Workers page.</Sub>

      <Stagger className="mt-9 grid gap-4 sm:grid-cols-3" role="radiogroup" label="How to add your team">
        {[
          <Tile key="z" title="Zoho People" caption={zoho?.connection ? "Connected" : "Import staff"} art={<LinkArt />} tall selected={open === "zoho"} onClick={pick("zoho")} />,
          <Tile key="c" title="A sheet" caption="CSV upload" art={<SheetArt />} tall selected={open === "csv"} onClick={pick("csv")} />,
          <Tile key="m" title="By hand" caption="One at a time" art={<AddPersonArt />} tall selected={open === "manual"} onClick={pick("manual")} />,
        ]}
      </Stagger>

      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.div
            key={open}
            initial={reduce ? false : { opacity: 0, y: 18, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={reduce ? undefined : { opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 overflow-hidden px-1 pb-2"
          >
            <Panel>
              {open === "zoho" &&
                (!zoho ? (
                  <p className="text-sm text-[#16152b]/55">Checking…</p>
                ) : !zoho.configured ? (
                  <p className="text-sm leading-relaxed text-[#16152b]/65">Zoho isn&apos;t set up on this server yet. Use a sheet or add people by hand for now, and connect Zoho later from Integrations.</p>
                ) : zoho.connection ? (
                  <div className="flex flex-col items-start gap-4">
                    <p className="text-sm leading-relaxed text-[#16152b]/65">Your Zoho account is connected. Wages aren&apos;t stored in Zoho People, so each employee starts at ₹{defaultWage} a day.</p>
                    <SoftButton onClick={importZoho} disabled={busy}>{busy ? "Importing…" : "Import employees"}</SoftButton>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-4">
                    <p className="text-sm leading-relaxed text-[#16152b]/65">You&apos;ll sign in to Zoho, allow read-only access to employees and attendance, and come straight back here.</p>
                    <a href="/api/zoho/connect?returnTo=/onboarding" className="inline-flex h-11 items-center rounded-full bg-[#16152b] px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5">Connect Zoho People</a>
                  </div>
                ))}
              {open === "csv" && <CsvImport onAdded={add} setError={setError} setNote={setNote} />}
              {open === "manual" && <ManualAdd wage={defaultWage} onAdded={() => add(1)} setError={setError} setNote={setNote} />}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorText>{error}</ErrorText>
      {note && (
        <p role="status" className="mx-auto mt-5 flex max-w-md items-start justify-center gap-2 text-center text-sm font-medium text-[#0b7a63]">
          <IconDone className="mt-0.5 size-4 shrink-0" />
          <span>{note}</span>
        </p>
      )}

      <Actions>
        <Pill onClick={onNext} disabled={busy || finishing}>{finishing ? "Opening…" : added > 0 ? `Open my dashboard · ${added} added` : "Open my dashboard"}</Pill>
      </Actions>
    </>
  );
}

function CsvImport({ onAdded, setError, setNote }: { onAdded: (n: number) => void; setError: (e: string | null) => void; setNote: (n: string | null) => void }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) return setError("That file is over 1 MB.");
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result ?? ""));
    r.readAsText(f);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    const d = await call<{ import?: { imported: number; errors: string[] } }>("/api/import", { method: "POST", body: JSON.stringify({ kind: "workers", csv }) });
    setBusy(false);
    if (d.error || !d.import) return setError(d.error ?? "The import didn't finish.");
    onAdded(d.import.imported);
    setCsv("");
    setNote(`Imported ${d.import.imported} worker${d.import.imported === 1 ? "" : "s"}.${d.import.errors.length ? ` ${d.import.errors.length} row${d.import.errors.length === 1 ? "" : "s"} skipped: ${d.import.errors[0]}` : ""}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#16152b]/55">
        First row is the header: <span className="font-mono">name, role, city, phone, payoutUpi, dailyWage</span>
      </p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={"name,role,city,phone,payoutUpi,dailyWage\nRavi Kumar,Rider,Bengaluru,9876543210,ravi@okaxis,800"}
        aria-label="CSV text"
        className="w-full resize-none rounded-2xl bg-[#16152b]/[0.05] p-4 font-mono text-xs text-[#16152b] outline-none transition placeholder:text-[#16152b]/30 focus:bg-white focus:shadow-[0_0_0_3px_rgba(255,93,115,0.28)]"
      />
      <div className="flex flex-wrap gap-2">
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Choose a CSV file" />
        <SoftButton tone="light" onClick={() => file.current?.click()}>Choose file</SoftButton>
        <SoftButton onClick={run} disabled={busy || !csv.trim()}>{busy ? "Importing…" : "Import"}</SoftButton>
      </div>
    </div>
  );
}

/** Just a name and a UPI id; role, city and phone can be filled in later on the Workers page. */
function ManualAdd({ wage, onAdded, setError, setNote }: { wage: number; onAdded: () => void; setError: (e: string | null) => void; setNote: (n: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setNote(null);
    const d = await call("/api/workers", {
      method: "POST",
      body: JSON.stringify({ name: f.get("name"), role: "Worker", dailyWage: wage, payoutUpi: f.get("upi") || "" }),
    });
    setBusy(false);
    if (d.error) return setError(d.error);
    onAdded();
    setNote(`Added ${String(f.get("name"))}.`);
    form.current?.reset();
  }

  return (
    <form ref={form} onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label><FieldCaption>Name</FieldCaption><FillInput name="name" required maxLength={80} autoFocus /></label>
      <label><FieldCaption>UPI id (optional)</FieldCaption><FillInput name="upi" maxLength={80} placeholder="name@bank" spellCheck={false} /></label>
      <SoftButton type="submit" disabled={busy} className="h-12">{busy ? "Adding…" : "Add"}</SoftButton>
    </form>
  );
}
