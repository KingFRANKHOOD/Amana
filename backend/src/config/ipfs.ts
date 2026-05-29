import PinataClient from "@pinata/sdk";
import { env } from "./env";

let _pinata: PinataClient | null = null;

export function getPinataClient(): PinataClient {
    if (!_pinata) {
        const apiKey = process.env.PINATA_API_KEY ?? env.PINATA_API_KEY;
        const secret = process.env.PINATA_SECRET ?? env.PINATA_SECRET;
        if (!apiKey || !secret) {
            throw new Error("Missing required env vars: PINATA_API_KEY and PINATA_SECRET");
        }
        _pinata = new PinataClient(apiKey, secret);
    }
    return _pinata;
}

/** For testing — inject a mock client */
export function __setPinataClientForTests(client: PinataClient): void {
    _pinata = client;
}

export function __resetPinataClient(): void {
    _pinata = null;
}
