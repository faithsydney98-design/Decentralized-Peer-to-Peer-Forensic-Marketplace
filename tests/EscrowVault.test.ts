// EscrowVault.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, principalCV, someCV, noneCV, ClarityType } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_ESCROW_NOT_FOUND = 102;
const ERR_INVALID_STATUS = 103;
const ERR_INSUFFICIENT_FUNDS = 104;
const ERR_DISPUTE_IN_PROGRESS = 105;
const ERR_FEE_EXCEEDS_AMOUNT = 106;
const ERR_INVALID_TIMESTAMP = 107;
const ERR_MAX_ESCROWS_EXCEEDED = 108;
const ERR_INVALID_CURRENCY = 109;
const ERR_RELEASE_NOT_AUTHORIZED = 110;
const ERR_REFUND_NOT_AUTHORIZED = 111;

interface Escrow {
  id: number;
  complaintId: number;
  depositor: string;
  provider: string;
  amount: number;
  status: string;
  timestamp: number;
  currency: string;
  feePaid: number;
  disputeId: number | null;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class EscrowVaultMock {
  state: {
    nextEscrowId: number;
    maxEscrows: number;
    platformFeeRate: number;
    authorityPrincipal: string | null;
    escrows: Map<number, Escrow>;
    escrowsByComplaint: Map<number, number>;
  } = {
    nextEscrowId: 0,
    maxEscrows: 5000,
    platformFeeRate: 2,
    authorityPrincipal: null,
    escrows: new Map(),
    escrowsByComplaint: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextEscrowId: 0,
      maxEscrows: 5000,
      platformFeeRate: 2,
      authorityPrincipal: null,
      escrows: new Map(),
      escrowsByComplaint: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthority(newAuth: string): Result<boolean> {
    if (this.state.authorityPrincipal !== null && this.caller !== this.state.authorityPrincipal) {
      return { ok: false, value: false };
    }
    this.state.authorityPrincipal = newAuth;
    return { ok: true, value: true };
  }

  setPlatformFeeRate(newRate: number): Result<boolean> {
    if (newRate > 10) {
      return { ok: false, value: false };
    }
    if (this.caller !== this.state.authorityPrincipal) {
      return { ok: false, value: false };
    }
    this.state.platformFeeRate = newRate;
    return { ok: true, value: true };
  }

  setMaxEscrows(newMax: number): Result<boolean> {
    if (newMax <= 0) {
      return { ok: false, value: false };
    }
    if (this.caller !== this.state.authorityPrincipal) {
      return { ok: false, value: false };
    }
    this.state.maxEscrows = newMax;
    return { ok: true, value: true };
  }

  calculateFee(amount: number): number {
    const rate = this.state.platformFeeRate;
    return Math.floor((amount * rate) / 100);
  }

  depositEscrow(
    complaintId: number,
    provider: string,
    amount: number,
    currency: string
  ): Result<number> {
    if (this.state.nextEscrowId >= this.state.maxEscrows) {
      return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };
    }
    if (amount <= 0) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    if (!["STX", "sBTC"].includes(currency)) {
      return { ok: false, value: ERR_INVALID_CURRENCY };
    }
    if (this.state.escrowsByComplaint.has(complaintId)) {
      return { ok: false, value: ERR_ESCROW_NOT_FOUND };
    }
    const fee = this.calculateFee(amount);
    const netAmount = amount + fee;
    this.stxTransfers.push({ amount: netAmount, from: this.caller, to: ".platform-vault" });

    const id = this.state.nextEscrowId;
    const escrow: Escrow = {
      id,
      complaintId,
      depositor: this.caller,
      provider,
      amount,
      status: "active",
      timestamp: this.blockHeight,
      currency,
      feePaid: fee,
      disputeId: null,
    };
    this.state.escrows.set(id, escrow);
    this.state.escrowsByComplaint.set(complaintId, id);
    this.state.nextEscrowId++;
    return { ok: true, value: id };
  }

  getEscrow(id: number): Escrow | null {
    return this.state.escrows.get(id) || null;
  }

  getEscrowByComplaint(complaintId: number): number | null {
    return this.state.escrowsByComplaint.get(complaintId) || null;
  }

  releaseFunds(escrowId: number, caller: string): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: false };
    }
    if (escrow.status !== "active") {
      return { ok: false, value: ERR_INVALID_STATUS };
    }
    if (caller !== escrow.provider) {
      return { ok: false, value: ERR_RELEASE_NOT_AUTHORIZED };
    }
    const netToProvider = escrow.amount - escrow.feePaid;
    this.stxTransfers.push({ amount: netToProvider, from: ".escrow-vault", to: escrow.provider });
    this.stxTransfers.push({ amount: escrow.feePaid, from: ".escrow-vault", to: this.state.authorityPrincipal || "" });
    escrow.status = "released";
    return { ok: true, value: true };
  }

  refundFunds(escrowId: number, caller: string): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: false };
    }
    if (escrow.status !== "active") {
      return { ok: false, value: ERR_INVALID_STATUS };
    }
    if (caller !== escrow.depositor) {
      return { ok: false, value: ERR_REFUND_NOT_AUTHORIZED };
    }
    const amt = escrow.amount + escrow.feePaid;
    this.stxTransfers.push({ amount: amt, from: ".escrow-vault", to: escrow.depositor });
    escrow.status = "refunded";
    return { ok: true, value: true };
  }

  initiateDispute(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: false };
    }
    if (escrow.status !== "active") {
      return { ok: false, value: ERR_INVALID_STATUS };
    }
    if (escrow.disputeId !== null) {
      return { ok: false, value: ERR_DISPUTE_IN_PROGRESS };
    }
    escrow.status = "disputed";
    escrow.disputeId = 1;
    return { ok: true, value: true };
  }

  resolveDispute(escrowId: number, toProvider: boolean): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: false };
    }
    if (escrow.status !== "disputed") {
      return { ok: false, value: ERR_INVALID_STATUS };
    }
    if (this.caller !== this.state.authorityPrincipal) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    let res: Result<boolean>;
    if (toProvider) {
      res = this.releaseFunds(escrowId, escrow.provider);
    } else {
      res = this.refundFunds(escrowId, escrow.depositor);
    }
    if (!res.ok) {
      return res;
    }
    escrow.status = "resolved";
    return { ok: true, value: true };
  }

  getEscrowCount(): Result<number> {
    return { ok: true, value: this.state.nextEscrowId };
  }
}

