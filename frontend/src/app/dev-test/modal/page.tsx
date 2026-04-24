"use client";

import { useModal } from "@/hooks/useModal";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from "@/components/ui";

export default function ModalDevPage() {
  const modal = useModal();

  return (
    <main className="min-h-screen bg-primary px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold text-gold">Modal System Demo</h1>
        <p className="text-sm text-secondary">
          Use this page for QA and screenshot capture (desktop/mobile/form/backdrop).
        </p>

        <Modal open={modal.isOpen} onOpenChange={modal.setIsOpen}>
          <ModalTrigger asChild>
            <button
              type="button"
              className="rounded-lg bg-gold px-4 py-2 font-medium text-text-inverse hover:bg-gold-hover"
            >
              Open Modal
            </button>
          </ModalTrigger>

          <ModalContent overlayOpacity="heavy" mobileFullScreen>
            <ModalHeader>
              <ModalTitle>Trade Confirmation</ModalTitle>
              <ModalDescription>
                Confirm details before locking escrow funds.
              </ModalDescription>
            </ModalHeader>

            <ModalBody>
              <form className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm text-secondary" htmlFor="buyer-name">
                    Buyer Name
                  </label>
                  <input
                    id="buyer-name"
                    className="w-full rounded-lg border border-border-default bg-elevated px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                    placeholder="Enter buyer name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-secondary" htmlFor="delivery-note">
                    Delivery Notes
                  </label>
                  <textarea
                    id="delivery-note"
                    rows={4}
                    className="w-full rounded-lg border border-border-default bg-elevated px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                    placeholder="Attach additional delivery details"
                  />
                </div>
              </form>
            </ModalBody>

            <ModalFooter>
              <button
                type="button"
                onClick={modal.close}
                className="rounded-lg border border-border-default px-4 py-2 text-secondary hover:bg-elevated"
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-gold px-4 py-2 font-medium text-text-inverse hover:bg-gold-hover"
              >
                Confirm Trade
              </button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </main>
  );
}
