import { useCallback, useEffect, useMemo, useState } from 'react';
import * as wg from 'lib/walletgen';
import * as need from 'lib/need';
import * as azimuth from 'azimuth-js';
import * as ob from 'urbit-ob';
import { Just, Nothing } from 'folktale/maybe';

import {
  Config,
  Ship,
  L2Point,
  Proxy,
  RollerRPCAPI,
  Options,
  EthAddress,
  UnspawnedPoints,
} from '@urbit/roller-api';

import { isDevelopment, isRopsten } from './flags';
import { ROLLER_HOSTS } from './constants';
import { useRollerStore } from 'store/roller';
import { getTimeToNextBatch } from './utils/roller';
import { useWallet } from 'store/wallet';
import { usePointCursor } from 'store/pointCursor';
import { useNetwork } from 'store/network';
import { signTransactionHash } from './authToken';
import { Invite } from 'types/Invite';
import {
  getStoredInvites,
  setPendingInvites,
  setStoredInvites,
} from 'store/storage/roller';
import { usePointCache } from 'store/pointCache';
import { hasTransferProxy, maybeGetResult } from 'views/Points';

const hasPoint = (point: number) => (invite: Invite) => invite.planet === point;

const getProxyAndNonce = (
  point: L2Point,
  address: string
): { proxy?: string; nonce?: number } =>
  point.ownership?.managementProxy?.address === address
    ? { proxy: 'manage', nonce: point.ownership?.managementProxy.nonce }
    : point.ownership?.owner?.address === address
    ? { proxy: 'own', nonce: point.ownership?.owner.nonce }
    : point.ownership?.spawnProxy?.address === address
    ? { proxy: 'spawn', nonce: point.ownership?.spawn?.owner.nonce }
    : point.ownership?.votingProxy?.address === address
    ? { proxy: 'vote', nonce: point.ownership?.votingProxy?.owner.nonce }
    : point.ownership?.transferProxy?.address === address
    ? {
        proxy: 'transfer',
        nonce: point.transferProxy?.votingProxy?.owner.nonce,
      }
    : { proxy: undefined, nonce: undefined };

