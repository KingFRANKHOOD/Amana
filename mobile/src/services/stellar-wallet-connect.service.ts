import '@walletconnect/react-native-compat';
import SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';

const STELLAR_SIGN_XDR = 'stellar_signXDR';
const NETWORK = process.env.EXPO_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const CHAIN_ID = NETWORK === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';

let clientPromise: Promise<SignClient> | null = null;

function getProjectId(): string {
  const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    throw new Error('WalletConnect is not configured. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.');
  }
  return projectId;
}

function getClient(): Promise<SignClient> {
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId: getProjectId(),
      metadata: {
        name: 'Amana',
        description: 'Stellar escrow for agricultural trades',
        url: 'https://amanavault.app',
        icons: [],
      },
    }).catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

function getStellarAddress(session: SessionTypes.Struct): string {
  const account = session.namespaces.stellar?.accounts.find((item) =>
    item.startsWith(`${CHAIN_ID}:`),
  );
  const accountParts = account?.split(':');
  const address = accountParts?.[accountParts.length - 1];
  if (!address) {
    throw new Error(`The connected wallet did not authorize a Stellar ${NETWORK} account.`);
  }
  return address;
}

async function getSession(
  onPairingUri: (uri: string) => void,
): Promise<{ client: SignClient; session: SessionTypes.Struct }> {
  const client = await getClient();
  const existingSession = client.session.getAll().find((session) =>
    session.namespaces.stellar?.accounts.some((account) =>
      account.startsWith(`${CHAIN_ID}:`),
    ),
  );
  if (existingSession) {
    return { client, session: existingSession };
  }

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      stellar: {
        chains: [CHAIN_ID],
        methods: [STELLAR_SIGN_XDR],
        events: [],
      },
    },
  });
  if (uri) onPairingUri(uri);
  const session = await approval();
  return { client, session };
}

export async function signStellarTransaction(
  unsignedXdr: string,
  expectedAddress: string,
  onPairingUri: (uri: string) => void,
): Promise<string> {
  const { client, session } = await getSession(onPairingUri);
  const address = getStellarAddress(session);
  if (address !== expectedAddress) {
    throw new Error('The connected Stellar wallet does not match the authenticated account.');
  }

  const result = await client.request<{ signedXDR: string }>({
    topic: session.topic,
    chainId: CHAIN_ID,
    request: {
      method: STELLAR_SIGN_XDR,
      params: { xdr: unsignedXdr },
    },
  });

  if (typeof result.signedXDR !== 'string' || result.signedXDR.length === 0) {
    throw new Error('The wallet did not return a signed Stellar transaction.');
  }
  return result.signedXDR;
}