describe("EscrowVault", () => {
  let contract: EscrowVaultMock;

  beforeEach(() => {
    contract = new EscrowVaultMock();
    contract.reset();
  });

  it("deposits escrow successfully", () => {
    contract.setAuthority("ST2AUTH");
    const result = contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const escrow = contract.getEscrow(0);
    expect(escrow?.complaintId).toBe(1);
    expect(escrow?.depositor).toBe("ST1TEST");
    expect(escrow?.provider).toBe("ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M");
    expect(escrow?.amount).toBe(1000);
    expect(escrow?.status).toBe("active");
    expect(escrow?.currency).toBe("STX");
    expect(escrow?.feePaid).toBe(20);
    expect(contract.stxTransfers).toEqual([{ amount: 1020, from: "ST1TEST", to: ".platform-vault" }]);
  });

  it("rejects invalid amount on deposit", () => {
    contract.setAuthority("ST2AUTH");
    const result = contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 0, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid currency on deposit", () => {
    contract.setAuthority("ST2AUTH");
    const result = contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "INVALID");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects duplicate complaint id", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    const result = contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 2000, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ESCROW_NOT_FOUND);
  });

  it("releases funds successfully", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M";
    const result = contract.releaseFunds(0, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("released");
    expect(contract.stxTransfers.length).toBe(3);
    expect(contract.stxTransfers[1].amount).toBe(980);
    expect(contract.stxTransfers[2].amount).toBe(20);
  });

  it("rejects release by unauthorized caller", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST3FAKE";
    const result = contract.releaseFunds(0, "ST3FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RELEASE_NOT_AUTHORIZED);
  });

  it("rejects release on non-active status", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M";
    contract.releaseFunds(0, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M");
    const result = contract.releaseFunds(0, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("refunds funds successfully", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST1TEST";
    const result = contract.refundFunds(0, "ST1TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("refunded");
    expect(contract.stxTransfers[1].amount).toBe(1020);
  });

  it("rejects refund by unauthorized caller", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST3FAKE";
    const result = contract.refundFunds(0, "ST3FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REFUND_NOT_AUTHORIZED);
  });

  it("initiates dispute successfully", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    const result = contract.initiateDispute(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("disputed");
    expect(escrow?.disputeId).toBe(1);
  });

  it("rejects dispute on non-active status", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.caller = "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M";
    contract.releaseFunds(0, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M");
    const result = contract.initiateDispute(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("rejects duplicate dispute", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.initiateDispute(0);
    const result = contract.initiateDispute(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("rejects dispute resolution by unauthorized", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.initiateDispute(0);
    contract.caller = "ST3FAKE";
    const result = contract.resolveDispute(0, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets platform fee rate successfully", () => {
    contract.setAuthority("ST2AUTH");
    contract.caller = "ST2AUTH";
    const result = contract.setPlatformFeeRate(5);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.platformFeeRate).toBe(5);
  });

  it("rejects invalid fee rate", () => {
    contract.setAuthority("ST2AUTH");
    contract.caller = "ST2AUTH";
    const result = contract.setPlatformFeeRate(15);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct escrow count", () => {
    contract.setAuthority("ST2AUTH");
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    contract.depositEscrow(2, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 2000, "STX");
    const result = contract.getEscrowCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("rejects max escrows exceeded", () => {
    contract.setAuthority("ST2AUTH");
    contract.state.maxEscrows = 1;
    contract.depositEscrow(1, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 1000, "STX");
    const result = contract.depositEscrow(2, "ST1PQHQKV0RJXZHJ1F0ST4Q845DB1MX8SWWWVFY3M", 2000, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_ESCROWS_EXCEEDED);
  });
});