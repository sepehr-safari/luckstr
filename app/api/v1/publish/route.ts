import { NextResponse } from 'next/server';
import { Event, SimplePool, UnsignedEvent, getEventHash, getSignature } from 'nostr-tools';
import 'websocket-polyfill';

export const dynamic = 'force-dynamic';

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

export async function GET() {
  await publishEvent(
    'Welcome to the Most Exciting Nostr Lottery: LUCKSTR!\n\nZapping this note will make you join the ⚡ PRIZE POOL!\n\nThe more sats you zap to this note, the higher your chances of winning!\n\nThis is a fully automated and transparent daily lottery!\nCheck out older notes for past lottery rounds and winners!\n\nImportant rules and details:\nEvery single transaction, in and out, can be tracked by its zap event of kind 9735.\nThe winner will be chosen at random using an open-source and fair algorithm.\nThe winner will be announced the following day.\n95 percent of total collected sats will be automatically sent back to the winner`s Lightning Address (lud16) available in their profile metadata (make sure you have the right setup before participating)\nAnd 5 percent of total collected sats will be kept as a fee and will be dedicated to the development of Nostr apps and tools.\nBe careful not to zap older notes, as they will not be considered for this lottery.\n\nGood luck and have fun!',
    [['t', 'lottery']]
  );
  return NextResponse.json({ success: true });
}
