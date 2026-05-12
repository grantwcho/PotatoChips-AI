"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";

const inputClass =
  "marketing-input text-sm";

const textareaClass =
  "marketing-textarea text-sm leading-relaxed";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "submitting" });

    void (async () => {
      try {
        const response = await fetch("/api/contact", {
          method: "POST",
          body: new FormData(event.currentTarget),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(body.error ?? "Unable to submit your inquiry.");
        }

        formRef.current?.reset();
        setState({ kind: "success" });
      } catch (cause) {
        setState({
          kind: "error",
          message:
            cause instanceof Error
              ? cause.message
              : "Unable to submit your inquiry.",
        });
      }
    })();
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="w-full"
    >
      {state.kind === "success" ? (
        <p className="mb-7 border border-emerald-300/70 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Your inquiry has been submitted successfully.
        </p>
      ) : null}

      <div className="space-y-7">
        <Field label="Name" htmlFor="name">
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your full name"
            required
            className={inputClass}
          />
        </Field>

        <Field label="Company" htmlFor="company">
          <input
            id="company"
            name="company"
            type="text"
            autoComplete="organization"
            placeholder="Your company or fund"
            className={inputClass}
          />
        </Field>

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            required
            className={inputClass}
          />
        </Field>

        <Field label="Phone" htmlFor="phone">
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 555-5555"
            className={inputClass}
          />
        </Field>

        <Field label="Reason for Contact" htmlFor="reason">
          <select
            id="reason"
            name="reason"
            defaultValue=""
            required
            className="marketing-select min-h-[3.35rem] px-4 text-sm"
          >
            <option value="" disabled>
              Select a reason
            </option>
            <option value="partnerships">Partnerships</option>
            <option value="general-inquiry">General Inquiry</option>
            <option value="media-inquiry">Media Inquiry</option>
            <option value="other">Other</option>
          </select>
        </Field>

        <Field label="Message" htmlFor="message">
          <textarea
            id="message"
            name="message"
            rows={6}
            placeholder="Tell us a bit about what you'd like to discuss."
            required
            className={textareaClass}
          />
        </Field>
      </div>

      <div className="mt-8 border-t border-border pt-6">
        {state.kind === "error" ? (
          <p className="mb-4 border border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={state.kind === "submitting"}
          className="marketing-primary-button !border-black !bg-black !text-white hover:!border-black/85 hover:!bg-black/85 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {state.kind === "submitting" ? "Submitting..." : "Submit"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="marketing-form-label"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
