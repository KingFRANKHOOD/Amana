import PinataClient from "@pinata/sdk";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

let _pinata: PinataClient | null = null;

export function getPinataClient(): PinataClient {
    if (!_pinata) {
        const apiKey = requireEnv("PINATA_API_KEY");
        const secret = requireEnv("PINATA_SECRET");
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
