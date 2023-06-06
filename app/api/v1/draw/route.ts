import { webln } from 'alby-js-sdk';
import { LightningAddress } from 'alby-tools';
import { NextResponse } from 'next/server';
import { Event, SimplePool, UnsignedEvent, getEventHash, getSignature, nip19 } from 'nostr-tools';
import 'websocket-polyfill';

export const dynamic = 'force-dynamic';

const ALBY_WALLET_CONNECT_URL = process.env.ALBY_WALLET_CONNECT_URL || '';

const ALBY_BASE_URL = 'https://ln.getalby.com';
const ALBY_AUTH_ENDPOINT = '/auth';
const ALBY_BALANCE_ENDPOINT = '/v2/balance';
const ALBY_INCOMING_INVOICES_ENDPOINT = '/v2/invoices/incoming';
const ALBY_AUTH_URL = ALBY_BASE_URL + ALBY_AUTH_ENDPOINT;
const ALBY_BALANCE_URL = ALBY_BASE_URL + ALBY_BALANCE_ENDPOINT;
const ALBY_INCOMING_INVOICES_URL = ALBY_BASE_URL + ALBY_INCOMING_INVOICES_ENDPOINT;
const ALBY_LOGIN = process.env.ALBY_LOGIN || '';
const ALBY_PASSWORD = process.env.ALBY_PASSWORD || '';

const NOSTR_PUBLIC_KEY = process.env.NOSTR_PUBLIC_KEY || '';
const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY || '';
const NOSTR_POOL = new SimplePool();
const NOSTR_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://offchain.pub',
  'wss://relay.plebstr.com',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
];

const PRIZE_FEE = 0.05;

interface Participant {
  pubkey: string;
  amount: number;
}

const authenticate = async () => {
  const res = await fetch(ALBY_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login: ALBY_LOGIN,
      password: ALBY_PASSWORD,
    }),
  });
  if (!res.ok) {
    return { refreshToken: '', accessToken: '' };
  }
  const data = await res.json();

  const refreshToken: string = data['refresh_token'] || '';
  const accessToken: string = data['access_token'] || '';

  return { refreshToken, accessToken };
};

const getBalance = async (accessToken: string) => {
  const res = await fetch(ALBY_BALANCE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    return { balance: '', currency: '', unit: '' };
  }
  const data = await res.json();

  const balance: string = data['balance'] || '';
  const currency: string = data['currency'] || '';
  const unit: string = data['unit'] || '';

  return { balance, currency, unit };
};

const getIncomingInvoices = async (accessToken: string) => {
  const res = await fetch(ALBY_INCOMING_INVOICES_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    return { incomingInvoices: [] };
  }
  const incomingInvoices = (await res.json()) as any[];
  if (!incomingInvoices || incomingInvoices.length === 0) {
    return { incomingInvoices: [] };
  }

  return { incomingInvoices };
};

const publishEvent = (content: string, tags: string[][]) =>
  new Promise<boolean>((resolve) => {
    const unsignedEvent: UnsignedEvent = {
      pubkey: NOSTR_PUBLIC_KEY,
      created_at: Math.round(Date.now() / 1000),
      kind: 1,
      content,
      tags,
    };

    const signedEvent: Event = {
      ...unsignedEvent,
      id: getEventHash(unsignedEvent),
      sig: getSignature(unsignedEvent, NOSTR_PRIVATE_KEY),
    };

    const pubs = NOSTR_POOL.publish(NOSTR_RELAYS, signedEvent);
    pubs.on('ok', () => {
      resolve(true);
    });
  });

const getLud16 = async (pubkey: string) => {
  const metadata = await NOSTR_POOL.get(NOSTR_RELAYS, { kinds: [0], authors: [pubkey], limit: 1 });

  if (!metadata || !metadata.content || metadata.content.includes('lud16') === false) {
    return '';
  }

  const lud16 = JSON.parse(metadata.content)['lud16'] || '';

  return lud16;
};

const getLatestLotteryNoteId = async () => {
  const latestLotteryNote = await NOSTR_POOL.list(NOSTR_RELAYS, [
    { kinds: [1], authors: [NOSTR_PUBLIC_KEY], limit: 1, '#t': ['lottery'] },
  ]);

  if (!latestLotteryNote || latestLotteryNote.length === 0) {
    return '';
  }

  const latestLotteryNoteId = latestLotteryNote[0].id;

  return latestLotteryNoteId;
};

const getLotteryZaps = async (latestLotteryNoteId: string) => {
  const lotteryZaps = await NOSTR_POOL.list(NOSTR_RELAYS, [
    { kinds: [9735], '#e': [latestLotteryNoteId] },
  ]);

  if (!lotteryZaps || lotteryZaps.length === 0) {
    return [];
  }

  return lotteryZaps;
};

const filterSuccessfulZaps = (lotteryZaps: Event<9735>[], incomingInvoices: any[]) => {
  let successfulZaps: Participant[] = [];

  lotteryZaps.forEach((lotteryZap) => {
    const tags = lotteryZap.tags;
    const bolt11 = tags.find((tag) => tag[0] === 'bolt11');
    const description = tags.find((tag) => tag[0] === 'description');
    // const preimage = tags.find((tag) => tag[0] === 'preimage');

    if (bolt11 && description && bolt11.length && description.length) {
      const bolt11Value = bolt11[1];
      const descriptionValue = description[1];

      incomingInvoices.forEach((incomingInvoice) => {
        const paymentRequest = incomingInvoice['payment_request'] || ''; // lnbc
        if (paymentRequest === bolt11Value && incomingInvoice['is_paid'] === true) {
          successfulZaps.push({
            pubkey: JSON.parse(descriptionValue)['pubkey'] || '',
            amount: incomingInvoice['amount'] || 0,
          });
        }
      });
    }
  });

  return successfulZaps;
};

