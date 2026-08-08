import { useState, useEffect } from "react";
import {
  BuySwapLog,
  PoolCreatedLogs,
  SellSwapLog,
} from "../clients/FlaunchPositionManagerClient";
import { ReadFlaunchSDK } from "../sdk/FlaunchSDK";
import { Address } from "viem";

/**
 * Hook to watch and track pool creation events (new coin launches)
 * @param flaunch - Instance of ReadFlaunchSDK to interact with the contract
 * @param startBlockNumber - Optional block number to start watching events from
 * @returns Object containing:
 *  - logs: Array of pool creation events in reverse chronological order
 *  - isFetchingFromStart: Boolean indicating if initial historical events are being fetched
 */
export function usePoolCreatedEvents(
  flaunch: ReadFlaunchSDK,
  startBlockNumber?: bigint
) {
  const [logs, setLogs] = useState<PoolCreatedLogs>([]);
  const [isFetchingFromStart, setIsFetchingFromStart] = useState(false);

  useEffect(() => {
    let stale = false;
    setLogs([]);
    setIsFetchingFromStart(false);

    const setupWatcher = async () => {
      const cleanup = await flaunch.watchPoolCreated({
        onPoolCreated: ({ logs: newLogs, isFetchingFromStart }) => {
          if (stale) return;
          setIsFetchingFromStart(isFetchingFromStart);
          setLogs((prevLogs) => [...newLogs, ...prevLogs]);
        },
        startBlockNumber,
      });
      return cleanup;
    };

    const cleanupPromise = setupWatcher();

    return () => {
      stale = true;
      cleanupPromise.then(({ cleanup }) => cleanup());
    };
  }, [flaunch, startBlockNumber]);

  // Add effect to update times
  useEffect(() => {
    const timer = setInterval(() => {
      // Force re-render to update relative times
      setLogs((prev) => [...prev]);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return { logs, isFetchingFromStart };
}

/**
 * Hook to watch and track swap events (buys/sells) for a specific coin
 * @param flaunch - Instance of ReadFlaunchSDK to interact with the contract
 * @param coinAddress - Address of the coin to watch swaps for
 * @param startBlockNumber - Optional block number to start watching events from
 * @returns Object containing:
 *  - logs: Array of swap events (both buys and sells) in reverse chronological order
 *  - isFetchingFromStart: Boolean indicating if initial historical events are being fetched
 */
export function usePoolSwapEvents(
  flaunch: ReadFlaunchSDK,
  coinAddress: Address,
  startBlockNumber?: bigint
) {
  const [logs, setLogs] = useState<(BuySwapLog | SellSwapLog)[]>([]);
  const [isFetchingFromStart, setIsFetchingFromStart] = useState(false);

  useEffect(() => {
    let stale = false;
    setLogs([]);
    setIsFetchingFromStart(false);

    const setupWatcher = async () => {
      const cleanup = await flaunch.watchPoolSwap({
        onPoolSwap: ({ logs: newLogs, isFetchingFromStart }) => {
          if (stale) return;
          setIsFetchingFromStart(isFetchingFromStart);
          setLogs((prevLogs) => [...newLogs, ...prevLogs]);
        },
        filterByCoin: coinAddress,
        startBlockNumber,
      });
      return cleanup;
    };

    const cleanupPromise = setupWatcher();

    return () => {
      stale = true;
      cleanupPromise.then(({ cleanup }) => cleanup());
    };
  }, [flaunch, coinAddress, startBlockNumber]);

  // Add effect to update times
  useEffect(() => {
    const timer = setInterval(() => {
      // Force re-render to update relative times
      setLogs((prev) => [...prev]);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return { logs, isFetchingFromStart };
}
