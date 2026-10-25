"use client";

import { FormEvent, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Modal, ModalContent } from "@/components/ui/Modal";

export const MIN_DISPUTE_REASON_LENGTH = 10;
export const MAX_DISPUTE_REASON_LENGTH = 1_000;

interface DisputeReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<boolean>;
  submissionError?: string | null;
}

function validateReason(reason: string): string | null {
  const trimmedReason = reason.trim();
  if (!trimmedReason) return "A dispute reason is required.";
  if (trimmedReason.length < MIN_DISPUTE_REASON_LENGTH) {
    return `Dispute reason must be at least ${MIN_DISPUTE_REASON_LENGTH} characters.`;
  }
  return null;
}

export function DisputeReasonDialog({
  open,
  onOpenChange,
  onSubmit,
  submissionError,
}: DisputeReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const error = validateReason(reason);

  function resetForm() {
    setReason("");
    setHasInteracted(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isSubmitting) return;
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasInteracted(true);
    if (error) return;

    setIsSubmitting(true);
    try {
      const succeeded = await onSubmit(reason.trim());
      if (succeeded) {
        resetForm();
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const showError = hasInteracted && error !== null;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent
        aria-describedby="dispute-reason-description"
        className="p-6 sm:p-7"
        mobileFullScreen={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <Dialog.Title className="pr-10 text-xl font-semibold text-text-primary">
          Initiate dispute
        </Dialog.Title>
        <Dialog.Description
          id="dispute-reason-description"
          className="mt-2 text-sm text-text-secondary"
        >
          Explain what went wrong. This reason will be shared with the other
          party and the assigned mediator.
        </Dialog.Description>

        <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-medium text-text-primary"
              htmlFor="dispute-reason"
            >
              Dispute reason
            </label>
            <textarea
              ref={textareaRef}
              id="dispute-reason"
              name="reason"
              required
              minLength={MIN_DISPUTE_REASON_LENGTH}
              maxLength={MAX_DISPUTE_REASON_LENGTH}
              rows={5}
              value={reason}
              disabled={isSubmitting}
              aria-invalid={showError}
              aria-describedby={
                showError ? "dispute-reason-hint dispute-reason-error" : "dispute-reason-hint"
              }
              onBlur={() => setHasInteracted(true)}
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.length > 0) setHasInteracted(true);
              }}
              className="mt-2 w-full resize-y rounded-lg border border-border-default bg-bg-card px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-gold focus:ring-2 focus:ring-gold/30 disabled:cursor-wait disabled:opacity-60"
              placeholder="Describe the issue in at least 10 characters"
            />
            <div className="mt-1.5 flex items-start justify-between gap-4 text-xs">
              <p id="dispute-reason-hint" className="text-text-muted">
                Minimum {MIN_DISPUTE_REASON_LENGTH} characters
              </p>
              <p aria-hidden="true" className="text-text-muted">
                {reason.length}/{MAX_DISPUTE_REASON_LENGTH}
              </p>
            </div>
            {showError && (
              <p
                id="dispute-reason-error"
                role="alert"
                className="mt-2 text-sm text-status-danger"
              >
                {error}
              </p>
            )}
          </div>

          {submissionError && (
            <p
              role="alert"
              className="rounded-lg border border-status-danger/20 bg-red-500/10 px-3 py-2 text-sm text-status-danger"
            >
              {submissionError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={isSubmitting}
                className="rounded-lg border border-border-default px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-wait disabled:opacity-50"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? "Submitting…" : "Submit dispute"}
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
