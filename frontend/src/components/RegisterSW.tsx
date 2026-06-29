"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/register-sw";

export default function RegisterSW() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
