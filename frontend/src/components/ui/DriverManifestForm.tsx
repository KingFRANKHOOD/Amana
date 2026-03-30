"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { clsx } from "clsx";
import { FormField } from "@/components/ui/FormField";
import { Icon } from "@/components/ui/Icon";

export interface DriverManifestData {
  driverName: string;
  driverPhone: string;
  licensePlate: string;
}

interface DriverManifestFormProps {
  isOpen: boolean;
  onComplete: (data: DriverManifestData) => void;
  onDismiss?: () => void;
}

export function DriverManifestForm({ isOpen, onComplete, onDismiss }: DriverManifestFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [submitEnabled, setSubmitEnabled] = useState(false);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = bodyOverflow || "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!formRef.current) {
      setSubmitEnabled(false);
      return;
    }

    setSubmitEnabled(formRef.current.checkValidity());
  }, [driverName, driverPhone, licensePlate]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = formRef.current;

    if (!form) {
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      setSubmitEnabled(false);
      return;
    }

    onComplete({
      driverName: driverName.trim(),
      driverPhone: driverPhone.trim(),
      licensePlate: licensePlate.trim(),
    });

    setDriverName("");
    setDriverPhone("");
    setLicensePlate("");

    onDismiss?.();
  };

  const handleClose = () => {
    onDismiss?.();
  };

  const iconAccent = useMemo(() => "bg-gold/15 text-gold", []);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onDismiss?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-overlay backdrop-blur-lg z-50 flex items-center justify-center">
          <Dialog.Content className="bg-card border border-border-default shadow-modal max-w-md w-full max-h-[90vh] rounded-2xl flex flex-col">
            <div className="p-6 border-b border-border-default">
              <div className="flex items-center gap-3 mb-4">
                <span className={clsx("rounded-lg p-2", iconAccent)}>
                  <Icon name="truck" size="lg" aria-label="driver vehicle" className="text-gold" />
                </span>
                <div>
                  <Dialog.Title className="text-xl font-semibold text-primary">Driver Manifest</Dialog.Title>
                  <Dialog.Description className="text-sm text-secondary mt-1">
                    Enter driver and vehicle data for the Ship-First transit phase.
                  </Dialog.Description>
                </div>
              </div>
            </div>

            <form ref={formRef} onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4 flex-1">
              <FormField label="Driver Name" name="driver-name" required>
                <input
                  type="text"
                  name="driver-name"
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                  value={driverName}
                  onChange={(event) => setDriverName(event.target.value)}
                  placeholder="e.g. Amina Khalid"
                  required
                />
              </FormField>

              <FormField
                label="Driver Phone"
                name="driver-phone"
                hint="Include country code for best routing"
                required
              >
                <input
                  type="tel"
                  name="driver-phone"
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                  value={driverPhone}
                  onChange={(event) => setDriverPhone(event.target.value)}
                  placeholder="e.g. +234 803 000 0000"
                  pattern="^\\+?[0-9\s-]{7,20}$"
                  required
                />
              </FormField>

              <FormField label="License Plate" name="license-plate" required>
                <input
                  type="text"
                  name="license-plate"
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                  value={licensePlate}
                  onChange={(event) => setLicensePlate(event.target.value)}
                  placeholder="e.g. GEG 1123 H"
                  required
                />
              </FormField>

              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 rounded-lg border border-border-default text-secondary hover:bg-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!submitEnabled}
                  className="flex-1 px-4 py-2 rounded-lg bg-gold text-text-inverse font-medium hover:bg-gold-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit Manifest
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
