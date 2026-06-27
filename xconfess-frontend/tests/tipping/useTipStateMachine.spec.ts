/**
 * Tests for useTipStateMachine
 * Covers: pending → confirmed/failed states, Horizon polling, duplicate blocking, retry-verify
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTipStateMachine } from "@/lib/hooks/useTipStateMachine";
import { sendTip, verifyTip } from "@/lib/services/tipping.service";

jest.mock("@/lib/services/tipping.service", () => ({
  sendTip: jest.fn(),
  verifyTip: jest.fn(),
}));

const mockSendTip = sendTip as jest.MockedFunction<typeof sendTip>;
const mockVerifyTip = verifyTip as jest.MockedFunction<typeof verifyTip>;

// Mock fetch for Horizon polling
const mockFetch = jest.fn();
global.fetch = mockFetch;

const TX_HASH = "abc123def456";
const CONFESSION_ID = "confession-1";
const RECIPIENT = "GABCDEF1234567890ABCDEF1234567890ABCDEF12345678";

function makeHorizonResponse(successful: boolean) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ successful }),
  } as Response);
}

function makeHorizon404() {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
}

function renderMachine() {
  return renderHook(() =>
    useTipStateMachine({ confessionId: CONFESSION_ID, recipientAddress: RECIPIENT }),
  );
}

// Speed up polling in tests
jest.useFakeTimers();

afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

describe("useTipStateMachine", () => {
  it("starts in idle state", () => {
    const { result } = renderMachine();
    expect(result.current.info.state).toBe("idle");
    expect(result.current.info.isBusy).toBe(false);
  });

  it("goes idle → submitting → pending → verifying → confirmed on happy path", async () => {
    mockSendTip.mockResolvedValue({ success: true, txHash: TX_HASH });
    mockFetch.mockResolvedValue(makeHorizonResponse(true));
    mockVerifyTip.mockResolvedValue({ success: true });

    const { result } = renderMachine();

    const submitPromise = act(async () => {
      result.current.submit(0.5);
    });

    // submitting immediately
    expect(result.current.info.state).toBe("submitting");

    // advance past sendTip
    await act(async () => { jest.runAllTimersAsync(); });
    await submitPromise;

    expect(result.current.info.state).toBe("confirmed");
    expect(result.current.info.txHash).toBe(TX_HASH);
    expect(result.current.info.explorerUrl).toContain(TX_HASH);
    expect(result.current.info.explorerUrl).toContain("steexp.com");
  });

  it("enters failed state when sendTip returns success:false", async () => {
    mockSendTip.mockResolvedValue({ success: false, error: "Insufficient XLM balance." });

    const { result } = renderMachine();
    await act(async () => { await result.current.submit(0.5); });

    expect(result.current.info.state).toBe("failed");
    expect(result.current.info.error).toMatch(/insufficient/i);
    expect(result.current.info.txHash).toBeNull();
  });

  it("transitions through pending state while Horizon returns 404", async () => {
    mockSendTip.mockResolvedValue({ success: true, txHash: TX_HASH });
    // First two polls return 404, third returns confirmed
    mockFetch
      .mockResolvedValueOnce(makeHorizon404())
      .mockResolvedValueOnce(makeHorizon404())
      .mockResolvedValue(makeHorizonResponse(true));
    mockVerifyTip.mockResolvedValue({ success: true });

    const { result } = renderMachine();
    const p = act(async () => { result.current.submit(0.5); });
    await act(async () => { jest.runAllTimersAsync(); });
    await p;

    expect(result.current.info.state).toBe("confirmed");
  });

  it("fails with network rejection message when Horizon reports successful:false", async () => {
    mockSendTip.mockResolvedValue({ success: true, txHash: TX_HASH });
    mockFetch.mockResolvedValue(makeHorizonResponse(false));

    const { result } = renderMachine();
    const p = act(async () => { result.current.submit(0.5); });
    await act(async () => { jest.runAllTimersAsync(); });
    await p;

    expect(result.current.info.state).toBe("failed");
    expect(result.current.info.error).toMatch(/rejected by the stellar network/i);
    // txHash is still available for explorer link
    expect(result.current.info.txHash).toBe(TX_HASH);
  });

  it("blocks duplicate submissions while in-flight", async () => {
    let resolveSend!: (v: any) => void;
    const sendPromise = new Promise((r) => { resolveSend = r; });
    mockSendTip.mockReturnValue(sendPromise as any);

    const { result } = renderMachine();
    act(() => { result.current.submit(0.5); });

    // Second call while submitting — should be ignored
    act(() => { result.current.submit(0.5); });

    expect(mockSendTip).toHaveBeenCalledTimes(1);

    resolveSend({ success: false, error: "rejected" });
    await act(async () => { jest.runAllTimersAsync(); });
  });

  it("retryVerify does not re-send the transaction", async () => {
    mockSendTip.mockResolvedValue({ success: true, txHash: TX_HASH });
    mockFetch.mockResolvedValue(makeHorizonResponse(true));
    mockVerifyTip
      .mockResolvedValueOnce({ success: false, error: "pending" })
      .mockResolvedValueOnce({ success: true });

    const { result } = renderMachine();
    const p = act(async () => { result.current.submit(0.5); });
    await act(async () => { jest.runAllTimersAsync(); });
    await p;

    expect(result.current.info.state).toBe("failed");
    expect(result.current.info.txHash).toBe(TX_HASH);

    await act(async () => { await result.current.retryVerify(); });

    expect(result.current.info.state).toBe("confirmed");
    expect(mockSendTip).toHaveBeenCalledTimes(1); // never re-sent
    expect(mockVerifyTip).toHaveBeenCalledTimes(2);
  });

  it("reset returns to idle and clears error/hash", async () => {
    mockSendTip.mockResolvedValue({ success: false, error: "nope" });

    const { result } = renderMachine();
    await act(async () => { await result.current.submit(0.5); });
    expect(result.current.info.state).toBe("failed");

    act(() => { result.current.reset(); });
    expect(result.current.info.state).toBe("idle");
    expect(result.current.info.error).toBeNull();
    expect(result.current.info.txHash).toBeNull();
  });

  it("missing recipientAddress immediately fails without calling sendTip", async () => {
    const { result } = renderHook(() =>
      useTipStateMachine({ confessionId: CONFESSION_ID, recipientAddress: undefined }),
    );

    await act(async () => { await result.current.submit(0.5); });

    expect(result.current.info.state).toBe("failed");
    expect(result.current.info.error).toMatch(/recipient/i);
    expect(mockSendTip).not.toHaveBeenCalled();
  });

  it("explorerUrl uses testnet.steexp.com on testnet", async () => {
    mockSendTip.mockResolvedValue({ success: true, txHash: TX_HASH });
    mockFetch.mockResolvedValue(makeHorizonResponse(true));
    mockVerifyTip.mockResolvedValue({ success: true });

    const { result } = renderMachine();
    const p = act(async () => { result.current.submit(0.5); });
    await act(async () => { jest.runAllTimersAsync(); });
    await p;

    expect(result.current.info.explorerUrl).toBe(`https://testnet.steexp.com/tx/${TX_HASH}`);
  });
});
