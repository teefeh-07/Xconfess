"use client";

/**
 * useTipStateMachine
 *
 * Encapsulates the pending → confirmed/failed lifecycle for on-chain tips.
 * Polls Horizon for transaction status so the UI reflects real ledger finality
 * rather than just backend acknowledgement.
 *
 * States
 *   idle        — no tip in progress
 *   submitting  — building + signing + submitting tx to Stellar
 *   pending     — tx submitted; polling Horizon for ledger inclusion (5-6 s typical)
 *   verifying   — tx confirmed on-chain; backend verification in progress
 *   confirmed   — backend verified; tip credited
 *   failed      — any step failed; `error` contains human-readable reason
 *
 * Duplicate protection
 *   `inFlightRef` blocks concurrent calls to `submit` or `retry`.
 */

import { useCallback, useRef, useState } from "react";
import { sendTip, verifyTip } from "@/lib/services/tipping.service";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const HORIZON_MAINNET = "https://horizon.stellar.org";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 8; // ~16 s max wait (covers 5-6 s Stellar finality + margin)

export type TipState =
  | "idle"
  | "submitting"
  | "pending"
  | "verifying"
  | "confirmed"
  | "failed";

export interface TipStateInfo {
  state: TipState;
  txHash: string | null;
  amount: number | null;
  error: string | null;
  explorerUrl: string | null;
  isBusy: boolean;
}

function getHorizonBase(): string {
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
  return network === "mainnet" ? HORIZON_MAINNET : HORIZON_TESTNET;
}

function getSteexpUrl(txHash: string): string {
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
  if (network === "mainnet") {
    return `https://stellar.expert/explorer/public/tx/${txHash}`;
  }
  return `https://testnet.steexp.com/tx/${txHash}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type HorizonTxStatus = "pending" | "confirmed" | "failed" | "not_found";

async function pollHorizonStatus(txHash: string): Promise<HorizonTxStatus> {
  const url = `${getHorizonBase()}/transactions/${txHash}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return "not_found";
    if (!res.ok) return "pending";
    const data = await res.json();
    // Horizon returns `successful: true/false` for included transactions
    if (typeof data.successful === "boolean") {
      return data.successful ? "confirmed" : "failed";
    }
    return "pending";
  } catch {
    return "pending";
  }
}

async function waitForHorizonConfirmation(
  txHash: string,
): Promise<"confirmed" | "failed" | "timeout"> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const status = await pollHorizonStatus(txHash);
    if (status === "confirmed") return "confirmed";
    if (status === "failed") return "failed";
  }
  return "timeout";
}

export interface UseTipStateMachineOptions {
  confessionId: string;
  recipientAddress: string | undefined;
  onConfirmed?: (txHash: string, amount: number) => void;
  onFailed?: (error: string) => void;
}

export function useTipStateMachine({
  confessionId,
  recipientAddress,
  onConfirmed,
  onFailed,
}: UseTipStateMachineOptions) {
  const [state, setState] = useState<TipState>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const isBusy =
    state === "submitting" || state === "pending" || state === "verifying";

  const explorerUrl = txHash ? getSteexpUrl(txHash) : null;

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setState("idle");
    setTxHash(null);
    setAmount(null);
    setError(null);
  }, []);

  const submit = useCallback(
    async (tipAmount: number) => {
      if (inFlightRef.current || isBusy) return;
      if (!recipientAddress) {
        setError("Recipient address not available");
        setState("failed");
        return;
      }

      inFlightRef.current = true;
      setState("submitting");
      setError(null);
      setTxHash(null);
      setAmount(tipAmount);

      try {
        // --- Phase 1: submit to Stellar ---
        const sendResult = await sendTip(confessionId, tipAmount, recipientAddress);
        if (!sendResult.success || !sendResult.txHash) {
          throw new Error(sendResult.error || "Failed to submit transaction");
        }

        const hash = sendResult.txHash;
        setTxHash(hash);
        setState("pending");

        // --- Phase 2: poll Horizon until ledger inclusion ---
        const horizonResult = await waitForHorizonConfirmation(hash);
        if (horizonResult === "failed") {
          throw new Error("Transaction was rejected by the Stellar network");
        }
        if (horizonResult === "timeout") {
          throw new Error(
            "Transaction is taking longer than expected. Check the explorer link below.",
          );
        }

        // --- Phase 3: backend verification ---
        setState("verifying");
        const verifyResult = await verifyTip(confessionId, hash);
        if (!verifyResult.success) {
          throw new Error(
            verifyResult.error || "Backend verification still pending.",
          );
        }

        setState("confirmed");
        onConfirmed?.(hash, tipAmount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to send tip";
        setError(msg);
        setState("failed");
        onFailed?.(msg);
      } finally {
        inFlightRef.current = false;
      }
    },
    [confessionId, recipientAddress, isBusy, onConfirmed, onFailed],
  );

  /** Retry backend verification only — does NOT re-send the transaction. */
  const retryVerify = useCallback(async () => {
    if (inFlightRef.current || !txHash) return;

    inFlightRef.current = true;
    setState("verifying");
    setError(null);

    try {
      const verifyResult = await verifyTip(confessionId, txHash);
      if (!verifyResult.success) {
        throw new Error(verifyResult.error || "Backend verification still pending.");
      }
      setState("confirmed");
      onConfirmed?.(txHash, amount ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(msg);
      setState("failed");
      onFailed?.(msg);
    } finally {
      inFlightRef.current = false;
    }
  }, [confessionId, txHash, amount, onConfirmed, onFailed]);

  const info: TipStateInfo = { state, txHash, amount, error, explorerUrl, isBusy };

  return { info, submit, retryVerify, reset };
}