export default function useRoller() {
  const { wallet, authToken }: any = useWallet();
  const { pointCursor }: any = usePointCursor();
  const { web3, contracts }: any = useNetwork();
  const allPoints: any = usePointCache();
  const controlledPoints = allPoints?.controlledPoints;
  const getDetails = allPoints?.getDetails;

  const {
    nextBatchTime,
    setNextBatchTime,
    setNextRoll,
    setPendingTransactions,
    setInvites,
    currentL2,
  } = useRollerStore();
  const [config, setConfig] = useState<Config | null>(null);

  const options: Options = useMemo(() => {
    const type = isRopsten || !isDevelopment ? 'https' : 'http';
    const host = isRopsten
      ? ROLLER_HOSTS.ROPSTEN
      : isDevelopment
      ? ROLLER_HOSTS.LOCAL
      : ROLLER_HOSTS.MAINNET;
    const port = isDevelopment ? 8080 : 80;
    const path = '/v1/roller';

    return {
      transport: {
        type,
        host,
        port,
        path,
      },
    };
  }, []);

  const api = useMemo(() => {
    return new RollerRPCAPI(options);
  }, [options]);

  const fetchConfig = useCallback(async () => {
    api
      .getRollerConfig()
      .then(response => {
        setConfig(response);
        setNextBatchTime(response.nextBatch);
      })
      .catch(err => {
        // TODO: more elegant error handling
        console.warn(
          '[fetchConfig:failed] is roller running on localhost?\n',
          err
        );
      });
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateInviteCodes = useCallback(
    async (numInvites: number) => {
      const _point = need.point(pointCursor);
      const _contracts = contracts.getOrElse(null);
      const _web3 = web3.getOrElse(null);
      const _wallet = wallet.getOrElse(null);
      const _authToken = authToken.getOrElse(null);
      if (!_contracts || !_web3 || !_wallet || !_authToken) {
        // not using need because we want a custom error
        throw new Error('Internal Error: Missing Contracts/Web3/Wallet');
      }

      const planets: UnspawnedPoints = await api.getUnspawned(_point);
      const starInfo = await api.getPoint(_point);

      const tickets: { ticket: string; planet: number; owner: string }[] = [];
      const requests: Promise<string>[] = [];

      const { proxy, nonce } = getProxyAndNonce(starInfo, _wallet.address);

      if (proxy === undefined || nonce === undefined)
        throw new Error("Error: Address doesn't match proxy");

      for (let i = 0; i < numInvites && planets[i]; i++) {
        const planet = planets[i];

        const { ticket, owner } = await wg.generateTemporaryDeterministicWallet(
          planet,
          _authToken
        );

        const from = {
          ship: _point, //ship that is spawning the planet
          proxy, // TODO: check that this is either "own" or "spawn"
        };

        const data = {
          address: owner.keys.address, // the new owner of the star (invite wallet)
          ship: planet, // ship to spawn
        };

        const txHash = await api.hashTransaction(
          nonce + i,
          from,
          'spawn',
          data
        );

        const signature = signTransactionHash(txHash, _wallet.privateKey);
        requests.push(api.spawn(signature, from, _wallet.address, data));
        tickets.push({
          ticket,
          planet,
          owner: owner.keys.address,
        });
      }

      const hashes = await Promise.all(requests);
      const pendingInvites = hashes.map(
        (hash, i): Invite => ({
          hash,
          ...tickets[i],
          status: 'pending',
        })
      );
      setPendingInvites(_point, pendingInvites);
    },
    [
      api,
      authToken,
      contracts,
      pointCursor,
      wallet,
      // walletHdPath,
      // walletType,
      web3,
    ]
  );

  const getPoints = useCallback(
    async (proxy: Proxy, address: EthAddress) => {
      const points: Ship[] =
        proxy === 'own'
          ? await api.getOwnedPoints(address)
          : proxy === 'mange'
          ? await api.getManagerFor(address)
          : proxy === 'vote'
          ? await api.getVotingFor(address)
          : proxy === 'transfer'
          ? await api.getTransferringFor(address)
          : proxy === 'spawn'
          ? await api.getSpawningFor(address)
          : [];

      return points;
    },
    [api]
  );

  const getPendingTransactions = useCallback(async () => {
    try {
      const curPoint = need.point(pointCursor);
      const newPending = await api.getPendingByShip(Number(curPoint));
      console.log('PENDING', newPending);
      setPendingTransactions(newPending);

      // const allTransactions = await api.getHistory()
    } catch (error) {
      console.warn('ERROR GETTING PENDING', error);
    }
  }, [api, setPendingTransactions, pointCursor]);

  const getInvites = useCallback(async () => {
    try {
      const curPoint: string = need.point(pointCursor);
      const invites = getStoredInvites(curPoint);
      const availableInvites = invites.available;

      const pendingTransactions = await api.getPendingByShip(curPoint);
      console.log('PENDING', pendingTransactions);
      setPendingTransactions(pendingTransactions);

      const stillPending = invites.pending.filter(invite => {
        const completed = !pendingTransactions.find(
          p => p?.rawTx?.tx?.tx?.data?.ship === invite.planet
        );

        if (completed) {
          availableInvites.push({ ...invite, status: 'available' });
        }

        return !completed;
      });

      setStoredInvites(curPoint, {
        available: availableInvites,
        pending: stillPending,
        claimed: invites.claimed,
      });
      setInvites(availableInvites);

      let possibleMissingInvites: number[] = [];

      if (currentL2) {
        const allSpawned = await api.getSpawned(Number(curPoint));
        const ownedPoints = maybeGetResult(controlledPoints, 'ownedPoints', []);
        possibleMissingInvites = ownedPoints.filter(
          (p: number) =>
            allSpawned.includes(p) &&
            azimuth.azimuth.getPointSize(p) === azimuth.azimuth.PointSize.Planet
        );
        console.log('SPAWNED AND OWNED', possibleMissingInvites);
      } else {
        const maybeOutgoingPoints = controlledPoints.chain((points: any) =>
          points.matchWith({
            Error: () => Nothing(),
            Ok: (c: any) => {
              const points = c.value.ownedPoints.map((point: number) =>
                getDetails(point).chain((details: any) =>
                  Just({ point: point, has: hasTransferProxy(details) })
                )
              );
              // if we have details for every point,
              // return the array of pending transfers.
              if (points.every((p: any) => Just.hasInstance(p))) {
                const outgoing = points
                  .filter((p: any) => p.value.has)
                  .map((p: any) => p.value.point);
                return Just(outgoing);
              } else {
                return Nothing();
              }
            },
          })
        );

        possibleMissingInvites = maybeOutgoingPoints.getOrElse([]);
      }

      // Iterate over all spawned and controlled planets
      // If the planet is not in available invites, generate the ticket and add it
      const _authToken = authToken.getOrElse(null);
      const _contracts = contracts.getOrElse(null);

      if (_authToken && _contracts) {
        for (let i = 0; i < possibleMissingInvites.length; i++) {
          const point = possibleMissingInvites[i];

          if (!availableInvites.find(hasPoint(point))) {
            console.log('MISSING IN AVAILABLE', point);
            const {
              ticket,
              owner,
            } = await wg.generateTemporaryDeterministicWallet(
              point,
              _authToken
            );

            availableInvites.push({
              ticket,
              status: 'available',
              planet: point,
              hash: '',
              owner: owner.keys.address,
            });
          }
        }

        setStoredInvites(curPoint, {
          available: availableInvites,
          pending: stillPending,
          claimed: invites.claimed,
        });
        setInvites(availableInvites);
      }
    } catch (error) {
      console.warn('ERROR GETTING INVITES', error);
    }
  }, [
    api,
    pointCursor,
    setInvites,
    setPendingTransactions,
    authToken,
    contracts,
    controlledPoints,
    currentL2,
    getDetails,
  ]);

  // On load, get initial config
  useEffect(() => {
    if (config) {
      return;
    }

    fetchConfig();
  }, [config, fetchConfig]);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextRoll = getTimeToNextBatch(nextBatchTime, new Date().getTime());
      setNextRoll(nextRoll);

      if (nextBatchTime <= new Date().getTime()) {
        api.getRollerConfig().then(response => {
          setNextBatchTime(response.nextBatch);
        });

        getInvites();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [nextBatchTime, getPendingTransactions]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    api,
    config,
    getPoints,
    getInvites,
    getPendingTransactions,
    generateInviteCodes,
  };
}