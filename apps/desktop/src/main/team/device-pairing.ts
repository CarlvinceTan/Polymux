import {createHash, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';

export interface DevicePeer {
  deviceType?: import('@polymux/protocol').DeviceType;
  deviceId: string;
  deviceName: string;
  endpoint?: string;
  hostId?: string;
  secret?: string;
}
export interface PairingApproval {
  id: string;
  deviceName: string;
  choices: string[];
  expiresAt: string;
}
export interface PairingChallenge {
  status: 'pending';
  id: string;
  token: string;
  number: string;
  expiresAt: string;
}
interface Session {
  peer: DevicePeer;
  tokenHash: string;
  number: string;
  choices: string[];
  expiresAt: number;
  status: 'pending' | 'approving' | 'approved' | 'rejected';
  credentials?: Record<string, string>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(b));

/** A pending invitation never authenticates RPC. Only the local owner can approve it. */
export class DevicePairingSessions {
  readonly #sessions = new Map<string, Session>();
  #invitation: {hash: string; expiresAt: number} | null = null;
  #inviteFailures = 0;
  #inviteLockedUntil = 0;
  #admissions: number[] = [];
  constructor(private readonly ttl = 120_000, private readonly now = () => Date.now()) {}

  invitation(): {token: string; expiresAt: string} {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + 5 * 60_000;
    this.#invitation = {hash: digest(token), expiresAt};
    return {token, expiresAt: new Date(expiresAt).toISOString()};
  }

  consumeInvitation(token: string): boolean {
    if (this.#inviteLockedUntil && this.now() >= this.#inviteLockedUntil) { this.#inviteFailures = 0; this.#inviteLockedUntil = 0; }
    if (this.#inviteFailures >= 10 || !this.#invitation || this.now() >= this.#invitation.expiresAt || !equal(token, this.#invitation.hash)) {
      this.#inviteFailures++;
      if (this.#inviteFailures === 10) this.#inviteLockedUntil = this.now() + 60_000;
      return false;
    }
    this.#invitation = null;
    return true;
  }

  create(peer: DevicePeer): PairingChallenge {
    this.prune();
    this.#admissions = this.#admissions.filter(time => time > this.now() - 60_000);
    if (this.#admissions.length >= 5 || this.#sessions.size >= 8) throw new Error('Too many pairing requests. Try again later.');
    if (!peer.deviceId || peer.deviceId.length > 120 || !peer.deviceName || peer.deviceName.length > 120) throw new Error('Invalid device identity.');
    if ([...this.#sessions.values()].some(s => s.peer.deviceId === peer.deviceId && s.status === 'pending')) throw new Error('This device already has a pending request.');
    this.#admissions.push(this.now());
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const number = String(randomInt(10, 100));
    const choices = new Set([number]);
    while (choices.size < 3) choices.add(String(randomInt(10, 100)));
    const shuffled = [...choices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const expiresAt = this.now() + this.ttl;
    this.#sessions.set(id, {peer, tokenHash: digest(token), number, choices: shuffled, expiresAt, status: 'pending'});
    return {status: 'pending', id, token, number, expiresAt: new Date(expiresAt).toISOString()};
  }

  approvals(): PairingApproval[] {
    this.prune();
    return [...this.#sessions].filter(([,s]) => s.status === 'pending').map(([id,s]) => ({id, deviceName: s.peer.deviceName, choices: s.choices, expiresAt: new Date(s.expiresAt).toISOString()}));
  }

  async approve(id: string, number: string | null, grant: (peer: DevicePeer, assertActive: () => void) => Promise<Record<string, string>>): Promise<void> {
    this.prune();
    const session = this.#sessions.get(id);
    if (!session || session.status !== 'pending') throw new Error('This pairing request is no longer available.');
    if (number !== session.number) { session.status = 'rejected'; return; }
    session.status = 'approving';
    try {
      const assertActive = () => { if (this.#sessions.get(id) !== session || session.expiresAt <= this.now()) throw new Error('Pairing was cancelled or expired.'); };
      session.credentials = await grant(session.peer, assertActive);
      assertActive();
      session.status = 'approved';
    } catch (error) { session.status = 'rejected'; throw error; }
  }

  poll(id: string, token: string): {status: string; credentials?: Record<string, string>} {
    this.prune();
    const session = this.#sessions.get(id);
    if (!session || !equal(token, session.tokenHash)) throw new Error('This pairing request is invalid or expired.');
    if (session.status === 'approved') {
      return {status: 'approved', credentials: session.credentials};
    }
    return {status: session.status === 'approving' ? 'pending' : session.status};
  }

  acknowledge(id: string, token: string): void {
    const session = this.#sessions.get(id);
    if (session?.status === "approved" && equal(token, session.tokenHash)) this.#sessions.delete(id);
  }
  cancel(id: string, token: string): {peer: DevicePeer; credentials?: Record<string, string>} | null {
    const session = this.#sessions.get(id);
    if (!session || !equal(token, session.tokenHash)) return null;
    this.#sessions.delete(id);
    return {peer: session.peer, credentials: session.credentials};
  }
  reset(): void { this.#sessions.clear(); this.#invitation = null; }
  private prune(): void {
    for (const [id,s] of this.#sessions) if (s.expiresAt <= this.now() && s.status !== 'approving') this.#sessions.delete(id);
  }
}