const processPrize = (successfulZaps: Participant[]) => {
  const totalParticipants = successfulZaps.length;
  const totalAmount = successfulZaps.reduce((acc, curr) => acc + curr.amount, 0);
  const prizeAmount = totalAmount * (1 - PRIZE_FEE);
  if (prizeAmount <= 0) {
    return { totalParticipants: 0, totalAmount: 0, prizeAmount: 0 };
  }

  return { totalParticipants, totalAmount, prizeAmount };
};

const drawWinner = ({
  successfulZaps,
  totalAmount,
}: {
  successfulZaps: Participant[];
  totalAmount: number;
}) => {
  let randomNumber = Math.random() * totalAmount;

  for (let zap of successfulZaps) {
    randomNumber -= zap.amount;
    if (randomNumber <= 0) {
      return zap;
    }
  }

  // Should never happen
  return successfulZaps[0];
};

const sendPrizeToWinner = async (winner: Participant, prizeAmount: number) => {
  const lud16 = await getLud16(winner.pubkey);
  if (!lud16) {
    return { error: 'No lud16' };
  }

  // console.log('lud16', lud16);

  const nwc = new webln.NWC({ nostrWalletConnectUrl: ALBY_WALLET_CONNECT_URL });
  await nwc.enable();
  const ln = new LightningAddress(lud16, { webln: nwc as any });
  await ln.fetch();
  ln.nostrPubkey = winner.pubkey;
  const invoice = await ln.zapInvoice(
    {
      satoshi: prizeAmount,
      comment: 'Lottery Prize',
      relays: NOSTR_RELAYS,
    },
    {
      nostr: {
        getPublicKey: () => Promise.resolve(NOSTR_PUBLIC_KEY),
        signEvent: (event: any) =>
          Promise.resolve({ ...event, sig: getSignature(event, NOSTR_PRIVATE_KEY) }),
      },
    }
  );
  if (!invoice) {
    return { error: 'No invoice' };
  }

  // console.log('invoice', invoice);

  const zapResponse = await nwc.sendPayment(invoice.paymentRequest);
  if (!zapResponse) {
    return { error: 'No zapResponse' };
  }

  // console.log('zapResponse', zapResponse);

  return { lud16, invoice, zapResponse };
};

export async function GET() {
  const latestLotteryNoteId = await getLatestLotteryNoteId();
  if (!latestLotteryNoteId) {
    console.error('No lottery note');
    return NextResponse.json({ success: false, error: 'No lottery note' });
  }

  const lotteryZaps = await getLotteryZaps(latestLotteryNoteId);
  if (!lotteryZaps || lotteryZaps.length === 0) {
    console.error('No lottery zaps');
    return NextResponse.json({ success: false, error: 'No lottery zaps' });
  }

  // console.log('lotteryZaps', lotteryZaps);

  const { refreshToken, accessToken } = await authenticate();
  if (!refreshToken || !accessToken) {
    console.error('No auth');
    return NextResponse.json({ success: false, error: 'No auth' });
  }

  // const { balance, currency, unit } = await getBalance(accessToken);
  // if (!balance || !currency || !unit) {
  //   return NextResponse.json({ success: false, error: 'No balance' });
  // }

  const { incomingInvoices } = await getIncomingInvoices(accessToken);
  if (!incomingInvoices || incomingInvoices.length === 0) {
    console.error('No incoming invoices');
    return NextResponse.json({ success: false, error: 'No incoming invoices' });
  }

  // console.log('incomingInvoices', incomingInvoices);

  const successfulZaps = filterSuccessfulZaps(lotteryZaps, incomingInvoices);
  if (!successfulZaps || successfulZaps.length === 0) {
    console.error('No successful zaps');
    return NextResponse.json({ success: false, error: 'No successful zaps' });
  }

  // console.log('successfulZaps', successfulZaps);

  const { totalParticipants, totalAmount, prizeAmount } = processPrize(successfulZaps);
  if (totalParticipants === 0 || totalAmount === 0 || prizeAmount === 0) {
    console.error('No prize');
    return NextResponse.json({ success: false, error: 'No prize' });
  }

  // console.log('totalParticipants', totalParticipants);
  // console.log('totalAmount', totalAmount);
  // console.log('prizeAmount', prizeAmount);

  const winner = drawWinner({ successfulZaps, totalAmount });

  console.log('winner', winner);

  const { lud16, invoice, zapResponse, error } = await sendPrizeToWinner(winner, prizeAmount);
  if (!!error) {
    console.error('Error sending prize', lud16, invoice, zapResponse, error);
    return NextResponse.json({ success: false, error });
  }

  console.log(
    'Prize successfully sent to the winner',
    totalParticipants,
    totalAmount,
    prizeAmount,
    lud16,
    invoice,
    zapResponse
  );

  await publishEvent(
    'Congrats nostr:' +
      nip19.npubEncode(winner.pubkey) +
      ' You Are The Lucky Winner For This Round of LUCKSTR LOTTERY!' +
      '\nPrize Amount (Satoshis): ' +
      prizeAmount +
      '\n\nTotal Participants: ' +
      totalParticipants +
      '\nTotal Zaps (Satoshis): ' +
      totalAmount,
    [
      ['t', 'winner'],
      ['p', winner.pubkey],
      ['e', latestLotteryNoteId, 'root'],
      ['p', NOSTR_PUBLIC_KEY],
    ]
  );

  return NextResponse.json({
    success: true,
    totalParticipants,
    totalAmount,
    prizeFee: PRIZE_FEE,
    prizeAmount,
    winner: {
      ...winner,
      lud16,
    },
    bolt11: invoice!.paymentRequest,
    zapResponse,
  });
}
